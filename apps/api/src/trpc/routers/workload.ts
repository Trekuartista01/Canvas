import { db, schema } from "@canvas/db";
import { workloadAssignmentsSchema, workloadSummarySchema } from "@canvas/shared";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { assertCan, visibleBoardsCondition } from "../../lib/permissions";
import { protectedProcedure, router } from "../trpc";

// Same guest-tier gate as task:view — a workload row is just a different
// arrangement of already-visible task/assignee data (M3.5/M3.7 reused
// task:view the same way instead of inventing a new permission action).
export const workloadRouter = router({
  assignments: protectedProcedure.input(workloadAssignmentsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");
    const visible = await visibleBoardsCondition(ctx.user, input.workspaceId);

    // Mirrors taskDateKey's due→start fallback (packages/shared/calendar.ts):
    // a task lands in the range if its due date is in range, or its due
    // date is unset and its start date is in range.
    const landsInRange = or(
      and(gte(schema.tasks.dueDate, input.start), lte(schema.tasks.dueDate, input.end)),
      and(
        isNull(schema.tasks.dueDate),
        gte(schema.tasks.startDate, input.start),
        lte(schema.tasks.startDate, input.end),
      ),
    );

    return db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        startDate: schema.tasks.startDate,
        userId: schema.taskAssignees.userId,
      })
      .from(schema.tasks)
      .innerJoin(schema.taskAssignees, eq(schema.taskAssignees.taskId, schema.tasks.id))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.spaces.workspaceId, input.workspaceId),
          visible,
          isNull(schema.tasks.deletedAt),
          isNull(schema.tasks.parentTaskId),
          landsInRange,
        ),
      );
  }),

  // "How many tasks does everyone currently have" — open/active assigned
  // tasks (not done/closed, not a subtask), grouped by assignee. Separate
  // from `assignments` above: that one's date-windowed for the weekly
  // grid, this one is a workspace-wide current-workload snapshot with no
  // date filter at all.
  openTaskCounts: protectedProcedure.input(workloadSummarySchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");
    const visible = await visibleBoardsCondition(ctx.user, input.workspaceId);

    const rows = await db
      .select({
        userId: schema.taskAssignees.userId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.tasks)
      .innerJoin(schema.taskAssignees, eq(schema.taskAssignees.taskId, schema.tasks.id))
      .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.spaces.workspaceId, input.workspaceId),
          visible,
          isNull(schema.tasks.deletedAt),
          isNull(schema.tasks.parentTaskId),
          inArray(schema.statuses.kind, ["open", "active"]),
        ),
      )
      .groupBy(schema.taskAssignees.userId);

    return rows;
  }),
});
