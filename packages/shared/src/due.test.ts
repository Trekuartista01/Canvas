import { describe, expect, it } from "vitest";
import { formatDueTime, isOverdue, wallClock } from "./due";

describe("wallClock (Europe/Belgrade)", () => {
  it("is UTC+2 in summer (CEST) and UTC+1 in winter (CET)", () => {
    expect(wallClock(new Date("2026-07-01T10:00:00Z"))).toEqual({
      date: "2026-07-01",
      time: "12:00:00",
    });
    expect(wallClock(new Date("2026-01-15T10:00:00Z"))).toEqual({
      date: "2026-01-15",
      time: "11:00:00",
    });
  });

  it("rolls the date over at Kosovo midnight, not UTC midnight", () => {
    expect(wallClock(new Date("2026-03-09T23:30:00Z")).date).toBe("2026-03-10");
  });
});

describe("isOverdue", () => {
  const summerNoonLocal = new Date("2026-07-01T10:00:00Z"); // 12:00 in Kosovo

  it("compares the due time against Kosovo wall-clock time", () => {
    expect(isOverdue({ dueDate: "2026-07-01", dueTime: "11:30" }, summerNoonLocal)).toBe(true);
    expect(isOverdue({ dueDate: "2026-07-01", dueTime: "12:30:00" }, summerNoonLocal)).toBe(false);
  });

  it("treats a date with no time as due by the end of that day", () => {
    expect(isOverdue({ dueDate: "2026-07-01" }, summerNoonLocal)).toBe(false);
    expect(isOverdue({ dueDate: "2026-06-30" }, summerNoonLocal)).toBe(true);
    // 23:30 UTC on 1 July is already 01:30 on 2 July in Kosovo.
    expect(isOverdue({ dueDate: "2026-07-01" }, new Date("2026-07-01T23:30:00Z"))).toBe(true);
  });

  it("is never overdue without a due date or once finished", () => {
    expect(isOverdue({ dueDate: null }, summerNoonLocal)).toBe(false);
    expect(isOverdue({ dueDate: "2020-01-01", done: true }, summerNoonLocal)).toBe(false);
  });
});

describe("formatDueTime", () => {
  it("drops seconds and passes null through", () => {
    expect(formatDueTime("09:05:00")).toBe("09:05");
    expect(formatDueTime(null)).toBeNull();
  });
});
