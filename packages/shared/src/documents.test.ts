import { describe, expect, it } from "vitest";
import { contractNoticesDue, daysUntil } from "./documents";

describe("daysUntil", () => {
  it("counts calendar days, including across DST and year ends", () => {
    expect(daysUntil("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysUntil("2026-10-24", "2026-10-26")).toBe(2); // across the fall-back weekend
    expect(daysUntil("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysUntil("2026-11-02", "2026-10-30")).toBe(-3);
  });
});

describe("contractNoticesDue", () => {
  it("is nothing more than 30 days out", () => {
    expect(contractNoticesDue("2026-10-01", "2026-11-01")).toEqual([]);
  });

  it("is the 30-day notice from 30 days before", () => {
    expect(contractNoticesDue("2026-10-02", "2026-11-01")).toEqual([30]);
    expect(contractNoticesDue("2026-10-20", "2026-11-01")).toEqual([30]);
  });

  it("adds the 7-day notice from 7 days before, through expiry day", () => {
    expect(contractNoticesDue("2026-10-25", "2026-11-01")).toEqual([30, 7]);
    expect(contractNoticesDue("2026-11-01", "2026-11-01")).toEqual([30, 7]);
  });

  it("stops once the contract has expired", () => {
    expect(contractNoticesDue("2026-11-02", "2026-11-01")).toEqual([]);
  });
});
