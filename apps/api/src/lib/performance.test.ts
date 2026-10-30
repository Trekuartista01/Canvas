import { describe, expect, it } from "vitest";
import {
  classifyTasks,
  completedOnTime,
  deadlineKey,
  employeeOfMonthScore,
  engagementStatus,
  monthRange,
  previousMonth,
  rankEmployeeOfMonth,
  type PerfTask,
} from "./performance";

let n = 0;
const task = (over: Partial<PerfTask>): PerfTask => ({
  id: `t${++n}`,
  title: "Task",
  dueDate: null,
  dueTime: null,
  completedAt: null,
  createdAt: new Date("2026-09-01T08:00:00Z"),
  statusKind: "open",
  ...over,
});

// September 2026 is CEST (UTC+2).
const SEPT = { from: "2026-09-01", to: "2026-09-30", now: new Date("2026-10-30T10:00:00Z") };

describe("deadlines", () => {
  it("uses the due time, or the end of the day without one", () => {
    expect(deadlineKey({ dueDate: "2026-09-10", dueTime: "14:30:00" })).toBe("2026-09-10T14:30:00");
    expect(deadlineKey({ dueDate: "2026-09-10", dueTime: null })).toBe("2026-09-10T23:59:59");
    expect(deadlineKey({ dueDate: null, dueTime: null })).toBeNull();
  });

  it("judges on time in Kosovo time, not UTC", () => {
    const due = { dueDate: "2026-09-10", dueTime: "14:30:00" };
    // 12:29Z = 14:29 Kosovo → on time; 12:31Z = 14:31 → late.
    expect(completedOnTime(due, new Date("2026-09-10T12:29:00Z"))).toBe(true);
    expect(completedOnTime(due, new Date("2026-09-10T12:31:00Z"))).toBe(false);
    // 23:30Z on the 10th is already 01:30 on the 11th in Kosovo → late for an all-day due.
    expect(
      completedOnTime({ dueDate: "2026-09-10", dueTime: null }, new Date("2026-09-10T23:30:00Z")),
    ).toBe(false);
    expect(completedOnTime({ dueDate: null, dueTime: null }, new Date())).toBe(true);
  });
});

