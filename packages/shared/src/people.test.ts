import { describe, expect, it } from "vitest";
import {
  effectivePeopleRole,
  isHrDataAction,
  PEOPLE_ACTIONS,
  PEOPLE_ROLE_PERMISSIONS,
  PEOPLE_ROLES,
  peopleRoleHas,
  wouldCreateReportingCycle,
} from "./people";

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
  it("treats the workspace owner as admin whatever is stored — never HR", () => {
    expect(effectivePeopleRole("owner", "employee")).toBe("admin");
    expect(effectivePeopleRole("owner", "hr_finance")).toBe("admin");
    expect(effectivePeopleRole("admin", "employee")).toBe("employee");
    expect(effectivePeopleRole("member", "hr_finance")).toBe("hr_finance");
  });
});

describe("PEOPLE_ROLE_PERMISSIONS", () => {
  it("gives HR data actions to hr_finance only", () => {
    for (const action of PEOPLE_ACTIONS.filter(isHrDataAction)) {
      const holders = PEOPLE_ROLES.filter((r) => peopleRoleHas(r, action));
      expect(holders, action).toEqual(["hr_finance"]);
    }
  });

  it("gives ceo and operations_manager the same set", () => {
    expect(PEOPLE_ROLE_PERMISSIONS.ceo).toEqual(PEOPLE_ROLE_PERMISSIONS.operations_manager);
  });

  it("lets clients and boards be managed by ops, ceo and admin only", () => {
    for (const action of ["clients:manage", "boards:manageAll"] as const) {
      expect(PEOPLE_ROLES.filter((r) => peopleRoleHas(r, action))).toEqual([
        "admin",
        "ceo",
        "operations_manager",
      ]);
    }
  });

  it("reserves role assignment for admin", () => {
    expect(PEOPLE_ROLES.filter((r) => peopleRoleHas(r, "roles:assign"))).toEqual(["admin"]);
  });

  it("gives employees nothing beyond their own data", () => {
    expect(PEOPLE_ROLE_PERMISSIONS.employee).toEqual([]);
  });
});
