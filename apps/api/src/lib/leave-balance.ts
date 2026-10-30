import { LEAVE_TYPE_LABELS, type LeaveStatus, type LeaveType } from "@canvas/shared";

/**
 * M7.5 leave rules. Pure — the DB-backed half (loading requests, counting
 * working days with the workspace's holiday calendar) is in
 * trpc/routers/leave.ts and lib/working-days.ts.
 *
 * - Only vacation consumes the balance; every other type is just recorded.
 * - A request belongs to the year it's in; one crossing 31 Dec must be split.
 * - Requested days count against the balance while pending, so two pending
 *   requests can't together overspend it.
 */
export interface LeaveLike {
  id?: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  workingDays: number;
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
  /** remaining − pending: what a new request may still ask for. */
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

export function computeVacationBalance(input: {
  year: number;
  entitlementDays: number;
  carriedOverDays: number;
  requests: LeaveLike[];
}): VacationBalance {
  let used = 0;
  let pending = 0;
  for (const r of input.requests) {
    if (!consumesBalance(r.type) || yearOf(r.startDate) !== input.year) continue;
    if (r.status === "approved") used += r.workingDays;
    else if (r.status === "pending") pending += r.workingDays;
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
 * Why a new request can't be made, or null if it can. `balance` is the
 * requester's vacation balance for the request's year; `existing` is all of
 * their requests.
 */
export function validateLeaveRequest(input: {
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  balance: VacationBalance;
  existing: LeaveLike[];
}): string | null {
  if (input.endDate < input.startDate) return "The end date is before the start date";
  if (yearOf(input.startDate) !== yearOf(input.endDate)) {
    return "Leave that crosses the new year has to be split into two requests";
  }
  if (input.workingDays <= 0) {
    return "Those dates have no working days (weekend or public holiday)";
  }
  const overlap = findOverlap(input, input.existing);
  if (overlap) {
    return `Overlaps ${LEAVE_TYPE_LABELS[overlap.type].toLowerCase()} from ${overlap.startDate} to ${overlap.endDate}`;
  }
  if (consumesBalance(input.type) && input.workingDays > input.balance.available) {
    return `Only ${input.balance.available} vacation days left for ${input.balance.year}`;
  }
  return null;
}

/**
 * Approving re-checks the balance (it may have changed since the request —
 * HR edited the entitlement, another request was approved). The request's
 * own days are in `pending`, so it only has to fit what's left after
 * approved leave.
 */
export function approvalBlocker(request: LeaveLike, balance: VacationBalance): string | null {
  if (!consumesBalance(request.type)) return null;
  return request.workingDays > balance.remaining
    ? `Only ${balance.remaining} vacation days left for ${balance.year}`
    : null;
}

/**
 * Unused vacation that moves into the next year. Pending days still count
 * as spent, so a request approved after the rollover can't take the old
 * year below zero.
 */
export function carryOverFrom(previous: VacationBalance): number {
  return Math.max(0, previous.available);
}
