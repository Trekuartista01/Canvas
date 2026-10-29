import { describe, expect, it } from "vitest";
import { effectivePeopleRole, wouldCreateReportingCycle } from "./people";

describe("wouldCreateReportingCycle", () => {
  // carol → bob → alice (alice has no manager)
  const managerOf = new Map<string, string | null>([
    ["alice", null],
    ["bob", "alice"],
    ["carol", "bob"],
  ]);

  it("rejects making someone their own manager", () => {
    expect(wouldCreateReportingCycle("alice", "alice", managerOf)).toBe(true);
  });

  it("rejects making a member report to someone below them", () => {
    expect(wouldCreateReportingCycle("alice", "carol", managerOf)).toBe(true);
    expect(wouldCreateReportingCycle("bob", "carol", managerOf)).toBe(true);
  });

  it("allows a manager above or beside them", () => {
    expect(wouldCreateReportingCycle("carol", "alice", managerOf)).toBe(false);
    expect(wouldCreateReportingCycle("dave", "carol", managerOf)).toBe(false);
  });

  it("terminates on a pre-existing loop that doesn't involve the member", () => {
    const looped = new Map<string, string | null>([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(wouldCreateReportingCycle("dave", "x", looped)).toBe(false);
  });
});

describe("effectivePeopleRole", () => {
  it("treats the workspace owner as super_admin whatever is stored", () => {
    expect(effectivePeopleRole("owner", "staff")).toBe("super_admin");
    expect(effectivePeopleRole("admin", "staff")).toBe("staff");
    expect(effectivePeopleRole("member", "hr")).toBe("hr");
  });
});
