import {
  ROLE_RANK,
  type MembershipRole,
  type PeopleAction,
  type PeopleRole,
  type WorkspaceAction,
} from "@canvas/shared";
import type { SessionUser } from "./session";

export type { PeopleAction, WorkspaceAction };

const MIN_ROLE: Record<WorkspaceAction, MembershipRole> = {
  "workspace:invite": "admin",
  "workspace:manage": "admin",
  "workspace:delete": "owner",
  "hierarchy:view": "guest",
  "hierarchy:create": "member",
  "hierarchy:update": "member",
  "hierarchy:delete": "admin",
  "status:view": "guest",
  "status:create": "member",
  "status:update": "member",
  "status:delete": "admin",
  "task:view": "guest",
  "task:create": "member",
  "task:update": "member",
  "task:delete": "member",
  "comment:view": "guest",
  // Deliberately guest-level, unlike task:create: commenting is how a
  // guest participates in a task they can already see, not a change to the
  // task itself.
  "comment:create": "guest",
  "tag:view": "guest",
  "tag:create": "member",
  // Deleting a tag removes it from every task that has it — same
  // destructiveness tier as hierarchy:delete/status:delete.
  "tag:delete": "admin",
  "customFieldDef:view": "guest",
  "customFieldDef:create": "member",
  "customFieldDef:update": "member",
  "customFieldDef:delete": "admin",
  // Setting a task's own field value is a task edit, same tier as task:update.
  "customFieldValue:update": "member",
  "attachment:view": "guest",
  // Uploading/removing a file is a task edit, same tier as task:update.
  "attachment:create": "member",
  "attachment:delete": "member",
  "imageAsset:view": "guest",
  // Generating an image costs real money (ai_usage) — same tier as
  // creating a task, not the guest-level "view" tier.
  "imageAsset:create": "member",
  // Same tier as attachment:delete — removing a saved image from the
  // library is ordinary content upkeep, not a workspace-wide concern.
  "imageAsset:delete": "member",
  "imageFolder:view": "guest",
  // Same tier as imageAsset:create/delete — a folder is organizational, and
  // deleting one only unfiles its images rather than deleting them, so it
  // doesn't need tag:delete's admin tier (which removes a tag from every
  // task that has it, a bigger blast radius).
  "imageFolder:create": "member",
  "imageFolder:delete": "member",
  // Own dedicated tier (was reusing imageFolder:view/delete) — same rank
  // either way, kept separate so these two entities' policies can diverge
  // later without one silently changing the other's behavior.
  "libraryCopyItem:view": "guest",
  "libraryCopyItem:delete": "member",
  "brain:view": "guest",
  // Sending a chat message costs real money (ai_usage), same reasoning as
  // imageAsset:create.
  "brain:chat": "member",
  "brandSettings:view": "guest",
  // Workspace brand is an admin concern (same tier as workspace:manage).
  "brandSettings:update": "admin",
  "taskTemplate:view": "guest",
  "taskTemplate:create": "member",
  // Same reasoning as tag:delete — a template is a shared workspace
  // resource other members' "new from template" flow depends on.
  "taskTemplate:delete": "admin",
  "doc:view": "guest",
  "doc:create": "member",
  "doc:update": "member",
  "doc:delete": "member",
  // Same tiers as doc:* — a form is ordinary workspace content, not a
  // shared cross-cutting resource like a tag or template. (Public,
  // unauthenticated submission goes through form.submitPublic, which has
  // no session user and so never calls `can` at all.)
  "form:view": "guest",
  "form:create": "member",
  "form:update": "member",
  "form:delete": "member",
  // Admin tier, unlike form:*/doc:* — an automation runs unattended against
  // every matching task in the workspace and can generate billable AI
  // usage (generate_image), same blast-radius reasoning as
  // brandSettings:update.
  "automation:view": "member",
  "automation:create": "admin",
  "automation:update": "admin",
  "automation:delete": "admin",
  // Member tier, not guest — a dashboard can surface AI usage cost (a
  // financial figure), a step up in sensitivity from ordinary task content
  // that guest-tier views (workload, docs, forms) show. Not admin-only like
  // automations: a dashboard is read-only reporting with no side effects on
  // other members' data, closer in blast radius to a doc than an automation.
  "dashboard:view": "member",
  "dashboard:create": "member",
  "dashboard:update": "member",
  "dashboard:delete": "member",
  // Admin tier, same as automation:create — defining or
  // assigning a custom role changes what OTHER members can do, a bigger
  // blast radius than ordinary content but not a workspace-destroying
  // concern like workspace:delete. Privilege escalation is
  // capped structurally instead (see isGrantable/NON_GRANTABLE below): an
  // admin can never grant an owner-only action through a custom role or
  // space override, so this tier can't be used to mint a second owner.
  "customRole:view": "admin",
  "customRole:create": "admin",
  "customRole:update": "admin",
  "customRole:delete": "admin",
  "spaceOverride:view": "admin",
  "spaceOverride:manage": "admin",
  // Admin tier — a bulk export is an entire workspace's worth of content
  // leaving the app in one file — same tier as any whole-workspace bulk operation.
  "export:run": "admin",
  // Admin tier — seeing every member's individual time entries and AI
  // spend across the whole workspace is a bigger blast radius than
  // dashboard:view's pre-aggregated cost figure (member tier); grantable
  // via a custom role (e.g. a "Finance Manager" template) same as any
  // other admin-tier action above.
  "timeEntry:viewAll": "admin",
  // Same tier as brain:chat/imageAsset:create — costs real money (ai_usage),
  // not a workspace-wide concern. Editing the underlying brand kit (voice/
  // colors/fonts) still requires brandSettings:update (admin).
  "copyGeneration:create": "member",
};

