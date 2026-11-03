import { db, schema } from "@canvas/db";
import {
  countWorkingDays as countWorkingDaysPure,
  holidayCalendar,
  nextWorkingDay as nextWorkingDayPure,
  officialHolidays,
  previousWorkingDay as previousWorkingDayPure,
  todayReportDate,
  type HolidayCalendar,
} from "@canvas/shared";
import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";

/**
 * P8.2: the workspace side of the Kosovo working-day calculator. The logic is
 * pure (packages/shared/src/working-days.ts); this only loads the
 * workspace's holiday rows, each one a concrete day off. Every leave feature
 * counts days through here — nowhere else.
 */
export async function loadHolidayRows(workspaceId: string, year?: number) {
  return db
    .select({
      id: schema.publicHolidays.id,
      date: schema.publicHolidays.date,
      year: schema.publicHolidays.year,
      nameSq: schema.publicHolidays.nameSq,
      nameEn: schema.publicHolidays.nameEn,
      isObservedSubstitute: schema.publicHolidays.isObservedSubstitute,
    })
    .from(schema.publicHolidays)
    .where(
      and(
        eq(schema.publicHolidays.workspaceId, workspaceId),
        isNull(schema.publicHolidays.deletedAt),
        year === undefined ? undefined : eq(schema.publicHolidays.year, year),
      ),
    )
    .orderBy(schema.publicHolidays.date, schema.publicHolidays.nameEn);
}

export async function loadHolidayCalendar(workspaceId: string): Promise<HolidayCalendar> {
  const rows = await loadHolidayRows(workspaceId);
  return holidayCalendar(rows.map((r) => ({ date: r.date, name: r.nameEn })));
}

/** `isHoliday(date)` for callers that only need yes/no (daily-report reminders). */
export async function loadHolidayChecker(workspaceId: string) {
  const calendar = await loadHolidayCalendar(workspaceId);
  return (date: string) => calendar.has(date);
}

/** Inclusive of both ends; see the shared module for the shape. */
export async function countWorkingDays(workspaceId: string, start: string, end: string) {
  return countWorkingDaysPure(start, end, await loadHolidayCalendar(workspaceId));
}

export async function nextWorkingDay(workspaceId: string, date: string) {
  return nextWorkingDayPure(date, await loadHolidayCalendar(workspaceId));
}

export async function previousWorkingDay(workspaceId: string, date: string) {
  return previousWorkingDayPure(date, await loadHolidayCalendar(workspaceId));
}

const EID_NAME = /eid|bajram/i;

/**
 * Seeds one year of Kosovo official holidays for a workspace, once
 * (public_holiday_years is the claim, so rows HR deleted never come back).
 * A day that already has a live row is skipped — so the M7.4 rows migration
 * 0065 turned into concrete days aren't duplicated — and so are the Eid
 * estimates when HR already entered an Eid for that year.
 */
export async function seedOfficialHolidays(workspaceId: string, year: number) {
  await db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(schema.publicHolidayYears)
      .values({ workspaceId, year, seededAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.publicHolidayYears.workspaceId, schema.publicHolidayYears.year],
        set: { seededAt: new Date() },
        setWhere: isNull(schema.publicHolidayYears.seededAt),
      })
      .returning({ id: schema.publicHolidayYears.id });
    if (!claim) return;

    const workspace = await tx.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, workspaceId),
      columns: { holidayWeekendSubstitution: true },
    });
    const existing = await tx
      .select({ date: schema.publicHolidays.date, nameEn: schema.publicHolidays.nameEn })
      .from(schema.publicHolidays)
      .where(
        and(
          eq(schema.publicHolidays.workspaceId, workspaceId),
          eq(schema.publicHolidays.year, year),
          isNull(schema.publicHolidays.deletedAt),
        ),
      );
    const taken = new Set(existing.map((r) => r.date));
    const hasEid = existing.some((r) => EID_NAME.test(r.nameEn));

    const rows = officialHolidays(year, {
      substitution: workspace?.holidayWeekendSubstitution ?? true,
    }).filter((h) => !taken.has(h.date) && !(hasEid && EID_NAME.test(h.nameEn)));
    if (rows.length === 0) return;
    await tx.insert(schema.publicHolidays).values(rows.map((h) => ({ workspaceId, year, ...h })));
  });
}

/** This year and next, for every workspace that doesn't have them yet (scheduler tick). */
export async function seedMissingHolidayYears(now = new Date()) {
  const year = Number(todayReportDate(now).slice(0, 4));
  const years = [year, year + 1];
  const [workspaces, seeded] = await Promise.all([
    db.select({ id: schema.workspaces.id }).from(schema.workspaces),
    db
      .select({
        workspaceId: schema.publicHolidayYears.workspaceId,
        year: schema.publicHolidayYears.year,
      })
      .from(schema.publicHolidayYears)
      .where(
        and(
          inArray(schema.publicHolidayYears.year, years),
          isNotNull(schema.publicHolidayYears.seededAt),
        ),
      ),
  ]);
  const done = new Set(seeded.map((s) => `${s.workspaceId}:${s.year}`));
  for (const w of workspaces) {
    for (const y of years) {
      if (!done.has(`${w.id}:${y}`)) await seedOfficialHolidays(w.id, y);
    }
  }
}

/**
 * HR's weekend-substitution switch. On: adds the missing substitute days for
 * every seeded year from this one on. Off: removes the substitute rows from
 * today on (past ones stay — leave was already counted with them). Returns
 * how many rows were added or removed.
 */
export async function applyWeekendSubstitution(
  workspaceId: string,
  enabled: boolean,
  now = new Date(),
) {
  const today = todayReportDate(now);
  const thisYear = Number(today.slice(0, 4));
  return db.transaction(async (tx) => {
    await tx
      .update(schema.workspaces)
      .set({ holidayWeekendSubstitution: enabled })
      .where(eq(schema.workspaces.id, workspaceId));

    if (!enabled) {
      const removed = await tx
        .update(schema.publicHolidays)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.publicHolidays.workspaceId, workspaceId),
            eq(schema.publicHolidays.isObservedSubstitute, true),
            gte(schema.publicHolidays.date, today),
            isNull(schema.publicHolidays.deletedAt),
          ),
        )
        .returning({ id: schema.publicHolidays.id });
      return removed.length;
    }

    const years = await tx
      .select({ year: schema.publicHolidayYears.year })
      .from(schema.publicHolidayYears)
      .where(
        and(
          eq(schema.publicHolidayYears.workspaceId, workspaceId),
          gte(schema.publicHolidayYears.year, thisYear),
        ),
      );
    let added = 0;
    for (const { year } of years) {
      const existing = await tx
        .select({ date: schema.publicHolidays.date })
        .from(schema.publicHolidays)
        .where(
          and(
            eq(schema.publicHolidays.workspaceId, workspaceId),
            eq(schema.publicHolidays.year, year),
            isNull(schema.publicHolidays.deletedAt),
          ),
        );
      const taken = new Set(existing.map((r) => r.date));
      const substitutes = officialHolidays(year, { substitution: true }).filter(
        (h) => h.isObservedSubstitute && h.date >= today && !taken.has(h.date),
      );
      if (substitutes.length === 0) continue;
      await tx
        .insert(schema.publicHolidays)
        .values(substitutes.map((h) => ({ workspaceId, year, ...h })));
      added += substitutes.length;
    }
    return added;
  });
}
