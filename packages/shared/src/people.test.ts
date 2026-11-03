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
import { updateConfidentialSchema } from "./schemas/people";

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

  it("gives employees only the directory beyond their own data (P8.3)", () => {
    expect(PEOPLE_ROLE_PERMISSIONS.employee).toEqual(["people:viewDirectory"]);
  });
});

describe("updateConfidentialSchema (P8.3)", () => {
  const base = {
    workspaceId: "0190a000-0000-7000-8000-000000000001",
    userId: "0190a000-0000-7000-8000-000000000002",
  };
  it("clears a date sent as an empty string and keeps untouched fields undefined", () => {
    const parsed = updateConfidentialSchema.parse({ ...base, contractEnd: "", grossSalary: 950 });
    expect(parsed.contractEnd).toBeNull();
    expect(parsed.grossSalary).toBe(950);
    expect(parsed.personalNumber).toBeUndefined();
  });
  it("refuses a contract that ends before it starts, and unknown currencies", () => {
    expect(
      updateConfidentialSchema.safeParse({
        ...base,
        contractStart: "2026-06-01",
        contractEnd: "2026-05-31",
      }).success,
    ).toBe(false);
    expect(updateConfidentialSchema.safeParse({ ...base, payCurrency: "XYZ" }).success).toBe(false);
    expect(updateConfidentialSchema.safeParse({ ...base, grossSalary: -1 }).success).toBe(false);
  });
});
