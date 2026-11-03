import { describe, expect, it } from "vitest";
import {
  balanceAfter,
  carryOverFrom,
  computeVacationBalance,
  consumesBalance,
  daysInYear,
  findOverlap,
  rangesOverlap,
  validateLeaveRequest,
  yearsOf,
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

describe("validateLeaveRequest (P8.4: only hard rules)", () => {
  const base = {
    type: "vacation" as const,
    startDate: "2026-04-13",
    endDate: "2026-04-17",
    workingDays: 5,
  };

  it("accepts a normal request", () => {
    expect(validateLeaveRequest({ ...base, existing: [] })).toBeNull();
  });

  it("refuses end before start, zero working days and overlapping own leave", () => {
    expect(validateLeaveRequest({ ...base, endDate: "2026-04-12", existing: [] })).toMatch(
      "end date is before",
    );
    expect(validateLeaveRequest({ ...base, workingDays: 0, existing: [] })).toMatch(
      "no working days",
    );
    const existing = [leave({ status: "pending", startDate: "2026-04-16", endDate: "2026-04-20" })];
    expect(validateLeaveRequest({ ...base, existing })).toMatch("Overlaps");
  });

  it("allows a request across the new year and one over the balance", () => {
    expect(
      validateLeaveRequest({
        ...base,
        startDate: "2026-12-30",
        endDate: "2027-01-05",
        workingDays: 3,
        existing: [],
      }),
    ).toBeNull();
    expect(validateLeaveRequest({ ...base, workingDays: 40, existing: [] })).toBeNull();
  });
});

describe("byYear split (P8.4)", () => {
  const crossYear = leave({
    startDate: "2026-12-30",
    endDate: "2027-01-05",
    workingDays: 3,
    byYear: { "2026": 2, "2027": 1 },
  });

  it("each year's balance takes only its part", () => {
    expect(balanceOf([crossYear]).used).toBe(2);
    expect(
      computeVacationBalance({
        year: 2027,
        entitlementDays: 20,
        carriedOverDays: 0,
        requests: [crossYear],
      }).used,
    ).toBe(1);
    expect(daysInYear(crossYear, 2027)).toBe(1);
    expect(yearsOf(crossYear)).toEqual([2026, 2027]);
  });

  it("falls back to the start year without a split", () => {
    const old = leave({ byYear: {} });
    expect(daysInYear(old, 2026)).toBe(5);
    expect(daysInYear(old, 2027)).toBe(0);
  });
});

describe("balanceAfter (P8.4)", () => {
  it("shows what's left per year and warns, without blocking, when a year goes over", () => {
    const b2026 = balanceOf([leave({ workingDays: 19 })]);
    const b2027 = computeVacationBalance({
      year: 2027,
      entitlementDays: 20,
      carriedOverDays: 0,
      requests: [],
    });
    const r = balanceAfter("vacation", { "2026": 2, "2027": 1 }, [b2026, b2027]);
    expect(r.remainingAfter).toEqual([
      { year: 2026, days: -1 },
      { year: 2027, days: 19 },
    ]);
    expect(r.warning).toBe("Goes over the annual leave balance (1 day over in 2026). HR decides.");
    expect(balanceAfter("vacation", { "2027": 1 }, [b2027]).warning).toBeNull();
  });

  it("has nothing to say about types without a balance", () => {
    expect(balanceAfter("sick", { "2026": 40 }, [balanceOf([])])).toEqual({
      remainingAfter: [],
      warning: null,
    });
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
