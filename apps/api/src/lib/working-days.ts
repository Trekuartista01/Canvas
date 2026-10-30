import { db, schema } from "@canvas/db";
import {
  countWorkingDays as countWorkingDaysPure,
  isWorkingDay as isWorkingDayPure,
  KOSOVO_FIXED_HOLIDAYS,
  makeHolidayChecker,
  type HolidayRow,
} from "@canvas/shared";
import { and, eq, isNull } from "drizzle-orm";

/**
 * M7.4: working days for one workspace — Mon–Fri minus its public holidays
 * (and their observed substitutes). The calendar logic is pure
 * (packages/shared/src/holidays.ts); this only loads the rows. Leave (M7.5)
 * counts days with countWorkingDays.
 */
export async function loadHolidayRows(workspaceId: string): Promise<HolidayRow[]> {
  return db
    .select({
      id: schema.publicHolidays.id,
      name: schema.publicHolidays.name,
      date: schema.publicHolidays.date,
      observedDate: schema.publicHolidays.observedDate,
      isRecurringFixed: schema.publicHolidays.isRecurringFixed,
    })
    .from(schema.publicHolidays)
    .where(
      and(
        eq(schema.publicHolidays.workspaceId, workspaceId),
        isNull(schema.publicHolidays.deletedAt),
      ),
    );
}

export async function loadHolidayChecker(workspaceId: string) {
  return makeHolidayChecker(await loadHolidayRows(workspaceId));
}

export async function isWorkingDay(workspaceId: string, date: string) {
  return isWorkingDayPure(date, await loadHolidayChecker(workspaceId));
}

/** Inclusive of both ends. */
export async function countWorkingDays(workspaceId: string, from: string, to: string) {
  return countWorkingDaysPure(from, to, await loadHolidayChecker(workspaceId));
}

/**
 * Seeds Kosovo's fixed-date holidays once per workspace (marked by
 * workspaces.holidays_seeded_at, so a calendar HR emptied on purpose stays
 * empty). Called on workspace creation and by the scheduler tick, which
 * backfills workspaces that existed before M7.4.
 */
export async function seedFixedHolidays(workspaceId: string, anchorYear: number) {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.workspaces)
      .set({ holidaysSeededAt: new Date() })
      .where(and(eq(schema.workspaces.id, workspaceId), isNull(schema.workspaces.holidaysSeededAt)))
      .returning({ id: schema.workspaces.id });
    if (claimed.length === 0) return;
    await tx.insert(schema.publicHolidays).values(
      KOSOVO_FIXED_HOLIDAYS.map((h) => ({
        workspaceId,
        name: h.name,
        date: `${anchorYear}-${h.monthDay}`,
        isRecurringFixed: true,
      })),
    );
  });
}

export async function seedMissingHolidayCalendars(anchorYear: number) {
  const unseeded = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(isNull(schema.workspaces.holidaysSeededAt));
  for (const workspace of unseeded) await seedFixedHolidays(workspace.id, anchorYear);
}
