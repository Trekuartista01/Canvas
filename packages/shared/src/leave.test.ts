import { describe, expect, it } from "vitest";
import { formatDmy, leaveMessages } from "./leave";

// docs/hr-ops-spec.md §3 — the example texts, word for word.
describe("leaveMessages (P8.4)", () => {
  const request = {
    type: "vacation" as const,
    startDate: "2026-12-30",
    endDate: "2027-01-05",
    workingDays: 4,
  };

  it("formats dates as dd.mm.yyyy", () => {
    expect(formatDmy("2027-01-05")).toBe("05.01.2027");
  });

  it("tells HR who asked for what", () => {
    expect(leaveMessages.requested({ name: "Olsi Sopi", ...request })).toBe(
      "Olsi Sopi has requested annual leave from 30.12.2026 until 05.01.2027 (4 working days).",
    );
  });

  it("tells the employee it was approved and when they're back", () => {
    expect(leaveMessages.approved({ ...request, returnDate: "2027-01-06" })).toBe(
      "Your annual leave from 30.12.2026 until 05.01.2027 (4 working days) has been approved. You are expected back at work on 06.01.2027.",
    );
  });

  it("gives the reason on rejection, and says 1 working day in the singular", () => {
    expect(leaveMessages.rejected({ ...request, reason: "Year-end close" })).toBe(
      "Your annual leave request from 30.12.2026 until 05.01.2027 was not approved. Reason: Year-end close",
    );
    expect(leaveMessages.requested({ name: "A", ...request, workingDays: 1 })).toContain(
      "(1 working day)",
    );
  });
});
