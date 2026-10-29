import { db, schema } from "@canvas/db";
import { effectivePeopleRole, type PeopleRole } from "@canvas/shared";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";

/**
 * The membership row plus its employee-profile status, including
 * deactivated members. Use this only where an inactive member still has to
 * be found (HR reactivating them, owner/removal checks); everything that
 * decides what someone may *do* goes through the active-only helpers below.
 */
export async function findMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ membership: schema.memberships, status: schema.employeeProfiles.status })
    .from(schema.memberships)
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
    )
    .limit(1);
  if (!row) return null;
  // No profile row yet = an active member with an empty profile.
  return { ...row.membership, active: row.status !== "inactive" };
}

// M7.1: a deactivated member (employee_profiles.status = 'inactive') is
// treated as a non-member here — every can()/assertCan check fails, which is
// what "deactivating blocks login for that workspace" means. Their
// membership and history are untouched.
async function findActiveMembership(workspaceId: string, userId: string) {
  const membership = await findMembership(workspaceId, userId);
  return membership?.active ? membership : null;
}

export async function getMembershipRole(workspaceId: string, userId: string) {
  return (await findActiveMembership(workspaceId, userId))?.role ?? null;
}

// Like getMembershipRole, but also surfaces the custom role id (if any) so
// callers that need to resolve grants/revokes (assertCan) don't have to
// re-query. Kept separate from getMembershipRole rather than changing its
// return shape — several call sites (workspace.ts's updateMemberRole/
// removeMember) destructure a plain role string directly.
export async function getMembershipContext(workspaceId: string, userId: string) {
  const membership = await findActiveMembership(workspaceId, userId);
  return { role: membership?.role ?? null, customRoleId: membership?.customRoleId ?? null };
}

/** The acting member's People-side context, or null if not an active member. */
export async function getPeopleContext(
  workspaceId: string,
  userId: string,
): Promise<{ membershipId: string; peopleRole: PeopleRole; managerUserId: string | null } | null> {
  const membership = await findActiveMembership(workspaceId, userId);
  if (!membership) return null;
  return {
    membershipId: membership.id,
    peopleRole: effectivePeopleRole(membership.role, membership.peopleRole),
    managerUserId: membership.managerUserId,
  };
}

/**
 * WHERE-clause fragment for "this membership isn't deactivated". Pair with
 * `.leftJoin(schema.employeeProfiles, eq(schema.employeeProfiles.membershipId,
 * schema.memberships.id))` — members with no profile row count as active.
 */
export const activeMembershipCondition = or(
  isNull(schema.employeeProfiles.status),
  eq(schema.employeeProfiles.status, "active"),
);

export async function listActiveMemberIds(workspaceId: string, extra?: SQL) {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .where(and(eq(schema.memberships.workspaceId, workspaceId), activeMembershipCondition, extra));
  return rows.map((r) => r.userId);
}
