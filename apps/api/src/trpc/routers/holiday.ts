import { db, schema } from "@canvas/db";
import {
  createHolidaySchema,
  expandHolidays,
  hasMovableHolidays,
  holidayIdSchema,
  listHolidaysSchema,
  setHolidayNoticeDaysSchema,
  updateHolidaySchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { assertCanPeople, canPeopleAction, requireActiveMember } from "../../lib/permissions";
import { loadHolidayRows } from "../../lib/working-days";
import { protectedProcedure, router } from "../trpc";

async function requireHoliday(holidayId: string) {
  const holiday = await db.query.publicHolidays.findFirst({
    where: and(eq(schema.publicHolidays.id, holidayId), isNull(schema.publicHolidays.deletedAt)),
  });
  if (!holiday) throw new TRPCError({ code: "NOT_FOUND" });
  return holiday;
}

// A recurring fixed-date holiday's observed day differs each year, so it's
// always by the rule — the override is for one-off (movable) entries only.
function assertObservedOverride(
  isRecurringFixed: boolean,
  observedDate: string | null | undefined,
) {
  if (isRecurringFixed && observedDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recurring holidays always follow the weekend rule",
    });
  }
}

export const holidayRouter = router({
  // Everyone sees the calendar; HR (holiday:manage) also gets the edit controls.
  list: protectedProcedure.input(listHolidaysSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const [rows, workspace, canManage] = await Promise.all([
      loadHolidayRows(input.workspaceId),
      db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, input.workspaceId) }),
      canPeopleAction(ctx.user, input.workspaceId, "holiday:manage"),
    ]);
    const rowById = new Map(rows.map((r) => [r.id, r]));
    return {
      year: input.year,
      holidays: expandHolidays(rows, input.year).map((o) => ({
        ...o,
        // What HR edits: the stored date (a recurring row's anchor year is
        // irrelevant) and the explicit override, if any.
        observedOverride: rowById.get(o.id)?.observedDate ?? null,
      })),
      hasMovableHolidays: hasMovableHolidays(rows, input.year),
      noticeDays: workspace?.holidayNoticeDays ?? 2,
      canManage,
    };
  }),

  create: protectedProcedure.input(createHolidaySchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "holiday:manage");
    assertObservedOverride(input.isRecurringFixed, input.observedDate);
    const [holiday] = await db
      .insert(schema.publicHolidays)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        date: input.date,
        isRecurringFixed: input.isRecurringFixed,
        observedDate: input.observedDate ?? null,
        createdBy: ctx.user.id,
      })
      .returning();
    if (!holiday) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(input.workspaceId, ctx.user.id, "holiday", holiday.id, "holiday.created", {
      name: holiday.name,
      date: holiday.date,
    });
    return holiday;
  }),

  update: protectedProcedure.input(updateHolidaySchema).mutation(async ({ ctx, input }) => {
    const existing = await requireHoliday(input.holidayId);
    await assertCanPeople(ctx.user, existing.workspaceId, "holiday:manage");
    const isRecurringFixed = input.isRecurringFixed ?? existing.isRecurringFixed;
    const observedDate =
      input.observedDate !== undefined ? input.observedDate : existing.observedDate;
    assertObservedOverride(isRecurringFixed, observedDate);

    const [holiday] = await db
      .update(schema.publicHolidays)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        isRecurringFixed,
        observedDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.publicHolidays.id, existing.id))
      .returning();
    if (!holiday) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(existing.workspaceId, ctx.user.id, "holiday", holiday.id, "holiday.updated", {
      name: holiday.name,
      date: holiday.date,
    });
    return holiday;
  }),

  delete: protectedProcedure.input(holidayIdSchema).mutation(async ({ ctx, input }) => {
    const existing = await requireHoliday(input.holidayId);
    await assertCanPeople(ctx.user, existing.workspaceId, "holiday:manage");
    await db
      .update(schema.publicHolidays)
      .set({ deletedAt: new Date() })
      .where(eq(schema.publicHolidays.id, existing.id));
    await logActivity(
      existing.workspaceId,
      ctx.user.id,
      "holiday",
      existing.id,
      "holiday.deleted",
      {
        name: existing.name,
        date: existing.date,
      },
    );
    return { id: existing.id };
  }),

  setNoticeDays: protectedProcedure
    .input(setHolidayNoticeDaysSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "holiday:manage");
      await db
        .update(schema.workspaces)
        .set({ holidayNoticeDays: input.days })
        .where(eq(schema.workspaces.id, input.workspaceId));
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "workspace",
        input.workspaceId,
        "workspace.holiday_notice_days_changed",
        { days: input.days },
      );
      return { days: input.days };
    }),
});
