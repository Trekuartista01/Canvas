import { describe, expect, it } from "vitest";
import { bucketSumByDay, computeBurndownSeries, countByStatusKind } from "./dashboard-metrics";

describe("countByStatusKind", () => {
  it("zero-fills every kind, even ones with no tasks", () => {
    expect(countByStatusKind([])).toEqual({ open: 0, active: 0, review: 0, done: 0, closed: 0 });
  });

  it("counts tasks per kind", () => {
    const tasks = [
      { statusKind: "open" as const },
      { statusKind: "open" as const },
      { statusKind: "done" as const },
    ];
    expect(countByStatusKind(tasks)).toEqual({ open: 2, active: 0, review: 0, done: 1, closed: 0 });
  });
});

describe("bucketSumByDay", () => {
  const today = new Date("2026-07-22T15:00:00Z");

  it("zero-fills days with no rows", () => {
    const result = bucketSumByDay([], 3, today);
    expect(result).toEqual([
      { date: "2026-07-20", value: 0 },
      { date: "2026-07-21", value: 0 },
      { date: "2026-07-22", value: 0 },
    ]);
  });

  it("sums multiple rows landing on the same day", () => {
    const rows = [
      { date: new Date("2026-07-22T01:00:00Z"), value: 100 },
      { date: new Date("2026-07-22T20:00:00Z"), value: 50 },
    ];
    const result = bucketSumByDay(rows, 1, today);
    expect(result).toEqual([{ date: "2026-07-22", value: 150 }]);
  });

  it("keeps distinct days separate, oldest first", () => {
    const rows = [
      { date: new Date("2026-07-20T12:00:00Z"), value: 10 },
      { date: new Date("2026-07-22T12:00:00Z"), value: 20 },
    ];
    const result = bucketSumByDay(rows, 3, today);
    expect(result).toEqual([
      { date: "2026-07-20", value: 10 },
      { date: "2026-07-21", value: 0 },
      { date: "2026-07-22", value: 20 },
    ]);
  });
});

describe("computeBurndownSeries", () => {
  const today = new Date("2026-07-22T15:00:00Z");

  it("counts a still-open task as remaining on every day since it was created", () => {
    const tasks = [{ createdAt: new Date("2026-07-19T00:00:00Z"), completedAt: null }];
    const result = computeBurndownSeries(tasks, 3, today);
    expect(result).toEqual([
      { date: "2026-07-20", remaining: 1 },
      { date: "2026-07-21", remaining: 1 },
      { date: "2026-07-22", remaining: 1 },
    ]);
  });

  it("stops counting a task as remaining from the end of the day it completed", () => {
    const tasks = [
      {
        createdAt: new Date("2026-07-19T00:00:00Z"),
        completedAt: new Date("2026-07-21T10:00:00Z"),
      },
    ];
    const result = computeBurndownSeries(tasks, 3, today);
    expect(result).toEqual([
      { date: "2026-07-20", remaining: 1 },
      { date: "2026-07-21", remaining: 0 },
      { date: "2026-07-22", remaining: 0 },
    ]);
  });

  it("doesn't count a task before it was created", () => {
    const tasks = [{ createdAt: new Date("2026-07-21T12:00:00Z"), completedAt: null }];
    const result = computeBurndownSeries(tasks, 3, today);
    expect(result).toEqual([
      { date: "2026-07-20", remaining: 0 },
      { date: "2026-07-21", remaining: 1 },
      { date: "2026-07-22", remaining: 1 },
    ]);
  });
});
