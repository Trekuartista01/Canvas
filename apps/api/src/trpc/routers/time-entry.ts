import { db, schema } from "@canvas/db";
import {
  createManualTimeEntrySchema,
  deleteTimeEntrySchema,
  listTimeEntriesForTaskSchema,
  startTimerSchema,
  timesheetSchema,
  workspaceTimesheetSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { assertCan } from "../../lib/permissions";
import { requireTask, workspaceIdForTask, spaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

function durationBetween(startedAt: Date, endedAt: Date): number {
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
}

/** Closes the caller's currently-running entry, if any (M3.7: starting a
 * new timer auto-stops the old one — see PROGRESS.md decisions). */
async function stopRunningEntry(userId: string, now: Date) {
  const running = await db.query.timeEntries.findFirst({
    where: and(eq(schema.timeEntries.userId, userId), isNull(schema.timeEntries.endedAt)),
  });
  if (!running) return null;

  const [stopped] = await db
    .update(schema.timeEntries)
    .set({ endedAt: now, durationSec: durationBetween(running.startedAt, now), updatedAt: now })
    .where(eq(schema.timeEntries.id, running.id))
    .returning();
  return stopped ?? null;
}

export const timeEntryRouter = router({
  // Not workspace-scoped: a user has at most one running entry across the
  // whole app (see stopRunningEntry), so a persistent header widget can
  // show it regardless of which workspace/list the caller is currently on.
  myRunning: protectedProcedure.query(async ({ ctx }) => {
    // Joined through to workspaceId too — the caller's running timer can
    // belong to a different workspace than whichever one they're currently
    // viewing, and the header widget links back to the task.
    const running = await db
      .select({
        id: schema.timeEntries.id,
        taskId: schema.timeEntries.taskId,
        listId: schema.tasks.listId,
        workspaceId: schema.spaces.workspaceId,
        startedAt: schema.timeEntries.startedAt,
        taskTitle: schema.tasks.title,
      })
      .from(schema.timeEntries)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(and(eq(schema.timeEntries.userId, ctx.user.id), isNull(schema.timeEntries.endedAt)));
    return running[0] ?? null;
  }),

  listForTask: protectedProcedure
    .input(listTimeEntriesForTaskSchema)
    .query(async ({ ctx, input }) => {
      const workspaceId = await workspaceIdForTask(input.taskId);
      await assertCan(ctx.user, workspaceId, "task:view", {
        spaceId: await spaceIdForTask(input.taskId),
      });

      return db
        .select({
          id: schema.timeEntries.id,
          userId: schema.timeEntries.userId,
          userName: schema.users.name,
          startedAt: schema.timeEntries.startedAt,
          endedAt: schema.timeEntries.endedAt,
          durationSec: schema.timeEntries.durationSec,
          note: schema.timeEntries.note,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId))
        .where(eq(schema.timeEntries.taskId, input.taskId))
        .orderBy(desc(schema.timeEntries.startedAt));
    }),

  start: protectedProcedure.input(startTimerSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForTask(task.id);
    await assertCan(ctx.user, workspaceId, "task:view", { spaceId: await spaceIdForTask(task.id) });

    const now = new Date();
    await stopRunningEntry(ctx.user.id, now);

    const [entry] = await db
      .insert(schema.timeEntries)
      .values({ taskId: task.id, userId: ctx.user.id, startedAt: now })
      .returning();
    if (!entry) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "time_entry", entry.id, "time_entry.started", {
      taskId: task.id,
    });
    return entry;
  }),

  stop: protectedProcedure.mutation(async ({ ctx }) => {
    const stopped = await stopRunningEntry(ctx.user.id, new Date());
    if (!stopped) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No timer is running" });
    }

    const workspaceId = await workspaceIdForTask(stopped.taskId);
    await logActivity(workspaceId, ctx.user.id, "time_entry", stopped.id, "time_entry.stopped", {
      taskId: stopped.taskId,
      durationSec: stopped.durationSec,
    });
    return stopped;
  }),

  createManual: protectedProcedure
    .input(createManualTimeEntrySchema)
    .mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForTask(task.id);
      await assertCan(ctx.user, workspaceId, "task:view", {
        spaceId: await spaceIdForTask(task.id),
      });

      const startedAt = new Date(input.startedAt);
      const endedAt = new Date(input.endedAt);

      const [entry] = await db
        .insert(schema.timeEntries)
        .values({
          taskId: task.id,
          userId: ctx.user.id,
          startedAt,
          endedAt,
          durationSec: durationBetween(startedAt, endedAt),
          note: input.note,
        })
        .returning();
      if (!entry) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(workspaceId, ctx.user.id, "time_entry", entry.id, "time_entry.logged", {
        taskId: task.id,
        durationSec: entry.durationSec,
      });
      return entry;
    }),

  delete: protectedProcedure.input(deleteTimeEntrySchema).mutation(async ({ ctx, input }) => {
    const entry = await db.query.timeEntries.findFirst({
      where: eq(schema.timeEntries.id, input.entryId),
    });
    if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
    if (entry.userId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only delete your own time entries",
      });
    }

    await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, entry.id));

    const workspaceId = await workspaceIdForTask(entry.taskId);
    await logActivity(workspaceId, ctx.user.id, "time_entry", entry.id, "time_entry.deleted", {
      taskId: entry.taskId,
    });
    return { id: entry.id };
  }),

  // The caller's own entries across the whole workspace within a date
  // range — a personal timesheet, not a team-wide view. See PROGRESS.md
  // (M3.7 decisions) for why cross-member timesheet review isn't in scope.
  timesheet: protectedProcedure.input(timesheetSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");

    const rangeStart = new Date(`${input.start}T00:00:00`);
    const rangeEnd = new Date(`${input.end}T23:59:59.999`);

    return db
      .select({
        id: schema.timeEntries.id,
        taskId: schema.timeEntries.taskId,
        taskTitle: schema.tasks.title,
        startedAt: schema.timeEntries.startedAt,
        endedAt: schema.timeEntries.endedAt,
        durationSec: schema.timeEntries.durationSec,
      })
      .from(schema.timeEntries)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.timeEntries.userId, ctx.user.id),
          eq(schema.spaces.workspaceId, input.workspaceId),
          gte(schema.timeEntries.startedAt, rangeStart),
          lte(schema.timeEntries.startedAt, rangeEnd),
        ),
      )
      .orderBy(asc(schema.timeEntries.startedAt));
  }),

  // Every member's entries across the workspace — the "Team overview" a
  // Finance Manager-style role needs (per-task hours, who logged them),
  // not just their own. A bigger blast radius than the personal timesheet
  // above, so it's gated by timeEntry:viewAll rather than task:view.
  workspaceTimesheet: protectedProcedure
    .input(workspaceTimesheetSchema)
    .query(async ({ ctx, input }) => {
      await assertCan(ctx.user, input.workspaceId, "timeEntry:viewAll");

      const rangeStart = new Date(`${input.start}T00:00:00`);
      const rangeEnd = new Date(`${input.end}T23:59:59.999`);

      return db
        .select({
          id: schema.timeEntries.id,
          userId: schema.timeEntries.userId,
          taskId: schema.timeEntries.taskId,
          taskTitle: schema.tasks.title,
          startedAt: schema.timeEntries.startedAt,
          endedAt: schema.timeEntries.endedAt,
          durationSec: schema.timeEntries.durationSec,
        })
        .from(schema.timeEntries)
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
        .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
        .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
        .where(
          and(
            eq(schema.spaces.workspaceId, input.workspaceId),
            gte(schema.timeEntries.startedAt, rangeStart),
            lte(schema.timeEntries.startedAt, rangeEnd),
          ),
        )
        .orderBy(asc(schema.timeEntries.startedAt));
    }),
});