// Actions a custom role's grants or a space override's `allow: true` can
// never include — owner-only actions like workspace:delete carry
// workspace-wide destructive power and must stay strictly rank-gated so an
// admin can't use customRole:create (its own admin-tier action) to mint a
// second owner.
export function isGrantable(action: WorkspaceAction): boolean {
  return MIN_ROLE[action] !== "owner";
}

export interface WorkspaceResource {
  type: "workspace";
  /** The acting user's membership role in this workspace, or null if not a member. */
  role: MembershipRole | null;
  /**
   * Set when the membership has a custom role: permission deltas layered on
   * top of `role`'s rank. `revokes` beats `grants` beats the rank table.
   */
  customRole?: { grants: WorkspaceAction[]; revokes: WorkspaceAction[] } | null;
  /**
   * Set when a space-level override was resolved for this exact
   * (space, principal, action) — see lib/space-overrides.ts. The most
   * specific layer: when present it decides the outcome outright, ahead of
   * both the custom role and the rank table.
   */
  spaceOverride?: boolean | null;
}

// M7.1 People (HR) permissions — decided by the member's effective people
// role (owner ⇒ super_admin), not membership rank, and not grantable through
// custom roles. `team` marks actions a staff_manager may take only for their
// own direct reports (memberships.manager_user_id = them): the resource-level
// half of the check, same "role here, ownership in the caller" split private
// resources use elsewhere.
const PEOPLE_MATRIX: Record<PeopleAction, { roles: readonly PeopleRole[]; team?: true }> = {
  "people:viewDirectory": { roles: ["super_admin", "hr", "operation_manager", "staff_manager"] },
  // Everyone may also view their own profile — see the isSelf branch below.
  "people:viewProfile": {
    roles: ["super_admin", "hr", "operation_manager", "staff_manager"],
    team: true,
  },
  "people:manageStaff": { roles: ["super_admin", "hr"] },
  // Granting or removing super_admin (or deactivating one) — HR can't mint
  // a peer above themselves.
  "people:assignSuperAdmin": { roles: ["super_admin"] },
  "leave:approve": {
    roles: ["super_admin", "hr", "operation_manager", "staff_manager"],
    team: true,
  },
  "leave:recordForOthers": { roles: ["super_admin", "hr"] },
  "payroll:view": { roles: ["super_admin", "hr"] },
  "payroll:manage": { roles: ["super_admin", "hr"] },
  "contract:manage": { roles: ["super_admin", "hr"] },
  "report:viewTeam": {
    roles: ["super_admin", "hr", "operation_manager", "staff_manager"],
    team: true,
  },
  "performance:view": {
    roles: ["super_admin", "hr", "operation_manager", "staff_manager"],
    team: true,
  },
  "holiday:manage": { roles: ["super_admin", "hr"] },
  "companyDocument:manage": { roles: ["super_admin", "hr"] },
  // M7.2: also "approve"/"reject"/"transfer" on tasks. Besides these roles,
  // the task's creator qualifies (target.isCreator) — see lib/task-transition.ts.
  "tasks:manageTeam": {
    roles: ["super_admin", "hr", "operation_manager", "staff_manager"],
    team: true,
  },
};

export interface PeopleResource {
  type: "people";
  /** The acting user's effective people role, or null if not an active member. */
  peopleRole: PeopleRole | null;
  /**
   * The member being acted on, when the action targets one person. Omitted
   * for list-level checks (e.g. "may view team reports at all") — a
   * staff_manager passes those, and the caller must then scope its query to
   * their direct reports (see teamScopeFor in lib/permissions.ts).
   */
  target?: { isSelf: boolean; isDirectReport: boolean; isCreator?: boolean };
}

export function can(
  user: SessionUser,
  action: WorkspaceAction,
  resource: WorkspaceResource,
): boolean;
export function can(user: SessionUser, action: PeopleAction, resource: PeopleResource): boolean;
export function can(
  _user: SessionUser,
  action: WorkspaceAction | PeopleAction,
  resource: WorkspaceResource | PeopleResource,
): boolean {
  if (resource.type === "people") {
    return canPeople(action as PeopleAction, resource);
  }
  return canWorkspace(action as WorkspaceAction, resource);
}

function canPeople(action: PeopleAction, resource: PeopleResource): boolean {
  if (!resource.peopleRole) return false;
  if (action === "people:viewProfile" && resource.target?.isSelf) return true;
  if (action === "tasks:manageTeam" && resource.target?.isCreator) return true;

  const rule = PEOPLE_MATRIX[action];
  if (!rule.roles.includes(resource.peopleRole)) return false;
  if (resource.peopleRole !== "staff_manager" || !resource.target) return true;
  return rule.team === true && resource.target.isDirectReport;
}

function canWorkspace(action: WorkspaceAction, resource: WorkspaceResource): boolean {
  if (!resource.role) return false;
  if (resource.spaceOverride !== undefined && resource.spaceOverride !== null) {
    return resource.spaceOverride;
  }

  const baseAllowed = ROLE_RANK[resource.role] >= ROLE_RANK[MIN_ROLE[action]];
  if (!resource.customRole) return baseAllowed;
  if (resource.customRole.revokes.includes(action)) return false;
  if (resource.customRole.grants.includes(action)) return true;
  return baseAllowed;
}
