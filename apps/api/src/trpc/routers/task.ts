import { db, schema } from "@canvas/db";
import {
  addTaskDependencySchema,
  addTaskTagSchema,
  assignTaskSchema,
  bulkUpdateTasksSchema,
  clearTaskRecurrenceSchema,
  completeTaskSchema,
  createTaskSchema,
  deleteTaskSchema,
  getTaskSchema,
  listTaskDependenciesSchema,
  listTasksSchema,
  presetToRRule,
  removeTaskDependencySchema,
  removeTaskTagSchema,
  searchTasksSchema,
  setTaskRecurrenceSchema,
  taskHighlightsSchema,
  unassignTaskSchema,
  updateTaskSchema,
  type StatusKind,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, exists, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { isWithinAiQuota } from "../../lib/ai-quota";
import { runAutomationsForTrigger } from "../../lib/automation-runner";
import { embeddingQueue } from "../../queues/embedding-queue";
import { validateTaskDependency, wouldCreateCycle } from "../../lib/dependency";
import { completeTaskWithDefaultStatus } from "../../lib/task-completion";
import {
  getOperationsManagerIds,
  notifyOperationsManagers,
  notifyUsers,
  notifyWorkspace,
} from "../../lib/notify";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { computeNextRunAt } from "../../lib/recurrence";
import { publish } from "../../lib/realtime";
import { validateSubtaskParent } from "../../lib/subtask";
import {
  becameUrgent,
  buildTaskUpdateFields,
  computeCompletedAt,
  isDoneKind,
} from "../../lib/task-update";
import {
  firstStatusForList,
  lastTaskOrderKey,
  requireTask,
  spaceIdForList,
  workspaceIdForList,
} from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireStatusInList(statusId: string, listId: string) {
  const status = await db.query.statuses.findFirst({ where: eq(schema.statuses.id, statusId) });
  if (!status || status.listId !== listId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Status does not belong to this list" });
  }
  return status;
}

// Phase 6: semantic search. Fire-and-forget — the request doesn't wait on
// the embedding (it runs in embeddingWorker, see worker.ts); a title-only
// task still gets a usable, if thin, embedding.
async function enqueueTaskEmbedding(
  workspaceId: string,
  userId: string,
  task: { id: string; title: string; descriptionText: string | null },
) {
  // Best-effort: every task create/update calls this, far more often than
  // any other AI action, so a quota hit here should just skip this one
  // background embedding rather than fail the task mutation itself.
  if (!(await isWithinAiQuota(userId, "embed"))) return;

  await embeddingQueue.add("embed", {
    workspaceId,
    userId,
    entityType: "task",
    entityId: task.id,
    text: [task.title, task.descriptionText].filter(Boolean).join(" "),
  });
}

async function requireWorkspaceMember(workspaceId: string, userId: string) {
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.workspaceId, workspaceId),
      eq(schema.memberships.userId, userId),
    ),
  });
  if (!membership) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "User is not a member of this workspace" });
  }
}

async function getAssignees(taskId: string) {
  return db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.taskAssignees)
    .innerJoin(schema.users, eq(schema.users.id, schema.taskAssignees.userId))
    .where(eq(schema.taskAssignees.taskId, taskId));
}

async function requireTagInWorkspace(tagId: string, workspaceId: string) {
  const tag = await db.query.tags.findFirst({ where: eq(schema.tags.id, tagId) });
  if (!tag || tag.workspaceId !== workspaceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tag does not belong to this workspace" });
  }
  return tag;
}

async function getTags(taskId: string) {
  return db
    .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.taskTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taskTags.tagId))
    .where(eq(schema.taskTags.taskId, taskId))
    .orderBy(asc(schema.tags.name));
}

async function getSubtasks(taskId: string) {
  return db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      statusId: schema.tasks.statusId,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.parentTaskId, taskId), isNull(schema.tasks.deletedAt)))
    .orderBy(asc(schema.tasks.orderKey));
}

