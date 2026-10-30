import { describe, expect, it } from "vitest";
import {
  KOSOVO_FIXED_HOLIDAYS,
  KOSOVO_MOVABLE_HOLIDAYS,
  catholicEaster,
  countWorkingDays,
  expandHolidays,
  hasMovableHolidays,
  isHolidayNoticeDue,
  isWorkingDay,
  makeHolidayChecker,
  orthodoxEaster,
  type HolidayRow,
} from "./holidays";

const fixed: HolidayRow[] = KOSOVO_FIXED_HOLIDAYS.map((h, i) => ({
  id: `fixed-${i}`,
  name: h.name,
  date: `2026-${h.monthDay}`,
  observedDate: null,
  isRecurringFixed: true,
}));

const movable = (id: string, name: string, date: string, observedDate: string | null = null) => ({
  id,
  name,
  date,
  observedDate,
  isRecurringFixed: false,
});

const observedOf = (rows: HolidayRow[], year: number) =>
  Object.fromEntries(expandHolidays(rows, year).map((o) => [o.name, [o.date, o.observedDate]]));

describe("Easter", () => {
  it("computes Catholic Easter Sunday", () => {
    expect(catholicEaster(2024)).toBe("2024-03-31");
    expect(catholicEaster(2025)).toBe("2025-04-20");
    expect(catholicEaster(2026)).toBe("2026-04-05");
    expect(catholicEaster(2027)).toBe("2027-03-28");
  });

  it("computes Orthodox Easter Sunday (Gregorian date)", () => {
    expect(orthodoxEaster(2024)).toBe("2024-05-05");
    expect(orthodoxEaster(2025)).toBe("2025-04-20");
    expect(orthodoxEaster(2026)).toBe("2026-04-12");
    expect(orthodoxEaster(2027)).toBe("2027-05-02");
  });

  it("suggests the Easter Mondays", () => {
    const suggest = (name: string) =>
      KOSOVO_MOVABLE_HOLIDAYS.find((h) => h.name === name)!.suggestDate!(2026);
    expect(suggest("Catholic Easter Monday")).toBe("2026-04-06");
    expect(suggest("Orthodox Easter Monday")).toBe("2026-04-13");
  });
});

describe("expandHolidays — observed rule", () => {
  it("repeats recurring fixed holidays every year", () => {
    const y2030 = expandHolidays(fixed, 2030);
    expect(y2030).toHaveLength(8);
    expect(y2030.map((o) => o.date)).toContain("2030-02-17");
  });

  it("keeps weekday holidays on their own date", () => {
    expect(observedOf(fixed, 2026)["Independence Day"]).toEqual(["2026-02-17", "2026-02-17"]);
  });

  it("moves a weekend holiday to the next working day", () => {
    // 9 May 2026 is a Saturday.
    expect(observedOf(fixed, 2026)["Europe Day"]).toEqual(["2026-05-09", "2026-05-11"]);
    // 25 Dec 2027 is a Saturday.
    expect(observedOf(fixed, 2027)["Catholic Christmas"]).toEqual(["2027-12-25", "2027-12-27"]);
  });

  it("doesn't stack two weekend holidays on the same day (New Year 2022: Sat + Sun)", () => {
    const y = observedOf(fixed, 2022);
    expect(y["New Year's Day"]).toEqual(["2022-01-01", "2022-01-03"]);
    expect(y["New Year's Day (second day)"]).toEqual(["2022-01-02", "2022-01-04"]);
  });

  it("skips a day that is already a holiday (1 May 2027 Sat, Mon is Orthodox Easter Monday)", () => {
    const rows = [...fixed, movable("m1", "Orthodox Easter Monday", "2027-05-03")];
    const y = observedOf(rows, 2027);
    expect(y["Orthodox Easter Monday"]).toEqual(["2027-05-03", "2027-05-03"]);
    expect(y["Labour Day"]).toEqual(["2027-05-01", "2027-05-04"]);
    // 9 May 2027 is a Sunday — the next free working day is Monday the 10th.
    expect(y["Europe Day"]).toEqual(["2027-05-09", "2027-05-10"]);
  });

  it("honours an HR override of the observed date", () => {
    const rows = [movable("m1", "Eid al-Adha (Kurban Bajrami)", "2026-05-27", "2026-05-29")];
    expect(observedOf(rows, 2026)["Eid al-Adha (Kurban Bajrami)"]).toEqual([
      "2026-05-27",
      "2026-05-29",
    ]);
  });

  it("only includes movable holidays in their own year", () => {
    const rows = [movable("m1", "Eid al-Fitr (Bajrami i Madh)", "2026-03-20")];
    expect(expandHolidays(rows, 2026)).toHaveLength(1);
    expect(expandHolidays(rows, 2027)).toHaveLength(0);
  });
});

describe("working days", () => {
  const isHoliday = makeHolidayChecker([
    ...fixed,
    movable("m1", "Catholic Easter Monday", "2026-04-06"),
  ]);

  it("treats holidays and observed substitutes as days off", () => {
    expect(isWorkingDay("2026-04-06", isHoliday)).toBe(false); // Easter Monday
    expect(isWorkingDay("2026-05-11", isHoliday)).toBe(false); // Europe Day observed
    expect(isWorkingDay("2026-05-12", isHoliday)).toBe(true);
    expect(isWorkingDay("2026-05-09", isHoliday)).toBe(false); // Saturday anyway
  });

  it("counts working days inclusively", () => {
    // Mon 6 Apr (Easter Monday) .. Fri 10 Apr, with Thu 9 Apr Constitution Day.
    expect(countWorkingDays("2026-04-06", "2026-04-10", isHoliday)).toBe(3);
    expect(countWorkingDays("2026-10-26", "2026-11-01")).toBe(5);
    expect(countWorkingDays("2026-10-30", "2026-10-30")).toBe(1);
    expect(countWorkingDays("2026-11-02", "2026-10-30")).toBe(0);
  });

  it("works across a year boundary", () => {
    // Thu 31 Dec 2026 .. Mon 4 Jan 2027: Jan 1 (Fri) off, Jan 2 (Sat) → observed Mon 4.
    expect(countWorkingDays("2026-12-31", "2027-01-04", isHoliday)).toBe(1);
  });
});

describe("isHolidayNoticeDue", () => {
  it("is due from N days before the day off until the day before", () => {
    expect(isHolidayNoticeDue("2026-05-08", "2026-05-11", 2)).toBe(false);
    expect(isHolidayNoticeDue("2026-05-09", "2026-05-11", 2)).toBe(true);
    expect(isHolidayNoticeDue("2026-05-10", "2026-05-11", 2)).toBe(true);
    expect(isHolidayNoticeDue("2026-05-11", "2026-05-11", 2)).toBe(false);
  });
});

describe("hasMovableHolidays", () => {
  it("only counts non-recurring entries in that year", () => {
    expect(hasMovableHolidays(fixed, 2026)).toBe(false);
    expect(hasMovableHolidays([...fixed, movable("m1", "x", "2026-04-06")], 2026)).toBe(true);
    expect(hasMovableHolidays([movable("m1", "x", "2026-04-06")], 2027)).toBe(false);
  });
});
