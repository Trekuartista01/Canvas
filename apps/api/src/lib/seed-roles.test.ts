import { describe, expect, it } from "vitest";
import { parseEmailList, planSeedRoles, type SeedMember } from "./seed-roles";

const member = (email: string, extra: Partial<SeedMember> = {}): SeedMember => ({
  membershipId: `m-${email}`,
  userId: `u-${email}`,
  email,
  membershipRole: "member",
  peopleRole: "employee",
  ...extra,
});

const members = [
  member("owner@x.com", { membershipRole: "owner", peopleRole: "admin" }),
  member("hr@x.com"),
  member("ops@x.com"),
  member("ceo1@x.com"),
  member("ceo2@x.com"),
];

describe("parseEmailList", () => {
  it("splits, trims, lowercases and drops blanks", () => {
    expect(parseEmailList(" A@x.com, ,b@X.com ")).toEqual(["a@x.com", "b@x.com"]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe("planSeedRoles", () => {
  it("assigns HR, ops and both CEOs", () => {
    const { assignments, errors } = planSeedRoles(
      {
        SEED_HR_EMAILS: "hr@x.com",
        SEED_OPS_EMAILS: "ops@x.com",
        SEED_CEO_EMAILS: "ceo1@x.com,CEO2@x.com",
      },
      members,
    );
    expect(errors).toEqual([]);
    expect(assignments.map((a) => [a.email, a.to])).toEqual([
      ["hr@x.com", "hr_finance"],
      ["ops@x.com", "operations_manager"],
      ["ceo1@x.com", "ceo"],
      ["ceo2@x.com", "ceo"],
    ]);
  });

  it("refuses once an HR user exists", () => {
    const withHr = [...members, member("old-hr@x.com", { peopleRole: "hr_finance" })];
    const { assignments, errors } = planSeedRoles({ SEED_HR_EMAILS: "hr@x.com" }, withHr);
    expect(assignments).toEqual([]);
    expect(errors.join()).toMatch(/already has an HR/);
  });

  it("refuses without HR emails, for strangers, the owner and duplicates — and changes nothing", () => {
    expect(planSeedRoles({ SEED_OPS_EMAILS: "ops@x.com" }, members).errors.join()).toMatch(
      /SEED_HR_EMAILS is empty/,
    );
    const { assignments, errors } = planSeedRoles(
      {
        SEED_HR_EMAILS: "hr@x.com,owner@x.com",
        SEED_OPS_EMAILS: "nobody@x.com,hr@x.com",
      },
      members,
    );
    expect(assignments).toEqual([]);
    expect(errors).toEqual([
      "owner@x.com is the workspace owner, who is always admin",
      "nobody@x.com isn't a member of this workspace (sign up / accept an invite first)",
      "hr@x.com is listed for both hr_finance and operations_manager",
    ]);
  });
});
