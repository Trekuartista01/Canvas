import type { PeopleRole } from "@canvas/shared";

/**
 * P8.1 bootstrap (`pnpm seed:roles`): who becomes HR, Operations Manager and
 * CEO, from SEED_HR_EMAILS / SEED_OPS_EMAILS / SEED_CEO_EMAILS (comma
 * separated). Pure — scripts/seed-roles.ts loads the members and applies it.
 */
export interface SeedMember {
  membershipId: string;
  userId: string;
  email: string;
  membershipRole: string;
  peopleRole: PeopleRole;
}

export interface SeedAssignment {
  membershipId: string;
  userId: string;
  email: string;
  from: PeopleRole;
  to: PeopleRole;
}

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The role changes to make, or the reasons not to make any. Refuses when the
 * workspace already has an HR user (it's a one-off bootstrap), when there's
 * no HR email at all, for an email that's in two lists, isn't a member, or is
 * the owner (always admin).
 */
export function planSeedRoles(
  env: { SEED_HR_EMAILS?: string; SEED_OPS_EMAILS?: string; SEED_CEO_EMAILS?: string },
  members: SeedMember[],
): { assignments: SeedAssignment[]; errors: string[] } {
  const errors: string[] = [];
  const wanted: [PeopleRole, string[]][] = [
    ["hr_finance", parseEmailList(env.SEED_HR_EMAILS)],
    ["operations_manager", parseEmailList(env.SEED_OPS_EMAILS)],
    ["ceo", parseEmailList(env.SEED_CEO_EMAILS)],
  ];

  if (members.some((m) => m.peopleRole === "hr_finance")) {
    errors.push(
      "This workspace already has an HR/Finance Manager — seed:roles only bootstraps the first one",
    );
  }
  if (wanted[0]![1].length === 0) errors.push("SEED_HR_EMAILS is empty");

  const seen = new Map<string, PeopleRole>();
  const assignments: SeedAssignment[] = [];
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
  for (const [role, emails] of wanted) {
    for (const email of emails) {
      const earlier = seen.get(email);
      if (earlier) {
        errors.push(`${email} is listed for both ${earlier} and ${role}`);
        continue;
      }
      seen.set(email, role);
      const member = byEmail.get(email);
      if (!member) {
        errors.push(`${email} isn't a member of this workspace (sign up / accept an invite first)`);
        continue;
      }
      if (member.membershipRole === "owner") {
        errors.push(`${email} is the workspace owner, who is always admin`);
        continue;
      }
      assignments.push({
        membershipId: member.membershipId,
        userId: member.userId,
        email,
        from: member.peopleRole,
        to: role,
      });
    }
  }
  return errors.length > 0 ? { assignments: [], errors } : { assignments, errors };
}
