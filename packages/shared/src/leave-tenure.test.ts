import { describe, expect, it } from "vitest";
import { formatServiceMonths, serviceMonths, vacationDaysForService } from "./leave";

const rules = [
  { years: 5, days: 25 },
  { years: 2, days: 22 },
];
const days = (employmentStartDate: string | null, year = 2026) =>
  vacationDaysForService({ defaultDays: 20, rules, employmentStartDate, year });

describe("serviceMonths", () => {
  it("counts whole months only", () => {
    expect(serviceMonths("2024-03-15", "2026-03-14")).toBe(23);
    expect(serviceMonths("2024-03-15", "2026-03-15")).toBe(24);
    expect(serviceMonths("2026-12-01", "2026-11-06")).toBeLessThan(0);
  });
});

describe("vacationDaysForService", () => {
  it("is the default with no start date, or below every rule", () => {
    expect(days(null)).toBe(20);
    expect(days("2026-09-01")).toBe(20);
  });
  it("uses the highest rule reached by the end of the year, whatever their order", () => {
    expect(days("2024-12-31")).toBe(22);
    expect(days("2025-01-01")).toBe(20);
    expect(days("2021-06-01")).toBe(25);
    expect(days("2015-01-01")).toBe(25);
  });
  it("moves up with the year asked about", () => {
    expect(days("2025-06-01", 2026)).toBe(20);
    expect(days("2025-06-01", 2027)).toBe(22);
  });
  it("is the default before they start", () => {
    expect(days("2028-01-01", 2026)).toBe(20);
  });
});

describe("formatServiceMonths", () => {
  it("reads naturally", () => {
    expect(formatServiceMonths(0)).toBe("0 mos");
    expect(formatServiceMonths(1)).toBe("1 mo");
    expect(formatServiceMonths(12)).toBe("1 yr");
    expect(formatServiceMonths(27)).toBe("2 yrs 3 mos");
  });
});
