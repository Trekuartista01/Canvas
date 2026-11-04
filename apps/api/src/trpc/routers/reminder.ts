import { db, schema } from "@canvas/db";
import { createReminderSchema, dismissReminderSchema } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { assertCan } from "../../lib/permissions";
import { requireTask, workspaceIdForTask, spaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

// Reminders are personal (DATA_MODEL.md: user_id fk, no workspace_id at
// all) — list/dismiss are scoped strictly to the requesting user's own
// rows, same reasoning as notification.ts, no assertCan needed there.
export const reminderRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: schema.reminders.id,
        taskId: schema.reminders.taskId,
        remindAt: schema.reminders.remindAt,
        note: schema.reminders.note,
        doneAt: schema.reminders.doneAt,
        taskTitle: schema.tasks.title,
      })
      .from(schema.reminders)
      .leftJoin(schema.tasks, eq(schema.tasks.id, schema.reminders.taskId))
      .where(and(eq(schema.reminders.userId, ctx.user.id), isNull(schema.reminders.doneAt)))
      .orderBy(asc(schema.reminders.remindAt));
  }),

  create: protectedProcedure.input(createReminderSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForTask(task.id);
    await assertCan(ctx.user, workspaceId, "task:view", { spaceId: await spaceIdForTask(task.id) });

    const [reminder] = await db
      .insert(schema.reminders)
      .values({
        userId: ctx.user.id,
        taskId: task.id,
        // A bare "YYYY-MM-DDTHH:mm" local string (see schema comment) is
        // parsed as the server's local time, matching this app's date
        // handling elsewhere.
        remindAt: new Date(input.remindAt),
        note: input.note,
      })
      .returning();
    if (!reminder) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return reminder;
  }),

  dismiss: protectedProcedure.input(dismissReminderSchema).mutation(async ({ ctx, input }) => {
    const [updated] = await db
      .update(schema.reminders)
      .set({ doneAt: new Date() })
      .where(
        and(eq(schema.reminders.id, input.reminderId), eq(schema.reminders.userId, ctx.user.id)),
      )
      .returning();
    if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
    return updated;
  }),
});
