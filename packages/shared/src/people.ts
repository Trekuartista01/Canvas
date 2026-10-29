import type { MembershipRole } from "./roles";

// M7.1 People (HR) roles — hand-synced with the `people_role` pgEnum, same
// pattern as MEMBERSHIP_ROLES/STATUS_KINDS.
export const PEOPLE_ROLES = [
  "super_admin",
  "hr",
  "operation_manager",
  "staff_manager",
  "staff",
] as const;
export type PeopleRole = (typeof PEOPLE_ROLES)[number];

export const PEOPLE_ROLE_LABELS: Record<PeopleRole, string> = {
  super_admin: "Super admin",
  hr: "HR",
  operation_manager: "Operations manager",
  staff_manager: "Staff manager",
  staff: "Staff",
};

// Roles that land on the team view after login; everyone else (staff) lands
// on My Tasks.
export const MANAGER_PEOPLE_ROLES: readonly PeopleRole[] = [
  "super_admin",
  "hr",
  "operation_manager",
  "staff_manager",
];

/** The workspace owner is always treated as super_admin, whatever is stored. */
export function effectivePeopleRole(
  membershipRole: MembershipRole,
  storedPeopleRole: PeopleRole,
): PeopleRole {
  return membershipRole === "owner" ? "super_admin" : storedPeopleRole;
}

// People-side permission actions — a separate closed set from
// WORKSPACE_ACTIONS: they're decided by people_role, not membership rank, and
// aren't grantable through custom roles. See apps/api/src/auth/can.ts.
export const PEOPLE_ACTIONS = [
  "people:viewDirectory",
  "people:viewProfile",
  "people:manageStaff",
  "people:assignSuperAdmin",
  "leave:approve",
  "leave:recordForOthers",
  "payroll:view",
  "payroll:manage",
  "contract:manage",
  "report:viewTeam",
  "performance:view",
  "holiday:manage",
  "tasks:manageTeam",
] as const;
export type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

/**
 * True if making `managerUserId` the manager of `userId` would create a
 * reporting loop (A reports to B reports to … A). `managerOf` maps each
 * member to their current manager.
 */
export function wouldCreateReportingCycle(
  userId: string,
  managerUserId: string,
  managerOf: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = managerUserId;
  while (current) {
    if (current === userId) return true;
    if (seen.has(current)) return false; // pre-existing loop elsewhere — not ours to judge
    seen.add(current);
    current = managerOf.get(current) ?? null;
  }
  return false;
}
