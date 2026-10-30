import { addDays, wallClock, type StatusKind } from "@canvas/shared";

/**
 * M7.8 performance metrics. Pure — every comparison is on Kosovo wall-clock
 * keys ("YYYY-MM-DDTHH:MM:SS", Europe/Belgrade), the same rule as M7.2's
 * isOverdue: a task with a due date but no time is due by the end of that
 * day.
 */
export interface PerfTask {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: Date | null;
  createdAt: Date;
  statusKind: StatusKind;
}

export interface PerfTotals {
  total: number;
  completedOnTime: number;
  completedLate: number;
  overdue: number;
  inProgress: number;
  notStarted: number;
}

/** Kosovo wall-clock key of an instant. */
export function kosovoKey(at: Date): string {
  const wall = wallClock(at);
  return `${wall.date}T${wall.time}`;
}

/** The deadline as a Kosovo key, or null for an undated task. */
export function deadlineKey(task: Pick<PerfTask, "dueDate" | "dueTime">): string | null {
  if (!task.dueDate) return null;
  return `${task.dueDate}T${task.dueTime ? `${task.dueTime.slice(0, 5)}:00` : "23:59:59"}`;
}

/** completedAt ≤ due date+time. An undated task can't be late. */
export function completedOnTime(task: Pick<PerfTask, "dueDate" | "dueTime">, completedAt: Date) {
  const deadline = deadlineKey(task);
  return deadline === null || kosovoKey(completedAt) <= deadline;
}

/**
 * One employee's tasks over [from, to] (Kosovo dates, inclusive), as of the
 * end of `to` — or now, if the range hasn't ended yet:
 * - completed on time / late: finished inside the range, judged against the
 *   task's deadline;
 * - overdue: still open at that moment and past its deadline (however long
 *   ago the deadline was);
 * - in progress: open, not overdue, currently in an active/review status;
 * - not started: the rest of the open ones.
 * "Open at that moment" uses completedAt, so a task finished after the
 * range still counts as open (and possibly overdue) at the range's end.
 * Tasks created after that moment, or finished before the range, are out.
 */
export function classifyTasks<T extends PerfTask>(
  tasks: T[],
  range: { from: string; to: string; now: Date },
): { totals: PerfTotals; overdueTasks: T[]; lastCompletedAt: Date | null } {
  const endKey = `${range.to}T23:59:59`;
  const nowKey = kosovoKey(range.now);
  const asOf = nowKey < endKey ? nowKey : endKey;
  const totals: PerfTotals = {
    total: 0,
    completedOnTime: 0,
    completedLate: 0,
    overdue: 0,
    inProgress: 0,
    notStarted: 0,
  };
  const overdueTasks: T[] = [];
  let lastCompletedAt: Date | null = null;

  for (const task of tasks) {
    if (kosovoKey(task.createdAt) > asOf) continue;
    const doneKey = task.completedAt ? kosovoKey(task.completedAt) : null;

    if (doneKey !== null && doneKey <= asOf) {
      if (doneKey.slice(0, 10) < range.from) continue;
      if (completedOnTime(task, task.completedAt!)) totals.completedOnTime++;
      else totals.completedLate++;
      if (!lastCompletedAt || task.completedAt! > lastCompletedAt)
        lastCompletedAt = task.completedAt;
    } else {
      const deadline = deadlineKey(task);
      if (deadline !== null && deadline < asOf) {
        totals.overdue++;
        overdueTasks.push(task);
      } else if (
        doneKey === null &&
        (task.statusKind === "active" || task.statusKind === "review")
      ) {
        totals.inProgress++;
      } else {
        totals.notStarted++;
      }
    }
    totals.total++;
  }

  overdueTasks.sort((a, b) => (deadlineKey(a) ?? "").localeCompare(deadlineKey(b) ?? ""));
  return { totals, overdueTasks, lastCompletedAt };
}

// ── Employee of the Month ──────────────────────────────────────────────────

export const EOM_MIN_COMPLETED = 3;

/** score = 2×(completed on time) + 1×(completed late) − 2×(overdue at month end). */
export function employeeOfMonthScore(
  t: Pick<PerfTotals, "completedOnTime" | "completedLate" | "overdue">,
) {
  return 2 * t.completedOnTime + t.completedLate - 2 * t.overdue;
}

export interface EomCandidate {
  userId: string;
  completedOnTime: number;
  completedLate: number;
  overdue: number;
  lastCompletedAt: Date | null;
}

export interface EomRanked extends EomCandidate {
  score: number;
  qualified: boolean;
}

/**
 * Everyone, best first. Only people with ≥ 3 completed tasks qualify (they
 * rank first); ties on score go to more on-time, then fewer late, then
 * whoever finished their last task earliest.
 */
export function rankEmployeeOfMonth(candidates: EomCandidate[]): EomRanked[] {
  return candidates
    .map((c) => ({
      ...c,
      score: employeeOfMonthScore(c),
      qualified: c.completedOnTime + c.completedLate >= EOM_MIN_COMPLETED,
    }))
    .sort(
      (a, b) =>
        Number(b.qualified) - Number(a.qualified) ||
        b.score - a.score ||
        b.completedOnTime - a.completedOnTime ||
        a.completedLate - b.completedLate ||
        (a.lastCompletedAt?.getTime() ?? Infinity) - (b.lastCompletedAt?.getTime() ?? Infinity),
    );
}

/** The calendar month before `today` (Kosovo date): "YYYY-MM" and its first/last day. */
export function previousMonth(today: string): { month: string; from: string; to: string } {
  const firstOfThis = `${today.slice(0, 7)}-01`;
  const to = addDays(firstOfThis, -1);
  return { month: to.slice(0, 7), from: `${to.slice(0, 7)}-01`, to };
}

/** First and last day of "YYYY-MM". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${month}-01`, to: addDays(next, -1) };
}

// ── Engagements ────────────────────────────────────────────────────────────

export type EngagementStatus = "overdue" | "due_today" | "on_track";

/**
 * A person's open tasks right now: overdue if any is past its deadline, due
 * today if any is due today (Kosovo), otherwise on track. Also their next
 * upcoming deadline.
 */
export function engagementStatus(
  openTasks: Pick<PerfTask, "dueDate" | "dueTime">[],
  now: Date,
): { status: EngagementStatus; nextDeadline: string | null } {
  const nowKey = kosovoKey(now);
  const today = nowKey.slice(0, 10);
  let status: EngagementStatus = "on_track";
  let nextDeadline: string | null = null;
  for (const task of openTasks) {
    const deadline = deadlineKey(task);
    if (deadline === null) continue;
    if (deadline < nowKey) status = "overdue";
    else {
      if (status !== "overdue" && task.dueDate === today) status = "due_today";
      if (nextDeadline === null || deadline < nextDeadline) nextDeadline = deadline;
    }
  }
  return { status, nextDeadline };
}
