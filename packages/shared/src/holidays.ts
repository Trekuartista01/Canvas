// Kosovo official holidays (M7.4, reworked in P8.2). Pure — every date is a
// "YYYY-MM-DD" calendar date (Kosovo calendar), handled in UTC arithmetic so
// the machine's own zone never shifts a day.
//
// Since P8.2 the stored rows are the truth: each row is one concrete day off
// (`official_holidays` in the spec, our `public_holidays`). This file only
// knows what to *seed* for a year; counting days is ./working-days.ts.

export const KOSOVO_FIXED_HOLIDAYS: { monthDay: string; nameSq: string; nameEn: string }[] = [
  { monthDay: "01-01", nameSq: "Viti i Ri", nameEn: "New Year's Day" },
  { monthDay: "01-02", nameSq: "Dita e dytë e Vitit të Ri", nameEn: "New Year's Day (second day)" },
  { monthDay: "01-07", nameSq: "Krishtlindjet Ortodokse", nameEn: "Orthodox Christmas" },
  { monthDay: "02-17", nameSq: "Dita e Pavarësisë", nameEn: "Independence Day" },
  { monthDay: "04-09", nameSq: "Dita e Kushtetutës", nameEn: "Constitution Day" },
  { monthDay: "05-01", nameSq: "Dita Ndërkombëtare e Punës", nameEn: "Labour Day" },
  { monthDay: "05-09", nameSq: "Dita e Evropës", nameEn: "Europe Day" },
  { monthDay: "12-25", nameSq: "Krishtlindjet Katolike", nameEn: "Catholic Christmas" },
];

/** Shown in a seeded Eid's name until HR confirms the government's date. */
export const CONFIRM_DATE_EN = "(confirm date)";
export const CONFIRM_DATE_SQ = "(konfirmo datën)";

/**
 * Expected Eid dates (astronomical estimates; the government announces the
 * real ones). Seeded with "(confirm date)" in the name. Years without an
 * entry get no Eid rows and HR adds them.
 */
export const KOSOVO_EID_ESTIMATES: Record<number, { fitr: string; adha: string }> = {
  2026: { fitr: "2026-03-20", adha: "2026-05-27" },
  2027: { fitr: "2027-03-10", adha: "2027-05-16" },
  2028: { fitr: "2028-02-27", adha: "2028-05-05" },
  2029: { fitr: "2029-02-14", adha: "2029-04-24" },
  2030: { fitr: "2030-02-04", adha: "2030-04-13" },
};

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

export interface OfficialHoliday {
  date: string;
  nameSq: string;
  nameEn: string;
  isObservedSubstitute: boolean;
}

/**
 * What the seed inserts for one year: the fixed dates, both Easter Mondays,
 * the Eids (estimated, "(confirm date)") and — when `substitution` is on —
 * a substitute day off for every fixed holiday on a weekend. The substitute
 * is the following Monday, or the next weekday after it that isn't already a
 * day off (New Year on Sat + Sun → Mon and Tue; 1 May 2027 on a Saturday
 * whose Monday is Orthodox Easter Monday → Tue 4 May).
 */
export function officialHolidays(
  year: number,
  { substitution }: { substitution: boolean },
): OfficialHoliday[] {
  const fixed = KOSOVO_FIXED_HOLIDAYS.map((h) => ({
    date: `${year}-${h.monthDay}`,
    nameSq: h.nameSq,
    nameEn: h.nameEn,
    isObservedSubstitute: false,
  }));
  const movable: OfficialHoliday[] = [
    {
      date: addDays(catholicEaster(year), 1),
      nameSq: "E hëna e Pashkëve Katolike",
      nameEn: "Catholic Easter Monday",
      isObservedSubstitute: false,
    },
    {
      date: addDays(orthodoxEaster(year), 1),
      nameSq: "E hëna e Pashkëve Ortodokse",
      nameEn: "Orthodox Easter Monday",
      isObservedSubstitute: false,
    },
  ];
  const eid = KOSOVO_EID_ESTIMATES[year];
  if (eid) {
    movable.push(
      {
        date: eid.fitr,
        nameSq: `Fitër Bajrami ${CONFIRM_DATE_SQ}`,
        nameEn: `Eid al-Fitr ${CONFIRM_DATE_EN}`,
        isObservedSubstitute: false,
      },
      {
        date: eid.adha,
        nameSq: `Kurban Bajrami ${CONFIRM_DATE_SQ}`,
        nameEn: `Eid al-Adha ${CONFIRM_DATE_EN}`,
        isObservedSubstitute: false,
      },
    );
  }

  const all = [...fixed, ...movable];
  if (substitution) {
    const taken = new Set(all.map((h) => h.date));
    for (const h of fixed) {
      if (!isWeekend(h.date)) continue;
      let day = addDays(h.date, 1);
      while (isWeekend(day) || taken.has(day)) day = addDays(day, 1);
      taken.add(day);
      all.push(substituteFor(h, day));
    }
  }
  return all.sort((x, y) => x.date.localeCompare(y.date) || x.nameEn.localeCompare(y.nameEn));
}

export function substituteFor(
  holiday: { nameSq: string; nameEn: string },
  date: string,
): OfficialHoliday {
  return {
    date,
    nameSq: `${holiday.nameSq} (ditë zëvendësuese)`,
    nameEn: `${holiday.nameEn} (substitute day)`,
    isObservedSubstitute: true,
  };
}

/** A seeded Eid HR still has to check against the government's announcement. */
export function needsDateConfirmation(holiday: { nameSq: string; nameEn: string }): boolean {
  return holiday.nameEn.includes(CONFIRM_DATE_EN) || holiday.nameSq.includes(CONFIRM_DATE_SQ);
}

/**
 * HR's December reminder ("Add next year's official holidays"): due in
 * December when next year has no rows at all or still has an unconfirmed Eid.
 */
export function holidaysMissingFor(
  today: string,
  nextYearRows: { nameSq: string; nameEn: string }[],
): boolean {
  if (today.slice(5, 7) !== "12") return false;
  return nextYearRows.length === 0 || nextYearRows.some(needsDateConfirmation);
}

/** Mon–Fri and not a public holiday. */
export function isWorkingDay(
  date: string,
  isHoliday: (date: string) => boolean = () => false,
): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/**
 * Should the "holiday coming up" notice go out today? From `noticeDays`
 * calendar days before the day off until the day before it — a worker that
 * missed the exact day still catches up; the notice ledger keeps it to once.
 */
export function isHolidayNoticeDue(today: string, dayOff: string, noticeDays: number) {
  return today >= addDays(dayOff, -noticeDays) && today < dayOff;
}