describe("classifyTasks", () => {
  it("counts each bucket for a past month", () => {
    const tasks = [
      task({
        dueDate: "2026-09-10",
        completedAt: new Date("2026-09-09T10:00:00Z"),
        statusKind: "done",
      }), // on time
      task({
        dueDate: "2026-09-10",
        completedAt: new Date("2026-09-12T10:00:00Z"),
        statusKind: "done",
      }), // late
      task({ completedAt: new Date("2026-09-20T10:00:00Z"), statusKind: "done" }), // undated → on time
      task({ dueDate: "2026-09-25" }), // open, past due at month end → overdue
      task({ dueDate: "2026-10-15", statusKind: "active" }), // in progress
      task({ dueDate: "2026-10-15", statusKind: "review" }), // awaiting approval counts as in progress
      task({ dueDate: "2026-10-15" }), // not started
    ];
    const { totals, overdueTasks } = classifyTasks(tasks, SEPT);
    expect(totals).toEqual({
      total: 7,
      completedOnTime: 2,
      completedLate: 1,
      overdue: 1,
      inProgress: 2,
      notStarted: 1,
    });
    expect(overdueTasks.map((t) => t.dueDate)).toEqual(["2026-09-25"]);
  });

  it("treats a task finished after the range as still open (and overdue) at the range end", () => {
    const t = task({
      dueDate: "2026-09-20",
      completedAt: new Date("2026-10-05T10:00:00Z"),
      statusKind: "done",
    });
    expect(classifyTasks([t], SEPT).totals).toMatchObject({
      overdue: 1,
      completedLate: 0,
      total: 1,
    });
  });

  it("ignores tasks finished before the range or created after it", () => {
    const tasks = [
      task({
        completedAt: new Date("2026-08-20T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
        statusKind: "done",
      }),
      task({ createdAt: new Date("2026-10-02T10:00:00Z") }),
    ];
    expect(classifyTasks(tasks, SEPT).totals.total).toBe(0);
  });

  it("uses now, not the range end, for a range that hasn't finished", () => {
    const now = new Date("2026-09-15T10:00:00Z");
    const tasks = [task({ dueDate: "2026-09-20" }), task({ dueDate: "2026-09-14" })];
    expect(classifyTasks(tasks, { ...SEPT, now }).totals).toMatchObject({
      overdue: 1,
      notStarted: 1,
    });
  });

  it("tracks the last completion for the tie-break", () => {
    const last = new Date("2026-09-28T10:00:00Z");
    const tasks = [
      task({ completedAt: new Date("2026-09-02T10:00:00Z"), statusKind: "done" }),
      task({ completedAt: last, statusKind: "done" }),
    ];
    expect(classifyTasks(tasks, SEPT).lastCompletedAt).toEqual(last);
  });
});

describe("Employee of the Month", () => {
  const c = (
    userId: string,
    completedOnTime: number,
    completedLate: number,
    overdue: number,
    last = "2026-09-20",
  ) => ({
    userId,
    completedOnTime,
    completedLate,
    overdue,
    lastCompletedAt: new Date(`${last}T10:00:00Z`),
  });

  it("scores 2×on time + late − 2×overdue", () => {
    expect(employeeOfMonthScore({ completedOnTime: 4, completedLate: 2, overdue: 1 })).toBe(8);
  });

  it("needs at least 3 completed tasks to qualify", () => {
    const ranked = rankEmployeeOfMonth([c("a", 2, 0, 0), c("b", 2, 1, 2)]);
    // a scores 4 but completed only 2; b scores 1 with 3 completed → b ranks first.
    expect(ranked.map((r) => [r.userId, r.qualified, r.score])).toEqual([
      ["b", true, 1],
      ["a", false, 4],
    ]);
  });

  it("breaks ties: more on time, then fewer late, then earliest last completion", () => {
    // All score 8.
    const ranked = rankEmployeeOfMonth([
      c("late-heavy", 2, 4, 0),
      c("early", 4, 0, 0, "2026-09-10"),
      c("later", 4, 0, 0, "2026-09-25"),
      c("one-late", 4, 2, 1),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(["early", "later", "one-late", "late-heavy"]);
  });
});

describe("months", () => {
  it("finds last month, across a year end", () => {
    expect(previousMonth("2026-11-01")).toEqual({
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(previousMonth("2027-01-15")).toEqual({
      month: "2026-12",
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(previousMonth("2028-03-01")).toEqual({
      month: "2028-02",
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("gives a month's range", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("engagementStatus", () => {
  const now = new Date("2026-10-30T10:00:00Z"); // 11:00 Kosovo (CET)

  it("is overdue if any open task is past its deadline", () => {
    expect(
      engagementStatus(
        [
          { dueDate: "2026-10-29", dueTime: null },
          { dueDate: "2026-10-30", dueTime: null },
        ],
        now,
      ).status,
    ).toBe("overdue");
    // Due today at 10:30 Kosovo — already past.
    expect(engagementStatus([{ dueDate: "2026-10-30", dueTime: "10:30:00" }], now).status).toBe(
      "overdue",
    );
  });

  it("is due today if something is due later today", () => {
    expect(engagementStatus([{ dueDate: "2026-10-30", dueTime: "16:00:00" }], now)).toEqual({
      status: "due_today",
      nextDeadline: "2026-10-30T16:00:00",
    });
  });

  it("is on track otherwise, with the soonest upcoming deadline", () => {
    expect(
      engagementStatus(
        [
          { dueDate: "2026-11-05", dueTime: null },
          { dueDate: "2026-11-02", dueTime: "09:00:00" },
          { dueDate: null, dueTime: null },
        ],
        now,
      ),
    ).toEqual({ status: "on_track", nextDeadline: "2026-11-02T09:00:00" });
    expect(engagementStatus([], now)).toEqual({ status: "on_track", nextDeadline: null });
  });
});
