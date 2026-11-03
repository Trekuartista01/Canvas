// P8.2 Kosovo working-day calculator (docs/hr-ops-spec.md §2). The ONLY place
// leave days are counted: the API wraps it with the workspace's holiday rows
// (apps/api/src/lib/working-days.ts) and the browser gets its answers through
// `leave.preview`. Dates are "YYYY-MM-DD" Kosovo calendar dates — no times,
// so midnight and daylight saving can't shift a day.

import { addDays, isWeekend } from "./holidays";

/** date → holiday name. Each entry is one non-working day. */
export type HolidayCalendar = ReadonlyMap<string, string>;

export function holidayCalendar(rows: { date: string; name: string }[]): HolidayCalendar {
  const map = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
    map.set(r.date, map.has(r.date) ? `${map.get(r.date)} / ${r.name}` : r.name);
  }
  return map;
}

export function isWorkingDayIn(date: string, holidays: HolidayCalendar): boolean {
  return !isWeekend(date) && !holidays.has(date);
}

export interface WorkingDayCount {
  total: number;
  /** Working days per calendar year — a cross-year request uses each year's balance. */
  byYear: Record<number, number>;
  /** Holidays on weekdays inside the range (a holiday on a weekend is just a weekend day). */
  excludedHolidays: { date: string; name: string }[];
  excludedWeekendDays: number;
}

/** Working days from `start` to `end`, both inclusive; all zero if `end` is before `start`. */
export function countWorkingDays(
  start: string,
  end: string,
  holidays: HolidayCalendar,
): WorkingDayCount {
  const result: WorkingDayCount = {
    total: 0,
    byYear: {},
    excludedHolidays: [],
    excludedWeekendDays: 0,
  };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWeekend(d)) {
      result.excludedWeekendDays++;
      continue;
    }
    const holiday = holidays.get(d);
    if (holiday !== undefined) {
      result.excludedHolidays.push({ date: d, name: holiday });
      continue;
    }
    const year = Number(d.slice(0, 4));
    result.byYear[year] = (result.byYear[year] ?? 0) + 1;
    result.total++;
  }
  return result;
}

/** First working day after `date` — the return-to-work date after leave ending on `date`. */
export function nextWorkingDay(date: string, holidays: HolidayCalendar): string {
  let d = addDays(date, 1);
  while (!isWorkingDayIn(d, holidays)) d = addDays(d, 1);
  return d;
}

/** Last working day before `date` — when the contract-ending alert goes out. */
export function previousWorkingDay(date: string, holidays: HolidayCalendar): string {
  let d = addDays(date, -1);
  while (!isWorkingDayIn(d, holidays)) d = addDays(d, -1);
  return d;
}
