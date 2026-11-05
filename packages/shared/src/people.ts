import type { MembershipRole } from "./roles";

// People roles — hand-synced with the `people_role` pgEnum, same pattern as
// MEMBERSHIP_ROLES/STATUS_KINDS. P8.1 (docs/hr-ops-spec.md): admin runs
// everything except HR data, which only hr_finance sees; ceo and
// operations_manager share one permission set (PEOPLE_ROLE_PERMISSIONS).
export const PEOPLE_ROLES = [
  "admin",
  "ceo",
  "hr_finance",
  "operations_manager",
  "employee",
] as const;
export type PeopleRole = (typeof PEOPLE_ROLES)[number];

/**
 * What someone can ask for when joining. Never Admin, and never effective until
 * an Admin approves it. Employee is what everyone already has.
 */
export const REQUESTABLE_PEOPLE_ROLES = ["hr_finance", "operations_manager", "ceo"] as const;
export type RequestablePeopleRole = (typeof REQUESTABLE_PEOPLE_ROLES)[number];

export const PEOPLE_ROLE_LABELS: Record<PeopleRole, string> = {
  admin: "Admin",
  ceo: "CEO",
  hr_finance: "HR/Finance Manager",
  operations_manager: "Operations Manager",
  employee: "Employee",
};

// Roles that land on the team view after login; everyone else (employees)
// lands on My Tasks.
export const MANAGER_PEOPLE_ROLES: readonly PeopleRole[] = [
  "admin",
  "ceo",
  "hr_finance",
  "operations_manager",
];

// Holding or losing one of these is written to the audit log and announced
// to every HR user (people.setRole).
export const PRIVILEGED_PEOPLE_ROLES: readonly PeopleRole[] = [
  "hr_finance",
  "ceo",
  "operations_manager",
];

/**
 * The workspace owner is always admin, whatever is stored — never HR: being
 * the owner must not open HR data (spec §1, "no admin bypass").
 */
export function effectivePeopleRole(
  membershipRole: MembershipRole,
  storedPeopleRole: PeopleRole,
): PeopleRole {
  return membershipRole === "owner" ? "admin" : storedPeopleRole;
}

// People-side permission actions — a separate closed set from
// WORKSPACE_ACTIONS: they're decided by people_role, not membership rank, and
// aren't grantable through custom roles. See apps/api/src/auth/can.ts.
export const PEOPLE_ACTIONS = [
  "people:viewDirectory",
  // Someone else's confidential profile fields; everyone may see their own.
  "people:viewProfile",
  "people:manageStaff",
  "roles:assign",
  "leave:approve",
  "leave:recordForOthers",
  "payroll:view",
  "payroll:manage",
  "contract:manage",
  "report:viewTeam",
  "performance:view",
  "holiday:manage",
  // M7.6: the company document library (everyone reads it; HR keeps it).
  "companyDocument:manage",
  "tasks:manageTeam",
  // The HR access log (audit_log).
  "hr:audit",
  "clients:manage",
  "boards:manageAll",
] as const;
export type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

const HR_DATA_ACTIONS = [
  "people:viewProfile",
  "people:manageStaff",
  "leave:approve",
  "leave:recordForOthers",
  "payroll:view",
  "payroll:manage",
  "contract:manage",
  "holiday:manage",
  "hr:audit",
] as const satisfies readonly PeopleAction[];

const TEAM_ACTIONS = [
  "people:viewDirectory",
  "report:viewTeam",
  "performance:view",
  "tasks:manageTeam",
] as const satisfies readonly PeopleAction[];

const OPS_ACTIONS = [
  ...TEAM_ACTIONS,
  "clients:manage",
  "boards:manageAll",
] as const satisfies readonly PeopleAction[];

/**
 * The one place roles map to permissions (spec §1). HR data actions belong
 * to hr_finance alone — admin's set deliberately has none of them.
 */
export const PEOPLE_ROLE_PERMISSIONS: Record<PeopleRole, readonly PeopleAction[]> = {
  admin: [...OPS_ACTIONS, "roles:assign", "companyDocument:manage"],
  ceo: OPS_ACTIONS,
  operations_manager: OPS_ACTIONS,
  hr_finance: [...HR_DATA_ACTIONS, ...TEAM_ACTIONS, "companyDocument:manage"],
  // P8.3 (spec §5): everyone sees the directory (public fields only).
  employee: ["people:viewDirectory"],
};

export function peopleRoleHas(role: PeopleRole, action: PeopleAction): boolean {
  return PEOPLE_ROLE_PERMISSIONS[role].includes(action);
}

/** True for actions that touch confidential HR data (never admin's). */
export function isHrDataAction(action: PeopleAction): boolean {
  return (HR_DATA_ACTIONS as readonly PeopleAction[]).includes(action);
}

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

// P8.3 confidential employment terms (spec §5) — HR only.
export const CONTRACT_TYPES = ["fixed_term", "open_ended"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  fixed_term: "Fixed-term (me afat)",
  open_ended: "Open-ended (pa afat)",
};
export const PAY_CURRENCIES = ["EUR", "USD", "CHF", "GBP", "ALL"] as const;
export type PayCurrency = (typeof PAY_CURRENCIES)[number];

/**
 * What the person inviting can choose. `role` is the workspace access and
 * `peopleRole` the job role applied on joining; without one they join as
 * Employee and may still ask for a role themselves. Anything but Employee and
 * Guest needs roles:assign.
 */
export const INVITE_ROLE_CHOICES = [
  {
    value: "member",
    label: "Employee",
    description: "Their own tasks, leave and daily reports.",
    role: "member",
  },
  {
    value: "operations_manager",
    label: PEOPLE_ROLE_LABELS.operations_manager,
    description: "Runs the team's tasks, clients and boards.",
    role: "member",
    peopleRole: "operations_manager",
  },
  {
    value: "ceo",
    label: PEOPLE_ROLE_LABELS.ceo,
    description: "Sees the team's work, clients and boards.",
    role: "member",
    peopleRole: "ceo",
  },
  {
    value: "hr_finance",
    label: PEOPLE_ROLE_LABELS.hr_finance,
    description: "Staff records, leave approvals, payroll and contracts.",
    role: "member",
    peopleRole: "hr_finance",
  },
  {
    value: "admin",
    label: PEOPLE_ROLE_LABELS.admin,
    description: "Runs the workspace and assigns roles. No access to HR data.",
    role: "admin",
    peopleRole: "admin",
  },
  {
    value: "guest",
    label: "Guest",
    description: "Limited access to what's shared with them.",
    role: "guest",
  },
] as const satisfies readonly {
  value: string;
  label: string;
  description: string;
  role: Exclude<MembershipRole, "owner">;
  peopleRole?: Exclude<PeopleRole, "employee">;
}[];
