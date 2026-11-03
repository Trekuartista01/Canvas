import { describe, expect, it } from "vitest";
import {
  catholicEaster,
  holidaysMissingFor,
  isHolidayNoticeDue,
  needsDateConfirmation,
  officialHolidays,
  orthodoxEaster,
} from "./holidays";

const byDate = (year: number, substitution: boolean) =>
  Object.fromEntries(officialHolidays(year, { substitution }).map((h) => [h.date, h.nameEn]));

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
});

describe("officialHolidays (the seed)", () => {
  it("has the fixed dates, both Easter Mondays and the Eids to confirm", () => {
    const y2026 = byDate(2026, false);
    expect(y2026["2026-01-01"]).toBe("New Year's Day");
    expect(y2026["2026-02-17"]).toBe("Independence Day");
    expect(y2026["2026-12-25"]).toBe("Catholic Christmas");
    expect(y2026["2026-04-06"]).toBe("Catholic Easter Monday");
    expect(y2026["2026-04-13"]).toBe("Orthodox Easter Monday");
    expect(y2026["2026-03-20"]).toBe("Eid al-Fitr (confirm date)");
    expect(Object.keys(y2026)).toHaveLength(12);
    const sq = officialHolidays(2026, { substitution: false }).find((h) => h.date === "2026-02-17");
    expect(sq?.nameSq).toBe("Dita e Pavarësisë");
  });

  it("adds a Monday substitute for a fixed holiday on a weekend only when the setting is on", () => {
    // 2 Jan 2027 is a Saturday, 9 May 2027 a Sunday, 25 Dec 2027 a Saturday.
    expect(byDate(2027, false)["2027-01-04"]).toBeUndefined();
    const on = officialHolidays(2027, { substitution: true });
    const subs = on.filter((h) => h.isObservedSubstitute).map((h) => [h.date, h.nameEn]);
    expect(subs).toEqual([
      ["2027-01-04", "New Year's Day (second day) (substitute day)"],
      // 1 May is a Saturday, but Mon 3 May is already Orthodox Easter Monday.
      ["2027-05-04", "Labour Day (substitute day)"],
      ["2027-05-10", "Europe Day (substitute day)"],
      ["2027-12-27", "Catholic Christmas (substitute day)"],
    ]);
  });

  it("never stacks two substitutes on one day", () => {
    // 2022: 1 Jan Sat, 2 Jan Sun → Mon 3 and Tue 4.
    const subs = officialHolidays(2022, { substitution: true })
      .filter((h) => h.isObservedSubstitute && h.date.startsWith("2022-01"))
      .map((h) => h.date);
    expect(subs).toEqual(["2022-01-03", "2022-01-04"]);
  });

  it("seeds no Eids for a year without an estimate", () => {
    expect(officialHolidays(2040, { substitution: false }).some(needsDateConfirmation)).toBe(false);
  });
});

describe("holidaysMissingFor", () => {
  const confirmed = { nameSq: "Fitër Bajrami", nameEn: "Eid al-Fitr" };
  const unconfirmed = { nameSq: "x", nameEn: "Eid al-Fitr (confirm date)" };
  it("only reminds in December, when next year is empty or unconfirmed", () => {
    expect(holidaysMissingFor("2026-12-01", [])).toBe(true);
    expect(holidaysMissingFor("2026-12-01", [confirmed, unconfirmed])).toBe(true);
    expect(holidaysMissingFor("2026-12-01", [confirmed])).toBe(false);
    expect(holidaysMissingFor("2026-11-30", [])).toBe(false);
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
