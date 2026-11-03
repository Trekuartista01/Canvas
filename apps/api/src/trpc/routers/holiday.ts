import { db, schema } from "@canvas/db";
import {
  createHolidaySchema,
  holidayIdSchema,
  holidayReminderSchema,
  isWeekend,
  listHolidaysSchema,
  needsDateConfirmation,
  setHolidayNoticeDaysSchema,
  setHolidayWeekendSubstitutionSchema,
  updateHolidaySchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { holidaysMissingNextYear } from "../../lib/holiday-notices";
import { assertCanPeople, canPeopleAction, requireActiveMember } from "../../lib/permissions";
import { applyWeekendSubstitution, loadHolidayRows } from "../../lib/working-days";
import { protectedProcedure, router } from "../trpc";

async function requireHoliday(holidayId: string) {
  const holiday = await db.query.publicHolidays.findFirst({
    where: and(eq(schema.publicHolidays.id, holidayId), isNull(schema.publicHolidays.deletedAt)),
  });
  if (!holiday) throw new TRPCError({ code: "NOT_FOUND" });
  return holiday;
}

const yearOf = (date: string) => Number(date.slice(0, 4));

// P8.2 official holidays. Everyone reads the calendar; only HR
// (holiday:manage) changes it — from Leave approvals → Official holidays.
export const holidayRouter = router({
  list: protectedProcedure.input(listHolidaysSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const [rows, workspace, canManage] = await Promise.all([
      loadHolidayRows(input.workspaceId, input.year),
      db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, input.workspaceId) }),
      canPeopleAction(ctx.user, input.workspaceId, "holiday:manage"),
    ]);
    return {
      year: input.year,
      holidays: rows.map((r) => ({
        ...r,
        onWeekend: isWeekend(r.date),
        needsConfirmation: needsDateConfirmation(r),
      })),
      noticeDays: workspace?.holidayNoticeDays ?? 2,
      weekendSubstitution: workspace?.holidayWeekendSubstitution ?? true,
      canManage,
    };
  }),

  // HR's Home banner in December: "Add next year's official holidays".
  reminder: protectedProcedure.input(holidayReminderSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    if (!(await canPeopleAction(ctx.user, input.workspaceId, "holiday:manage"))) {
      return { missing: false, year: null };
    }
    return holidaysMissingNextYear(input.workspaceId);
  }),

  create: protectedProcedure.input(createHolidaySchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "holiday:manage");
    const [holiday] = await db
      .insert(schema.publicHolidays)
      .values({
        workspaceId: input.workspaceId,
        date: input.date,
        year: yearOf(input.date),
        nameSq: input.nameSq,
        nameEn: input.nameEn,
        isObservedSubstitute: input.isObservedSubstitute,
        createdBy: ctx.user.id,
      })
      .returning();
    if (!holiday) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(input.workspaceId, ctx.user.id, "holiday", holiday.id, "holiday.created", {
      name: holiday.nameEn,
      date: holiday.date,
    });
    return holiday;
  }),

  update: protectedProcedure.input(updateHolidaySchema).mutation(async ({ ctx, input }) => {
    const existing = await requireHoliday(input.holidayId);
    await assertCanPeople(ctx.user, existing.workspaceId, "holiday:manage");
    const [holiday] = await db
      .update(schema.publicHolidays)
      .set({
        ...(input.date !== undefined ? { date: input.date, year: yearOf(input.date) } : {}),
        ...(input.nameSq !== undefined ? { nameSq: input.nameSq } : {}),
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
        ...(input.isObservedSubstitute !== undefined
          ? { isObservedSubstitute: input.isObservedSubstitute }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.publicHolidays.id, existing.id))
      .returning();
    if (!holiday) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(existing.workspaceId, ctx.user.id, "holiday", holiday.id, "holiday.updated", {
      name: holiday.nameEn,
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
      { name: existing.nameEn, date: existing.date },
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

  setWeekendSubstitution: protectedProcedure
    .input(setHolidayWeekendSubstitutionSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "holiday:manage");
      const changed = await applyWeekendSubstitution(input.workspaceId, input.enabled);
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "workspace",
        input.workspaceId,
        "workspace.holiday_weekend_substitution_changed",
        { enabled: input.enabled, changedDays: changed },
      );
      return { enabled: input.enabled, changedDays: changed };
    }),
});
