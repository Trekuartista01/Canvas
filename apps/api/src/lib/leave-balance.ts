import { LEAVE_TYPE_LABELS, type LeaveStatus, type LeaveType } from "@canvas/shared";

/**
 * Leave rules (M7.5, reworked in P8.4 per docs/hr-ops-spec.md §3). Pure —
 * the DB-backed half (loading requests, the holiday calendar) is in
 * lib/leave.ts and lib/working-days.ts.
 *
 * - Only annual leave (vacation) consumes the balance; other types are recorded.
 * - Balance = allowed + carried over − approved − pending, per year. A request
 *   that crosses 31 Dec takes each year's part from that year (`byYear`).
 * - Going over the balance is a warning, not a block: HR decides.
 */
export interface LeaveLike {
  id?: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Working days per year ("2026" → 2). Empty/missing = all in the start year. */
  byYear?: Record<string, number> | null;
}

export interface VacationBalance {
  year: number;
  entitlement: number;
  carriedOver: number;
  total: number;
  /** Approved vacation days. */
  used: number;
  /** Vacation days in pending requests. */
  pending: number;
  /** total − used. */
  remaining: number;
  /** remaining − pending: what a new request may take without going over. */
  available: number;
}

export function consumesBalance(type: LeaveType): boolean {
  return type === "vacation";
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** Avoids 0.1 + 0.2 noise — days are whole or half days. */
function round(n: number) {
  return Math.round(n * 10) / 10;
}

/** How many of this request's working days fall in `year`. */
export function daysInYear(request: LeaveLike, year: number): number {
  const split = request.byYear;
  if (split && Object.keys(split).length > 0) return split[String(year)] ?? 0;
  return yearOf(request.startDate) === year ? request.workingDays : 0;
}

/** The years a request touches. */
export function yearsOf(request: LeaveLike): number[] {
  const split = request.byYear;
  if (split && Object.keys(split).length > 0) return Object.keys(split).map(Number).sort();
  return [yearOf(request.startDate)];
}

export function computeVacationBalance(input: {
  year: number;
  entitlementDays: number;
  carriedOverDays: number;
  requests: LeaveLike[];
}): VacationBalance {
  let used = 0;
  let pending = 0;
  for (const r of input.requests) {
    if (!consumesBalance(r.type)) continue;
    const days = daysInYear(r, input.year);
    if (r.status === "approved") used += days;
    else if (r.status === "pending") pending += days;
  }
  const total = round(input.entitlementDays + input.carriedOverDays);
  const remaining = round(total - used);
  return {
    year: input.year,
    entitlement: input.entitlementDays,
    carriedOver: input.carriedOverDays,
    total,
    used: round(used),
    pending: round(pending),
    remaining,
    available: round(remaining - pending),
  };
}

/** Both ranges inclusive. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** The first live (pending or approved) request that overlaps `range`, ignoring `range.id` itself. */
export function findOverlap(
  range: { id?: string; startDate: string; endDate: string },
  existing: LeaveLike[],
): LeaveLike | null {
  return (
    existing.find(
      (r) =>
        (range.id === undefined || r.id !== range.id) &&
        (r.status === "pending" || r.status === "approved") &&
        rangesOverlap(range, r),
    ) ?? null
  );
}

/**
 * Why a request can't be made at all, or null if it can. Only hard rules:
 * the dates, zero working days, and overlapping your own leave. The
 * balance is a warning (balanceWarning), never a reason to refuse.
 */
export function validateLeaveRequest(input: {
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  existing: LeaveLike[];
}): string | null {
  if (input.endDate < input.startDate) return "The end date is before the start date";
  if (input.workingDays <= 0) {
    return "Those dates have no working days (weekend or official holiday)";
  }
  const overlap = findOverlap(input, input.existing);
  if (overlap) {
    return `Overlaps ${LEAVE_TYPE_LABELS[overlap.type].toLowerCase()} from ${overlap.startDate} to ${overlap.endDate}`;
  }
  return null;
}

/**
 * Remaining days per year after this request, and a warning when any year
 * goes below zero. `balances` must hold the balance of every year in
 * `byYear` (the request itself not yet counted in them).
 */
export function balanceAfter(
  type: LeaveType,
  byYear: Record<string, number>,
  balances: VacationBalance[],
): { remainingAfter: { year: number; days: number }[]; warning: string | null } {
  if (!consumesBalance(type)) return { remainingAfter: [], warning: null };
  const remainingAfter = balances.map((b) => ({
    year: b.year,
    days: round(b.available - (byYear[String(b.year)] ?? 0)),
  }));
  const over = remainingAfter.filter((r) => r.days < 0);
  const warning =
    over.length === 0
      ? null
      : `Goes over the annual leave balance (${over
          .map(
            (r) => `${Math.abs(r.days)} day${Math.abs(r.days) === 1 ? "" : "s"} over in ${r.year}`,
          )
          .join(", ")}). HR decides.`;
  return { remainingAfter, warning };
}

/**
 * Unused vacation that moves into the next year. Pending days still count
 * as spent, so a request approved after the rollover can't take the old
 * year below zero.
 */
export function carryOverFrom(previous: VacationBalance): number {
  return Math.max(0, previous.available);
}
