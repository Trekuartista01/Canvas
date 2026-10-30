import { describe, expect, it } from "vitest";
import { isReminderDue, isWorkingDay, todayReportDate } from "./daily-reports";

const at = (iso: string) => new Date(iso);

describe("isWorkingDay", () => {
  it("is Monday to Friday", () => {
    expect(isWorkingDay("2026-10-26")).toBe(true); // Mon
    expect(isWorkingDay("2026-10-30")).toBe(true); // Fri
    expect(isWorkingDay("2026-10-31")).toBe(false); // Sat
    expect(isWorkingDay("2026-11-01")).toBe(false); // Sun
  });

  it("skips holidays through the hook", () => {
    expect(isWorkingDay("2026-10-26", (d) => d === "2026-10-26")).toBe(false);
  });
});

describe("isReminderDue", () => {
  it("fires at 16:45 Kosovo time in winter (CET, UTC+1)", () => {
    expect(isReminderDue(at("2026-11-02T15:44:59Z")).due).toBe(false);
    expect(isReminderDue(at("2026-11-02T15:45:00Z"))).toEqual({
      due: true,
      reportDate: "2026-11-02",
    });
  });

  it("fires at 16:45 Kosovo time in summer (CEST, UTC+2)", () => {
    expect(isReminderDue(at("2026-07-01T14:44:00Z")).due).toBe(false);
    expect(isReminderDue(at("2026-07-01T14:45:00Z")).due).toBe(true);
  });

  it("follows the spring-forward weekend (29 Mar 2026)", () => {
    // Friday before: still CET.
    expect(isReminderDue(at("2026-03-27T15:44:00Z")).due).toBe(false);
    expect(isReminderDue(at("2026-03-27T15:45:00Z")).due).toBe(true);
    // The change day itself is a Sunday — never due.
    expect(isReminderDue(at("2026-03-29T14:45:00Z")).due).toBe(false);
    // Monday after: CEST, so an hour earlier in UTC.
    expect(isReminderDue(at("2026-03-30T14:44:00Z")).due).toBe(false);
    expect(isReminderDue(at("2026-03-30T14:45:00Z")).due).toBe(true);
  });

  it("follows the fall-back weekend (25 Oct 2026)", () => {
    // Friday before: still CEST.
    expect(isReminderDue(at("2026-10-23T14:45:00Z")).due).toBe(true);
    expect(isReminderDue(at("2026-10-25T15:45:00Z")).due).toBe(false); // Sunday
    // Monday after: CET — 14:45Z is only 15:45 local.
    expect(isReminderDue(at("2026-10-26T14:45:00Z")).due).toBe(false);
    expect(isReminderDue(at("2026-10-26T15:45:00Z")).due).toBe(true);
  });

  it("stays due until local midnight, then rolls to the next day", () => {
    // 23:59 local Monday (CET).
    expect(isReminderDue(at("2026-11-02T22:59:00Z"))).toEqual({
      due: true,
      reportDate: "2026-11-02",
    });
    // 00:30 local Tuesday: not yet 16:45 there.
    expect(isReminderDue(at("2026-11-02T23:30:00Z"))).toEqual({
      due: false,
      reportDate: "2026-11-03",
    });
  });

  it("is never due on weekends or holidays", () => {
    expect(isReminderDue(at("2026-10-31T16:00:00Z")).due).toBe(false); // Sat
    expect(
      isReminderDue(at("2026-11-02T16:00:00Z"), "Europe/Belgrade", (d) => d === "2026-11-02").due,
    ).toBe(false);
  });
});

describe("todayReportDate", () => {
  it("uses the Kosovo calendar date, not UTC's", () => {
    expect(todayReportDate(at("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
  });
});
