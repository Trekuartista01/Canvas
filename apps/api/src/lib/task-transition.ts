import { db, schema } from "@canvas/db";
import type { StatusKind } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { can } from "../auth/can";
import type { SessionUser } from "../auth/session";
import { listActiveMemberIds, getPeopleContext } from "./membership";
import { getOperationsManagerIds } from "./notify";
import { checkStatusTransition } from "./task-transition-rules";

type TaskRef = { id: string; listId: string; createdBy: string; requiresProof: boolean };

export async function getAssigneeIds(taskId: string) {
  const rows = await db
    .select({ userId: schema.taskAssignees.userId })
    .from(schema.taskAssignees)
    .where(eq(schema.taskAssignees.taskId, taskId));
  return rows.map((r) => r.userId);
}

/**
 * May `user` approve, reject or transfer this task? tasks:manageTeam,
 * resolved per task: an assignee's direct manager passes the staff-manager
 * team check, and the task's creator passes outright — unless they're
 * also an assignee, so nobody approves their own work.
 */
export async function isTaskApprover(
  user: SessionUser,
  workspaceId: string,
  task: TaskRef,
  assigneeIds: string[],
) {
  const people = await getPeopleContext(workspaceId, user.id);
  if (!people) return false;
  const reportsToMe =
    assigneeIds.length > 0
      ? await db
          .select({ userId: schema.memberships.userId })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.workspaceId, workspaceId),
              eq(schema.memberships.managerUserId, user.id),
              inArray(schema.memberships.userId, assigneeIds),
            ),
          )
          .limit(1)
      : [];
  return can(user, "tasks:manageTeam", {
    type: "people",
    peopleRole: people.peopleRole,
    target: {
      isSelf: false,
      isDirectReport: reportsToMe.length > 0,
      isCreator: task.createdBy === user.id && !assigneeIds.includes(user.id),
    },
  });
}

export async function assertTaskApprover(user: SessionUser, workspaceId: string, task: TaskRef) {
  const assigneeIds = await getAssigneeIds(task.id);
  if (!(await isTaskApprover(user, workspaceId, task, assigneeIds))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't approve this task" });
  }
  return assigneeIds;
}

async function listHasReviewStatus(listId: string) {
  const status = await db.query.statuses.findFirst({
    where: and(eq(schema.statuses.listId, listId), eq(schema.statuses.kind, "review")),
  });
  return Boolean(status);
}

async function proofCountFor(taskId: string) {
  const rows = await db
    .select({ id: schema.attachments.id })
    .from(schema.attachments)
    .where(and(eq(schema.attachments.taskId, taskId), eq(schema.attachments.isProof, true)))
    .limit(1);
  return rows.length;
}

/**
 * Throws unless `user` may move `task` from `from` to `to` — the DB-backed
 * half of checkStatusTransition (task-transition-rules.ts). Every
 * status-changing path calls this.
 */
export async function assertStatusTransition(
  user: SessionUser,
  workspaceId: string,
  task: TaskRef,
  from: StatusKind,
  to: StatusKind,
  opts?: { viaReject?: boolean },
) {
  if (from === to) return;
  const listHasReview = await listHasReviewStatus(task.listId);
  if (!listHasReview) return;

  const assigneeIds = await getAssigneeIds(task.id);
  const result = checkStatusTransition({
    from,
    to,
    listHasReview,
    isAssignee: assigneeIds.includes(user.id),
    isApprover: await isTaskApprover(user, workspaceId, task, assigneeIds),
    requiresProof: task.requiresProof,
    proofCount: to === "review" ? await proofCountFor(task.id) : 0,
    viaReject: opts?.viaReject,
  });
  if (!result.ok) throw new TRPCError({ code: result.code, message: result.message });
}

/**
 * Who hears that a task is awaiting approval: its creator and every
 * assignee's direct manager (active members only); if that's nobody, the
 * workspace's operations managers. Never the submitter themselves.
 */
export async function approverIdsToNotify(
  workspaceId: string,
  task: TaskRef,
  assigneeIds: string[],
  submitterId: string,
) {
  const managers =
    assigneeIds.length > 0
      ? await db
          .select({ managerUserId: schema.memberships.managerUserId })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.workspaceId, workspaceId),
              inArray(schema.memberships.userId, assigneeIds),
            ),
          )
      : [];
  const active = new Set(await listActiveMemberIds(workspaceId));
  const candidates = [task.createdBy, ...managers.map((m) => m.managerUserId)].filter(
    (id): id is string => !!id && id !== submitterId && active.has(id) && !assigneeIds.includes(id),
  );
  if (candidates.length > 0) return [...new Set(candidates)];
  return (await getOperationsManagerIds(workspaceId)).filter((id) => id !== submitterId);
}