async function getListDependencyEdges(listId: string) {
  return db
    .select({
      id: schema.taskDependencies.id,
      taskId: schema.taskDependencies.taskId,
      dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
      kind: schema.taskDependencies.kind,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
    .where(and(eq(schema.tasks.listId, listId), isNull(schema.tasks.deletedAt)));
}

// Task-detail-panel view of a task's dependencies (M3.4): "blocked by" (this
// task depends on others) and "blocking" (others depend on this task) — the
// same edges as getListDependencyEdges, just split by direction and joined
// for display instead of cycle-check math.
async function getTaskDependencies(taskId: string) {
  const dependencyTask = {
    id: schema.tasks.id,
    title: schema.tasks.title,
    statusId: schema.tasks.statusId,
  };

  const blockedBy = await db
    .select({
      id: schema.taskDependencies.id,
      kind: schema.taskDependencies.kind,
      task: dependencyTask,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.dependsOnTaskId))
    .where(and(eq(schema.taskDependencies.taskId, taskId), isNull(schema.tasks.deletedAt)));

  const blocking = await db
    .select({
      id: schema.taskDependencies.id,
      kind: schema.taskDependencies.kind,
      task: dependencyTask,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
    .where(
      and(eq(schema.taskDependencies.dependsOnTaskId, taskId), isNull(schema.tasks.deletedAt)),
    );

  return { blockedBy, blocking };
}

export const taskRouter = router({
  list: protectedProcedure.input(listTasksSchema).query(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForList(input.listId);
    await assertCan(ctx.user, workspaceId, "task:view");

    // Subtasks are reached via their parent's detail panel, not shown as
    // their own top-level card/row here — otherwise they'd appear twice.
    return db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.listId, input.listId),
          isNull(schema.tasks.deletedAt),
          isNull(schema.tasks.parentTaskId),
        ),
      )
      .orderBy(asc(schema.tasks.orderKey));
  }),

  get: protectedProcedure.input(getTaskSchema).query(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForList(task.listId);
    await assertCan(ctx.user, workspaceId, "task:view");

    // Five independent reads with no data dependency between them — this
    // used to await them one at a time (five round trips back-to-back on
    // every task-detail-panel open); running them concurrently turns that
    // into one round trip's worth of latency.
    const [assignees, tags, subtasks, dependencies, recurrenceRule] = await Promise.all([
      getAssignees(task.id),
      getTags(task.id),
      task.parentTaskId ? Promise.resolve([]) : getSubtasks(task.id),
      getTaskDependencies(task.id),
      db.query.recurrenceRules.findFirst({ where: eq(schema.recurrenceRules.taskId, task.id) }),
    ]);
    return {
      ...task,
      assignees,
      tags,
      subtasks,
      dependencies,
      recurrenceRule: recurrenceRule ?? null,
    };
  }),

  // Workspace-wide (not scoped to one list, unlike `list` above) — the
  // point of search is finding a task without already knowing where it
  // lives. DATA_MODEL.md: "FTS: generated tsvector on tasks.title +
  // description (GIN)" (see schema/tasks.ts's searchVector column).
  search: protectedProcedure.input(searchTasksSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");

    const tsquery = sql`websearch_to_tsquery('english', ${input.query})`;
    const rank = sql<number>`ts_rank(${schema.tasks.searchVector}, ${tsquery})`;

    return db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        listId: schema.tasks.listId,
        listName: schema.lists.name,
        spaceName: schema.spaces.name,
      })
      .from(schema.tasks)
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.spaces.workspaceId, input.workspaceId),
          isNull(schema.tasks.deletedAt),
          isNull(schema.lists.deletedAt),
          isNull(schema.spaces.deletedAt),
          sql`${schema.tasks.searchVector} @@ ${tsquery}`,
        ),
      )
      .orderBy(desc(rank))
      .limit(20);
  }),

  // Backs the Home page's "Top priority"/"Recently added" sections and the
  // post-login summary panel — one round trip for both, since they're
  // always shown together. "Top priority" is urgent tasks OR tasks
  // assigned to the caller (an EXISTS subquery, not a join, so a
  // multi-assignee task doesn't come back as duplicate rows).
  highlights: protectedProcedure.input(taskHighlightsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");

    const baseSelection = {
      id: schema.tasks.id,
      title: schema.tasks.title,
      priority: schema.tasks.priority,
      listId: schema.tasks.listId,
      listName: schema.lists.name,
      spaceName: schema.spaces.name,
      createdAt: schema.tasks.createdAt,
    };

    const assignedToMe = exists(
      db
        .select({ one: sql`1` })
        .from(schema.taskAssignees)
        .where(
          and(
            eq(schema.taskAssignees.taskId, schema.tasks.id),
            eq(schema.taskAssignees.userId, ctx.user.id),
          ),
        ),
    );

    // Excludes done/closed tasks so a task the caller (or anyone else, via
    // realtime) just completed drops out instead of lingering here until
    // it ages out of "recent" — the whole point of the Home page's and the
    // login panel's quick-complete checkbox.
    const notDone = notInArray(schema.statuses.kind, ["done", "closed"]);

    const [priorityRows, recentRows] = await Promise.all([
      db
        .select(baseSelection)
        .from(schema.tasks)
        .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
        .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
        .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
        .where(
          and(
            eq(schema.spaces.workspaceId, input.workspaceId),
            isNull(schema.tasks.deletedAt),
            isNull(schema.tasks.parentTaskId),
            notDone,
            or(eq(schema.tasks.priority, "urgent"), assignedToMe),
          ),
        )
        .orderBy(desc(schema.tasks.createdAt))
        .limit(20),
      db
        .select(baseSelection)
        .from(schema.tasks)
        .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
        .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
        .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
        .where(
          and(
            eq(schema.spaces.workspaceId, input.workspaceId),
            isNull(schema.tasks.deletedAt),
            isNull(schema.tasks.parentTaskId),
            notDone,
          ),
        )
        .orderBy(desc(schema.tasks.createdAt))
        .limit(8),
    ]);

    // A task both urgent and freshly created would otherwise show up twice,
    // back to back — Recently Added only needs to surface what Top Priority
    // didn't already cover.
    const priorityIds = new Set(priorityRows.map((r) => r.id));
    const dedupedRecentRows = recentRows.filter((r) => !priorityIds.has(r.id));

    const taskIds = [...new Set([...priorityRows, ...dedupedRecentRows].map((r) => r.id))];
    const assigneeRows = taskIds.length
      ? await db
          .select({ taskId: schema.taskAssignees.taskId, userId: schema.taskAssignees.userId })
          .from(schema.taskAssignees)
          .where(inArray(schema.taskAssignees.taskId, taskIds))
      : [];
    const assigneesByTask = new Map<string, string[]>();
    for (const row of assigneeRows) {
      const list = assigneesByTask.get(row.taskId) ?? [];
      list.push(row.userId);
      assigneesByTask.set(row.taskId, list);
    }
    const withAssignees = (rows: typeof priorityRows) =>
      rows.map((row) => ({ ...row, assigneeIds: assigneesByTask.get(row.id) ?? [] }));

    return { priority: withAssignees(priorityRows), recent: withAssignees(dedupedRecentRows) };
  }),

  create: protectedProcedure.input(createTaskSchema).mutation(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForList(input.listId);
    const spaceId = await spaceIdForList(input.listId);
    await assertCan(ctx.user, workspaceId, "task:create", { spaceId });

    let parentTaskId: string | undefined;
    if (input.parentTaskId) {
      const parent = await requireTask(input.parentTaskId);
      const error = validateSubtaskParent(parent, input.listId);
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
      parentTaskId = parent.id;
    }

    const status = input.statusId
      ? await requireStatusInList(input.statusId, input.listId)
      : await firstStatusForList(input.listId);

    const lastKey = await lastTaskOrderKey(input.listId, status.id);

    const [task] = await db
      .insert(schema.tasks)
      .values({
        listId: input.listId,
        parentTaskId,
        title: input.title,
        statusId: status.id,
        orderKey: nextOrderKey(lastKey),
        createdBy: ctx.user.id,
        completedAt: computeCompletedAt(status.kind, null, new Date()),
      })
      .returning();
    if (!task) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.created");
    await enqueueTaskEmbedding(workspaceId, ctx.user.id, task);
    // Runs before publish() so that by the time the realtime "task
    // updated" invalidation reaches any open client, an automation's own
    // side effects (tag/comment/priority) have already landed — there's no
    // second event to catch a client up if it refetched mid-run.
    await runAutomationsForTrigger(workspaceId, { type: "task_created" }, task);
    await publish(workspaceId, {
      entity: "task",
      id: task.id,
      listId: task.listId,
      kind: "created",
    });
    return task;
  }),

  update: protectedProcedure.input(updateTaskSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForList(task.listId);
    const spaceId = await spaceIdForList(task.listId);
    await assertCan(ctx.user, workspaceId, "task:update", { spaceId });

    let statusId: string | undefined;
    let newStatusKind: StatusKind | undefined;
    let completedAt: Date | null | undefined;
    // Only set when the status is actually changing — used below to notify
    // Operations Managers on the transition INTO done/closed, not on every
    // save of a task that was already there (e.g. done -> closed).
    let justCompleted = false;
    if (input.statusId !== undefined && input.statusId !== task.statusId) {
      const status = await requireStatusInList(input.statusId, task.listId);
      statusId = status.id;
      newStatusKind = status.kind;
      completedAt = computeCompletedAt(status.kind, task.completedAt, new Date());

      const previousStatus = await db.query.statuses.findFirst({
        where: eq(schema.statuses.id, task.statusId),
      });
      justCompleted = isDoneKind(status.kind) && !isDoneKind(previousStatus?.kind ?? "open");
    }

    // An explicit orderKey (e.g. from a board drag-and-drop drop) wins; a
    // bare status change with no position given appends to the column's end.
    const orderKey =
      input.orderKey ??
      (statusId !== undefined
        ? nextOrderKey(await lastTaskOrderKey(task.listId, statusId))
        : undefined);

    const [updated] = await db
      .update(schema.tasks)
      .set({
        ...buildTaskUpdateFields({
          title: input.title,
          statusId,
          orderKey,
          descriptionJson: input.descriptionJson,
          priority: input.priority,
          startDate: input.startDate,
          dueDate: input.dueDate,
          isMilestone: input.isMilestone,
          completedAt,
        }),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, input.taskId))
      .returning();
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.updated");
    if (justCompleted) {
      const completedActivity = await logActivity(
        workspaceId,
        ctx.user.id,
        "task",
        task.id,
        "task.completed",
        { taskId: task.id, listId: task.listId, title: updated.title },
      );
      await notifyOperationsManagers(completedActivity.id, workspaceId);
    }
    if (becameUrgent(task.priority, input.priority)) {
      const urgentActivity = await logActivity(
        workspaceId,
        ctx.user.id,
        "task",
        task.id,
        "task.priority_urgent",
        { taskId: task.id, listId: task.listId, title: updated.title },
      );
      await notifyWorkspace(urgentActivity.id, workspaceId, ctx.user.id);
    }
    if (input.title !== undefined || input.descriptionJson !== undefined) {
      await enqueueTaskEmbedding(workspaceId, ctx.user.id, updated);
    }
    if (newStatusKind !== undefined) {
      await runAutomationsForTrigger(
        workspaceId,
        { type: "task_status_changed", toStatusKind: newStatusKind },
        updated,
      );
    }
    await publish(workspaceId, {
      entity: "task",
      id: task.id,
      listId: task.listId,
      kind: "updated",
    });
    return updated;
  }),

  // Marks a task done via its list's own default done status — the Home
  // page's quick-complete checkbox, which doesn't offer a status picker.
  // `update` (above) stays the path for choosing a specific status.
  complete: protectedProcedure.input(completeTaskSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForList(task.listId);
    const spaceId = await spaceIdForList(task.listId);
    await assertCan(ctx.user, workspaceId, "task:update", { spaceId });
    return completeTaskWithDefaultStatus(input.taskId, ctx.user.id);
  }),

  bulkUpdate: protectedProcedure.input(bulkUpdateTasksSchema).mutation(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForList(input.listId);
    await assertCan(ctx.user, workspaceId, "task:update");

    let newStatusKind: StatusKind | undefined;
    if (input.statusId !== undefined) {
      const status = await requireStatusInList(input.statusId, input.listId);
      newStatusKind = status.kind;
    }

    const rows = await db
      .select({
        id: schema.tasks.id,
        statusId: schema.tasks.statusId,
        title: schema.tasks.title,
        priority: schema.tasks.priority,
        completedAt: schema.tasks.completedAt,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.listId, input.listId),
          inArray(schema.tasks.id, input.taskIds),
          isNull(schema.tasks.deletedAt),
        ),
      );

    if (rows.length !== input.taskIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more tasks were not found in this list",
      });
    }

    // Every status a row might currently be in, so each row's own
    // transition-into-done can be detected below without a query per row.
    const statusKindById = new Map(
      (await db.query.statuses.findMany({ where: eq(schema.statuses.listId, input.listId) })).map(
        (s) => [s.id, s.kind] as const,
      ),
    );

    // Status changes append each task to the end of the new column so we
    // don't invent a shared orderKey for the whole selection.
    let orderKeyByTaskId: Map<string, string> | undefined;
    if (input.statusId !== undefined) {
      orderKeyByTaskId = new Map();
      let lastKey = await lastTaskOrderKey(input.listId, input.statusId);
      for (const row of rows) {
        if (row.statusId === input.statusId) continue;
        lastKey = nextOrderKey(lastKey);
        orderKeyByTaskId.set(row.id, lastKey);
      }
    }

    // Resolved lazily (only if some row actually completes below) and
    // cached for the rest of the loop — every completed row in this batch
    // shares the same workspace, so the manager list is the same for all.
    let managerIds: string[] | undefined;

    const updatedAt = new Date();
    for (const row of rows) {
      const orderKey = orderKeyByTaskId?.get(row.id);
      const statusChanged = input.statusId !== undefined && row.statusId !== input.statusId;
      await db
        .update(schema.tasks)
        .set({
          ...buildTaskUpdateFields({
            statusId: statusChanged ? input.statusId : undefined,
            orderKey,
            priority: input.priority,
            startDate: input.startDate,
            dueDate: input.dueDate,
            completedAt:
              statusChanged && newStatusKind !== undefined
                ? computeCompletedAt(newStatusKind, row.completedAt, updatedAt)
                : undefined,
          }),
          updatedAt,
        })
        .where(eq(schema.tasks.id, row.id));
      // Same per-task "task.updated" row a single task.update call writes —
      // without this, a task edited via bulk update never shows the edit in
      // its own activity feed (activity.list is scoped to entityType="task").
      await logActivity(workspaceId, ctx.user.id, "task", row.id, "task.updated");
      if (statusChanged && newStatusKind !== undefined) {
        await runAutomationsForTrigger(
          workspaceId,
          { type: "task_status_changed", toStatusKind: newStatusKind },
          {
            id: row.id,
            listId: input.listId,
            title: row.title,
            priority: input.priority !== undefined ? input.priority : row.priority,
          },
        );
        if (isDoneKind(newStatusKind) && !isDoneKind(statusKindById.get(row.statusId) ?? "open")) {
          const completedActivity = await logActivity(
            workspaceId,
            ctx.user.id,
            "task",
            row.id,
            "task.completed",
            { taskId: row.id, listId: input.listId, title: row.title },
          );
          managerIds ??= await getOperationsManagerIds(workspaceId);
          await notifyUsers(completedActivity.id, managerIds);
        }
      }
      await publish(workspaceId, {
        entity: "task",
        id: row.id,
        listId: input.listId,
        kind: "updated",
      });
    }

    await logActivity(workspaceId, ctx.user.id, "list", input.listId, "task.bulk_updated", {
      taskIds: input.taskIds,
      statusId: input.statusId,
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
    });

    return { updated: rows.length };
  }),

  delete: protectedProcedure.input(deleteTaskSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForList(task.listId);
    const spaceId = await spaceIdForList(task.listId);
    await assertCan(ctx.user, workspaceId, "task:delete", { spaceId });

    const deletedAt = new Date();
    await db.update(schema.tasks).set({ deletedAt }).where(eq(schema.tasks.id, task.id));
    // Cascade the soft delete to subtasks — a deleted parent's subtasks
    // would otherwise become permanently unreachable (excluded from
    // task.list, but their parent's detail panel can no longer be opened).
    await db
      .update(schema.tasks)
      .set({ deletedAt })
      .where(and(eq(schema.tasks.parentTaskId, task.id), isNull(schema.tasks.deletedAt)));

    await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.deleted");
    await publish(workspaceId, {
      entity: "task",
      id: task.id,
      listId: task.listId,
      kind: "deleted",
    });
    return { id: task.id };
  }),

  assignees: router({
    add: protectedProcedure.input(assignTaskSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");
      await requireWorkspaceMember(workspaceId, input.userId);

      await db
        .insert(schema.taskAssignees)
        .values({ taskId: task.id, userId: input.userId })
        .onConflictDoNothing();

      const activityRow = await logActivity(
        workspaceId,
        ctx.user.id,
        "task",
        task.id,
        "task.assigned",
        { taskId: task.id, listId: task.listId },
      );
      if (input.userId !== ctx.user.id) {
        await notifyUsers(activityRow.id, [input.userId]);
      }
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return getAssignees(task.id);
    }),

    remove: protectedProcedure.input(unassignTaskSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");

      await db
        .delete(schema.taskAssignees)
        .where(
          and(
            eq(schema.taskAssignees.taskId, task.id),
            eq(schema.taskAssignees.userId, input.userId),
          ),
        );

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.unassigned");
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return getAssignees(task.id);
    }),
  }),

  tags: router({
    add: protectedProcedure.input(addTaskTagSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");
      await requireTagInWorkspace(input.tagId, workspaceId);

      await db
        .insert(schema.taskTags)
        .values({ taskId: task.id, tagId: input.tagId })
        .onConflictDoNothing();

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.tagged");
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return getTags(task.id);
    }),

    remove: protectedProcedure.input(removeTaskTagSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");

      await db
        .delete(schema.taskTags)
        .where(and(eq(schema.taskTags.taskId, task.id), eq(schema.taskTags.tagId, input.tagId)));

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.untagged");
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return getTags(task.id);
    }),
  }),

  // Gantt arrows (M3.3). Same task:view/task:update tiers as
  // assignees/tags above — a dependency is a relationship between two
  // tasks the caller can already see/edit, not a distinct permission.
  dependencies: router({
    list: protectedProcedure.input(listTaskDependenciesSchema).query(async ({ ctx, input }) => {
      const workspaceId = await workspaceIdForList(input.listId);
      await assertCan(ctx.user, workspaceId, "task:view");

      return getListDependencyEdges(input.listId);
    }),

    add: protectedProcedure.input(addTaskDependencySchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const dependsOnTask = await requireTask(input.dependsOnTaskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");

      const error = validateTaskDependency(task, dependsOnTask);
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });

      const existingEdges = await getListDependencyEdges(task.listId);
      if (wouldCreateCycle(existingEdges, { taskId: task.id, dependsOnTaskId: dependsOnTask.id })) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That would create a dependency cycle",
        });
      }

      const [dependency] = await db
        .insert(schema.taskDependencies)
        .values({ taskId: task.id, dependsOnTaskId: dependsOnTask.id, kind: input.kind })
        .onConflictDoNothing()
        .returning();
      if (!dependency) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That dependency already exists" });
      }

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.dependency_added", {
        dependsOnTaskId: dependsOnTask.id,
        kind: input.kind,
      });
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return dependency;
    }),

    remove: protectedProcedure
      .input(removeTaskDependencySchema)
      .mutation(async ({ ctx, input }) => {
        const dependency = await db.query.taskDependencies.findFirst({
          where: eq(schema.taskDependencies.id, input.dependencyId),
        });
        if (!dependency) throw new TRPCError({ code: "NOT_FOUND" });

        const task = await requireTask(dependency.taskId);
        const workspaceId = await workspaceIdForList(task.listId);
        await assertCan(ctx.user, workspaceId, "task:update");

        await db
          .delete(schema.taskDependencies)
          .where(eq(schema.taskDependencies.id, dependency.id));

        await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.dependency_removed", {
          dependsOnTaskId: dependency.dependsOnTaskId,
        });
        await publish(workspaceId, {
          entity: "task",
          id: task.id,
          listId: task.listId,
          kind: "updated",
        });
        return { id: dependency.id };
      }),
  }),

  // Recurring tasks (M3.5). The rule lives on the "template" task; the
  // scheduler worker (apps/api/src/lib/scheduler.ts) spawns fresh tasks
  // from it and advances nextRunAt — see PROGRESS.md.
  recurrence: router({
    set: protectedProcedure.input(setTaskRecurrenceSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");

      const rrule = presetToRRule(input.preset);
      const now = new Date();
      const nextRunAt = computeNextRunAt(rrule, now) ?? now;

      const [rule] = await db
        .insert(schema.recurrenceRules)
        .values({ taskId: task.id, rrule, nextRunAt })
        .onConflictDoUpdate({
          target: schema.recurrenceRules.taskId,
          set: { rrule, nextRunAt, updatedAt: now },
        })
        .returning();
      if (!rule) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.recurrence_set", {
        preset: input.preset,
      });
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return rule;
    }),

    clear: protectedProcedure.input(clearTaskRecurrenceSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "task:update");

      await db.delete(schema.recurrenceRules).where(eq(schema.recurrenceRules.taskId, task.id));

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.recurrence_cleared");
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return { taskId: task.id };
    }),
  }),
});
