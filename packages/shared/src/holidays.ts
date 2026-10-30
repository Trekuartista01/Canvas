// M7.4 Kosovo public holidays + working days. Pure — every date is a
// "YYYY-MM-DD" calendar date (Kosovo calendar), handled in UTC arithmetic so
// the machine's own zone never shifts a day.

export const KOSOVO_FIXED_HOLIDAYS: { monthDay: string; name: string }[] = [
  { monthDay: "01-01", name: "New Year's Day" },
  { monthDay: "01-02", name: "New Year's Day (second day)" },
  { monthDay: "01-07", name: "Orthodox Christmas" },
  { monthDay: "02-17", name: "Independence Day" },
  { monthDay: "04-09", name: "Constitution Day" },
  { monthDay: "05-01", name: "Labour Day" },
  { monthDay: "05-09", name: "Europe Day" },
  { monthDay: "12-25", name: "Catholic Christmas" },
];

/** Movable holidays HR enters each year. Easter Mondays come with a suggested date. */
export const KOSOVO_MOVABLE_HOLIDAYS: {
  name: string;
  suggestDate?: (year: number) => string;
}[] = [
  { name: "Catholic Easter Monday", suggestDate: (y) => addDays(catholicEaster(y), 1) },
  { name: "Orthodox Easter Monday", suggestDate: (y) => addDays(orthodoxEaster(y), 1) },
  { name: "Eid al-Fitr (Bajrami i Madh)" },
  { name: "Eid al-Adha (Kurban Bajrami)" },
];

export const DEFAULT_HOLIDAY_NOTICE_DAYS = 2;

function toUtc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function isWeekend(date: string): boolean {
  const weekday = toUtc(date).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Western (Gregorian) Easter Sunday — the anonymous Gregorian algorithm. */
export function catholicEaster(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Orthodox Easter Sunday as a Gregorian date (Meeus' Julian algorithm + 13 days, valid 1900–2099). */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(ymd(year, month, day), 13);
}

export interface HolidayRow {
  id: string;
  name: string;
  /** For a recurring fixed-date holiday only the month/day counts. */
  date: string;
  /** HR override; null = by the observed rule. */
  observedDate: string | null;
  isRecurringFixed: boolean;
}

export interface HolidayOccurrence {
  id: string;
  name: string;
  date: string;
  /** The working day taken off — the date itself unless it fell on a weekend. */
  observedDate: string;
  isRecurringFixed: boolean;
}

/**
 * The holidays of one year with their observed dates. Rule: a holiday on a
 * Saturday or Sunday is observed on the next working day that isn't already
 * a holiday (or another holiday's observed day) — so New Year on Sat + Sun
 * gives Mon and Tue off.
 */
export function expandHolidays(rows: HolidayRow[], year: number): HolidayOccurrence[] {
  const occurrences = rows
    .map((row) => ({
      row,
      date: row.isRecurringFixed ? `${year}-${row.date.slice(5)}` : row.date,
    }))
    .filter(({ row, date }) => (row.isRecurringFixed ? true : date.startsWith(`${year}-`)))
    .sort((x, y) => x.date.localeCompare(y.date) || x.row.name.localeCompare(y.row.name));

  // Every actual holiday date, plus overrides, is unavailable as a substitute day.
  const taken = new Set(occurrences.map((o) => o.date));
  for (const { row } of occurrences) if (row.observedDate) taken.add(row.observedDate);

  return occurrences.map(({ row, date }) => {
    let observed = date;
    if (!row.isRecurringFixed && row.observedDate) {
      observed = row.observedDate;
    } else if (isWeekend(date)) {
      observed = addDays(date, 1);
      while (isWeekend(observed) || taken.has(observed)) observed = addDays(observed, 1);
      taken.add(observed);
    }
    return {
      id: row.id,
      name: row.name,
      date,
      observedDate: observed,
      isRecurringFixed: row.isRecurringFixed,
    };
  });
}

/**
 * `isHoliday(date)` for a workspace's calendar: true on any day off that
 * falls on a weekday (the holiday itself, or its observed substitute).
 * Years are expanded lazily and cached.
 */
export function makeHolidayChecker(rows: HolidayRow[]): (date: string) => boolean {
  const byYear = new Map<number, Set<string>>();
  return (date) => {
    const year = Number(date.slice(0, 4));
    let daysOff = byYear.get(year);
    if (!daysOff) {
      daysOff = new Set(expandHolidays(rows, year).map((o) => o.observedDate));
      byYear.set(year, daysOff);
    }
    return daysOff.has(date);
  };
}

/** Mon–Fri and not a public holiday (or a holiday's observed day). */
export function isWorkingDay(
  date: string,
  isHoliday: (date: string) => boolean = () => false,
): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/** Working days from `from` to `to`, both inclusive; 0 if `to` is before `from`. */
export function countWorkingDays(
  from: string,
  to: string,
  isHoliday: (date: string) => boolean = () => false,
): number {
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, isHoliday)) count++;
  }
  return count;
}

/**
 * Should the "holiday coming up" notice go out today? From `noticeDays`
 * calendar days before the day off until the day before it — a worker that
 * missed the exact day still catches up; the notice ledger keeps it to once.
 */
export function isHolidayNoticeDue(today: string, observedDate: string, noticeDays: number) {
  return today >= addDays(observedDate, -noticeDays) && today < observedDate;
}

/** Has HR entered any movable (non-recurring) holiday for `year` yet? */
export function hasMovableHolidays(rows: HolidayRow[], year: number): boolean {
  return rows.some((r) => !r.isRecurringFixed && r.date.startsWith(`${year}-`));
}
