import { describe, expect, it } from "vitest";
import { officialHolidays } from "./holidays";
import {
  countWorkingDays,
  holidayCalendar,
  nextWorkingDay,
  previousWorkingDay,
} from "./working-days";

// The seeded Kosovo calendar for 2026–2027, as the DB would hold it.
function kosovo(substitution: boolean) {
  return holidayCalendar(
    [2026, 2027].flatMap((y) =>
      officialHolidays(y, { substitution }).map((h) => ({ date: h.date, name: h.nameEn })),
    ),
  );
}
const OFF = kosovo(false);
const ON = kosovo(true);

// docs/hr-ops-spec.md §2 "Required unit tests".
describe("countWorkingDays", () => {
  it("25.02.2026 – 02.03.2026 is 4 working days, back on 03.03.2026 (the reference Vendim)", () => {
    const r = countWorkingDays("2026-02-25", "2026-03-02", ON);
    expect(r.total).toBe(4);
    expect(r.byYear).toEqual({ 2026: 4 });
    expect(r.excludedWeekendDays).toBe(2);
    expect(r.excludedHolidays).toEqual([]);
    expect(nextWorkingDay("2026-03-02", ON)).toBe("2026-03-03");
  });

  it("30.12.2026 – 05.01.2027 with substitution OFF is 4 days, split across the years", () => {
    const r = countWorkingDays("2026-12-30", "2027-01-05", OFF);
    expect(r.total).toBe(4);
    expect(r.byYear).toEqual({ 2026: 2, 2027: 2 });
    expect(r.excludedHolidays).toEqual([{ date: "2027-01-01", name: "New Year's Day" }]);
    // 2 Jan (Sat) and 3 Jan (Sun).
    expect(r.excludedWeekendDays).toBe(2);
  });

  it("30.12.2026 – 05.01.2027 with substitution ON is 3 days (Mon 4 Jan is a substitute)", () => {
    const r = countWorkingDays("2026-12-30", "2027-01-05", ON);
    expect(r.total).toBe(3);
    expect(r.byYear).toEqual({ 2026: 2, 2027: 1 });
    expect(r.excludedHolidays.map((h) => h.date)).toEqual(["2027-01-01", "2027-01-04"]);
  });

  it("is 0 for a range of only weekends and holidays", () => {
    // Fri 1 Jan 2027 (holiday) – Mon 4 Jan 2027 (substitute).
    expect(countWorkingDays("2027-01-01", "2027-01-04", ON).total).toBe(0);
    expect(countWorkingDays("2026-11-07", "2026-11-08", ON).total).toBe(0);
  });

  it("is 0 when the end is before the start, and 1 for a single working day", () => {
    expect(countWorkingDays("2026-11-05", "2026-11-04", ON).total).toBe(0);
    expect(countWorkingDays("2026-11-04", "2026-11-04", ON)).toEqual({
      total: 1,
      byYear: { 2026: 1 },
      excludedHolidays: [],
      excludedWeekendDays: 0,
    });
  });

  it("doesn't shift a day across the daylight-saving change (last Sunday of March)", () => {
    // Fri 27 – Tue 31 March 2026: Fri, Mon, Tue.
    expect(countWorkingDays("2026-03-27", "2026-03-31", ON).total).toBe(3);
  });
});

describe("nextWorkingDay", () => {
  it("skips weekends and holidays", () => {
    expect(nextWorkingDay("2026-12-31", OFF)).toBe("2027-01-04");
    expect(nextWorkingDay("2026-12-31", ON)).toBe("2027-01-05");
    expect(nextWorkingDay("2026-11-06", ON)).toBe("2026-11-09");
  });
});

describe("previousWorkingDay", () => {
  it("steps back over weekends and holidays", () => {
    expect(previousWorkingDay("2026-11-03", ON)).toBe("2026-11-02");
    expect(previousWorkingDay("2026-11-09", ON)).toBe("2026-11-06");
    expect(previousWorkingDay("2027-01-04", ON)).toBe("2026-12-31");
    expect(previousWorkingDay("2027-01-04", OFF)).toBe("2026-12-31");
    expect(previousWorkingDay("2026-02-18", ON)).toBe("2026-02-16");
  });
});

describe("holidayCalendar", () => {
  it("joins two holidays on the same day", () => {
    const cal = holidayCalendar([
      { date: "2026-04-06", name: "B" },
      { date: "2026-04-06", name: "A" },
    ]);
    expect(cal.get("2026-04-06")).toBe("A / B");
  });
});
