import { describe, expect, it } from "vitest";
import {
  approvalBlocker,
  carryOverFrom,
  computeVacationBalance,
  consumesBalance,
  findOverlap,
  rangesOverlap,
  validateLeaveRequest,
  type LeaveLike,
} from "./leave-balance";

const leave = (over: Partial<LeaveLike>): LeaveLike => ({
  type: "vacation",
  status: "approved",
  startDate: "2026-03-02",
  endDate: "2026-03-06",
  workingDays: 5,
  ...over,
});

const balanceOf = (requests: LeaveLike[], entitlementDays = 20, carriedOverDays = 0) =>
  computeVacationBalance({ year: 2026, entitlementDays, carriedOverDays, requests });

describe("consumesBalance", () => {
  it("is only vacation", () => {
    expect(consumesBalance("vacation")).toBe(true);
    for (const t of ["sick", "personal", "maternity", "paternity", "emergency"] as const) {
      expect(consumesBalance(t)).toBe(false);
    }
  });
});

describe("computeVacationBalance", () => {
  it("starts at entitlement + carried over", () => {
    expect(balanceOf([], 20, 3)).toMatchObject({
      total: 23,
      used: 0,
      pending: 0,
      remaining: 23,
      available: 23,
    });
  });

  it("subtracts approved vacation from remaining, pending only from available", () => {
    const b = balanceOf([
      leave({ workingDays: 5 }),
      leave({ status: "pending", startDate: "2026-06-01", endDate: "2026-06-03", workingDays: 3 }),
    ]);
    expect(b).toMatchObject({ used: 5, pending: 3, remaining: 15, available: 12 });
  });

  it("ignores non-vacation types, rejected/cancelled requests and other years", () => {
    const b = balanceOf([
      leave({ type: "sick", workingDays: 4 }),
      leave({ status: "rejected" }),
      leave({ status: "cancelled" }),
      leave({ startDate: "2025-12-01", endDate: "2025-12-05" }),
    ]);
    expect(b).toMatchObject({ used: 0, pending: 0, remaining: 20 });
  });

  it("keeps half days exact", () => {
    const b = balanceOf([leave({ workingDays: 0.5 }), leave({ workingDays: 0.2 })], 20, 0.1);
    expect(b.remaining).toBe(19.4);
  });
});

describe("overlap", () => {
  it("treats ranges as inclusive", () => {
    const a = { startDate: "2026-03-02", endDate: "2026-03-06" };
    expect(rangesOverlap(a, { startDate: "2026-03-06", endDate: "2026-03-09" })).toBe(true);
    expect(rangesOverlap(a, { startDate: "2026-03-07", endDate: "2026-03-09" })).toBe(false);
    expect(rangesOverlap(a, { startDate: "2026-02-01", endDate: "2026-03-02" })).toBe(true);
    expect(rangesOverlap(a, { startDate: "2026-03-03", endDate: "2026-03-04" })).toBe(true);
  });

  it("only counts pending and approved requests, and never the request itself", () => {
    const range = { id: "self", startDate: "2026-03-04", endDate: "2026-03-05" };
    expect(
      findOverlap(range, [leave({ status: "rejected" }), leave({ status: "cancelled" })]),
    ).toBeNull();
    expect(findOverlap(range, [leave({ id: "self", status: "pending" })])).toBeNull();
    expect(findOverlap(range, [leave({ id: "other", status: "pending" })])).not.toBeNull();
  });
});

describe("validateLeaveRequest", () => {
  const base = {
    type: "vacation" as const,
    startDate: "2026-04-13",
    endDate: "2026-04-17",
    workingDays: 5,
  };

  it("accepts a request within balance", () => {
    expect(validateLeaveRequest({ ...base, balance: balanceOf([]), existing: [] })).toBeNull();
  });

  it("rejects an end date before the start", () => {
    expect(
      validateLeaveRequest({
        ...base,
        endDate: "2026-04-10",
        balance: balanceOf([]),
        existing: [],
      }),
    ).toMatch(/before the start/);
  });

  it("rejects leave crossing the new year", () => {
    expect(
      validateLeaveRequest({
        ...base,
        startDate: "2026-12-28",
        endDate: "2027-01-05",
        balance: balanceOf([]),
        existing: [],
      }),
    ).toMatch(/split/);
  });

  it("rejects dates with no working days", () => {
    expect(
      validateLeaveRequest({ ...base, workingDays: 0, balance: balanceOf([]), existing: [] }),
    ).toMatch(/no working days/);
  });

  it("rejects overlapping requests, of any type", () => {
    const existing = [leave({ type: "sick", startDate: "2026-04-16", endDate: "2026-04-20" })];
    expect(validateLeaveRequest({ ...base, balance: balanceOf(existing), existing })).toMatch(
      /Overlaps sick leave from 2026-04-16 to 2026-04-20/,
    );
  });

  it("rejects vacation beyond the remaining balance, counting pending requests", () => {
    const existing = [
      leave({ workingDays: 10 }),
      leave({ status: "pending", startDate: "2026-06-01", endDate: "2026-06-12", workingDays: 8 }),
    ];
    // 20 − 10 approved − 8 pending = 2 left.
    expect(validateLeaveRequest({ ...base, balance: balanceOf(existing), existing })).toBe(
      "Only 2 vacation days left for 2026",
    );
    expect(
      validateLeaveRequest({
        ...base,
        endDate: "2026-04-14",
        workingDays: 2,
        balance: balanceOf(existing),
        existing,
      }),
    ).toBeNull();
  });

  it("doesn't limit types that don't consume balance", () => {
    const existing = [leave({ workingDays: 20 })];
    expect(
      validateLeaveRequest({ ...base, type: "sick", balance: balanceOf(existing), existing }),
    ).toBeNull();
  });
});

describe("approvalBlocker", () => {
  it("lets a pending request through if it fits after approved leave", () => {
    const request = leave({ id: "r", status: "pending", workingDays: 5 });
    const b = balanceOf([leave({ workingDays: 15 }), request]);
    expect(approvalBlocker(request, b)).toBeNull();
  });

  it("blocks approving more than remains", () => {
    const request = leave({ id: "r", status: "pending", workingDays: 6 });
    const b = balanceOf([leave({ workingDays: 15 }), request]);
    expect(approvalBlocker(request, b)).toBe("Only 5 vacation days left for 2026");
  });

  it("never blocks non-vacation leave", () => {
    const request = leave({ type: "maternity", status: "pending", workingDays: 90 });
    expect(approvalBlocker(request, balanceOf([request]))).toBeNull();
  });
});

describe("carryOverFrom", () => {
  it("carries unused vacation into next year", () => {
    expect(carryOverFrom(balanceOf([leave({ workingDays: 12 })], 20, 2))).toBe(10);
  });

  it("treats pending days as spent and never goes negative", () => {
    expect(
      carryOverFrom(
        balanceOf([
          leave({ workingDays: 18 }),
          leave({
            status: "pending",
            startDate: "2026-12-14",
            endDate: "2026-12-18",
            workingDays: 5,
          }),
        ]),
      ),
    ).toBe(0);
  });
});
