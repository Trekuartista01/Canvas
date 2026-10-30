import { db, schema } from "@canvas/db";
import type { StatusKind } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { logActivity } from "./activity";
import { runAutomationsForTrigger } from "./automation-runner";
import { getMembershipRole } from "./membership";
import { notifyOperationsManagers, notifyUsers } from "./notify";
import { nextOrderKey } from "./order";
import { assertCan } from "./permissions";
import { publish } from "./realtime";
import {
  firstStatusOfKind,
  lastTaskOrderKey,
  requireTask,
  workspaceIdForList,
} from "./task-queries";
import {
  approverIdsToNotify,
  assertStatusTransition,
  assertTaskApprover,
  getAssigneeIds,
} from "./task-transition";
import { buildTaskUpdateFields, computeCompletedAt, isDoneKind } from "./task-update";

type Task = Awaited<ReturnType<typeof requireTask>>;

/** A plain-text note as a TipTap doc — rich text is always TipTap JSON (CLAUDE.md). */
function textDoc(text: string) {
  return {
    type: "doc",
    content: text
      .split(/\n+/)
      .filter((line) => line.trim())
      .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

async function postComment(workspaceId: string, task: Task, authorId: string, text: string) {
  const [comment] = await db
    .insert(schema.comments)
    .values({ taskId: task.id, authorId, bodyJson: textDoc(text) })
    .returning();
  if (!comment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  await publish(workspaceId, {
    entity: "comment",
    id: comment.id,
    taskId: task.id,
    kind: "created",
  });
  return comment;
}

async function requireStatusOfKind(listId: string, kind: StatusKind, label: string) {
  const status = await firstStatusOfKind(listId, kind);
  if (!status) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This list has no ${label} status` });
  }
  return status;
}

async function currentKind(task: Task) {
  const status = await db.query.statuses.findFirst({
    where: eq(schema.statuses.id, task.statusId),
  });
  return status?.kind ?? "open";
}

/**
 * Moves a task into `status` with the same side effects task.update has:
 * completedAt, the "task.completed" activity + ops-manager notification on
 * entering done, status-change automations, and a realtime event.
 */
async function moveToStatus(
  workspaceId: string,
  task: Task,
  status: { id: string; kind: StatusKind },
  fromKind: StatusKind,
  actorId: string,
) {
  const completedAt = computeCompletedAt(status.kind, task.completedAt, new Date());
  const orderKey = nextOrderKey(await lastTaskOrderKey(task.listId, status.id));
  const [updated] = await db
    .update(schema.tasks)
    .set({
      ...buildTaskUpdateFields({ statusId: status.id, orderKey, completedAt }),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  await logActivity(workspaceId, actorId, "task", task.id, "task.updated");
  if (isDoneKind(status.kind) && !isDoneKind(fromKind)) {
    const completed = await logActivity(workspaceId, actorId, "task", task.id, "task.completed", {
      taskId: task.id,
      listId: task.listId,
      title: updated.title,
    });
    await notifyOperationsManagers(completed.id, workspaceId);
  }
  await runAutomationsForTrigger(
    workspaceId,
    { type: "task_status_changed", toStatusKind: status.kind },
    updated,
  );
  await publish(workspaceId, { entity: "task", id: task.id, listId: task.listId, kind: "updated" });
  return updated;
}

async function collaboratorIds(taskId: string) {
  const rows = await db
    .select({ userId: schema.taskCollaborators.userId })
    .from(schema.taskCollaborators)
    .where(eq(schema.taskCollaborators.taskId, taskId));
  return rows.map((r) => r.userId);
}

export async function submitTaskForReview(user: SessionUser, taskId: string) {
  const task = await requireTask(taskId);
  const workspaceId = await workspaceIdForList(task.listId);
  await assertCan(user, workspaceId, "task:update");
  const review = await requireStatusOfKind(task.listId, "review", "Awaiting approval");
  const fromKind = await currentKind(task);
  if (fromKind === "review") return task;
  await assertStatusTransition(user, workspaceId, task, fromKind, "review");

  const updated = await moveToStatus(workspaceId, task, review, fromKind, user.id);
  const assigneeIds = await getAssigneeIds(task.id);
  const activity = await logActivity(
    workspaceId,
    user.id,
    "task",
    task.id,
    "task.submitted_for_review",
    { taskId: task.id, listId: task.listId, title: updated.title },
  );
  await notifyUsers(
    activity.id,
    await approverIdsToNotify(workspaceId, task, assigneeIds, user.id),
  );
  return updated;
}

export async function approveTask(user: SessionUser, taskId: string) {
  const task = await requireTask(taskId);
  const workspaceId = await workspaceIdForList(task.listId);
  const fromKind = await currentKind(task);
  if (fromKind !== "review") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This task isn't awaiting approval" });
  }
  const assigneeIds = await assertTaskApprover(user, workspaceId, task);
  const done = await requireStatusOfKind(task.listId, "done", "Completed");
  await assertStatusTransition(user, workspaceId, task, fromKind, done.kind);

  const updated = await moveToStatus(workspaceId, task, done, fromKind, user.id);
  const activity = await logActivity(workspaceId, user.id, "task", task.id, "task.approved", {
    taskId: task.id,
    listId: task.listId,
    title: updated.title,
  });
  await notifyUsers(
    activity.id,
    [...assigneeIds, ...(await collaboratorIds(task.id))].filter((id) => id !== user.id),
  );
  return updated;
}

export async function rejectTask(user: SessionUser, taskId: string, comment: string) {
  const task = await requireTask(taskId);
  const workspaceId = await workspaceIdForList(task.listId);
  const fromKind = await currentKind(task);
  if (fromKind !== "review") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This task isn't awaiting approval" });
  }
  const assigneeIds = await assertTaskApprover(user, workspaceId, task);
  const active = await requireStatusOfKind(task.listId, "active", "In progress");
  await assertStatusTransition(user, workspaceId, task, fromKind, active.kind, { viaReject: true });

  const updated = await moveToStatus(workspaceId, task, active, fromKind, user.id);
  await postComment(workspaceId, task, user.id, comment);
  const activity = await logActivity(workspaceId, user.id, "task", task.id, "task.rejected", {
    taskId: task.id,
    listId: task.listId,
    title: updated.title,
    comment,
  });
  await notifyUsers(
    activity.id,
    [...assigneeIds, ...(await collaboratorIds(task.id))].filter((id) => id !== user.id),
  );
  return updated;
}

/**
 * Hands one assignee's place on a task to a colleague, with a required note
 * (posted as a comment so the new assignee sees the context). The outgoing
 * assignee may do this themselves; otherwise it takes an approver.
 */
export async function transferTask(
  user: SessionUser,
  input: { taskId: string; fromUserId: string; toUserId: string; note: string },
) {
  const task = await requireTask(input.taskId);
  const workspaceId = await workspaceIdForList(task.listId);
  await assertCan(user, workspaceId, "task:update");
  if (input.fromUserId === input.toUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a different colleague" });
  }
  const assigneeIds = await getAssigneeIds(task.id);
  if (!assigneeIds.includes(input.fromUserId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That person isn't assigned to this task",
    });
  }
  if (input.fromUserId !== user.id) await assertTaskApprover(user, workspaceId, task);
  if (!(await getMembershipRole(workspaceId, input.toUserId))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Colleague must be an active member" });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.taskAssignees)
      .where(
        and(
          eq(schema.taskAssignees.taskId, task.id),
          eq(schema.taskAssignees.userId, input.fromUserId),
        ),
      );
    await tx
      .insert(schema.taskAssignees)
      .values({ taskId: task.id, userId: input.toUserId })
      .onConflictDoNothing();
  });

  await postComment(workspaceId, task, user.id, `Transferred: ${input.note}`);
  const activity = await logActivity(workspaceId, user.id, "task", task.id, "task.transferred", {
    taskId: task.id,
    listId: task.listId,
    title: task.title,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    note: input.note,
  });
  await notifyUsers(
    activity.id,
    [input.fromUserId, input.toUserId].filter((id) => id !== user.id),
  );
  await publish(workspaceId, { entity: "task", id: task.id, listId: task.listId, kind: "updated" });
  return { taskId: task.id };
}
