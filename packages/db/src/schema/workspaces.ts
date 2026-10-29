import { index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member", "guest"]);

// M7.1 People (HR) role — orthogonal to `membership_role`, which keeps
// governing workspace/content permissions (rank + custom roles). This one
// governs the HR side: directory, staff management, leave, payroll, team
// reporting. Hand-synced with PEOPLE_ROLES in packages/shared. The
// workspace owner is always treated as super_admin regardless of the value
// stored here (see effectivePeopleRole).
export const peopleRole = pgEnum("people_role", [
  "super_admin",
  "hr",
  "operation_manager",
  "staff_manager",
  "staff",
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("internal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A named set of permission deltas layered on top of a membership's base
// `role` rank — see apps/api/src/auth/can.ts. `grants`/`revokes` are
// WorkspaceAction[]; validated against the closed WORKSPACE_ACTIONS set at
// the tRPC boundary, not the DB (jsonb, like every other *_json config
// column in this schema — actions_json, config_json).
//
// **Account-level, not workspace-scoped** (revised from the original
// per-workspace design — see PROGRESS.md's 2026-07-28 decision): a role
// belongs to the user who created it (`createdBy`), not to a single
// workspace. It's usable for assignment in any workspace where that
// creator currently holds a membership (see role.ts's `visibleIn` join) —
// the same "same team, several workspaces, one shared role library"
// relationship a real org chart has, without introducing a whole new
// organization/account tier above workspaces just for this.
export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseRole: membershipRole("base_role").notNull(),
    grants: jsonb("grants").notNull().default([]),
    revokes: jsonb("revokes").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [unique().on(table.createdBy, table.name)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    // Optional: when set, this membership's effective permissions are the
    // custom role's grants/revokes layered on top of `role`'s rank instead
    // of `role`'s rank alone — see can().  `role` stays required regardless
    // (still the floor, and still what owner-protection/invites read).
    customRoleId: uuid("custom_role_id").references(() => customRoles.id, { onDelete: "set null" }),
    // M7.1: replaces the old is_operations_manager flag — people_role
    // 'operation_manager' is who task.ts's notifyOperationsManagers reaches.
    peopleRole: peopleRole("people_role").notNull().default("staff"),
    // "Reports to" — the direct manager. Staff managers act only on members
    // whose managerUserId is themselves (can()'s team-scoped people actions).
    managerUserId: uuid("manager_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    unique().on(table.workspaceId, table.userId),
    // The unique constraint's leading column (workspaceId) covers "list
    // members of workspace X"; "list workspaces user X belongs to"
    // (workspace.listMine, hit on every page load) needs its own index.
    index("memberships_user_id_idx").on(table.userId),
  ],
);

// Not in DATA_MODEL.md — added for M0.2's invite flow. See PROGRESS.md.
export const invites = pgTable("invites", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: membershipRole("role").notNull(),
  // Optional: carried onto the membership created when this invite is
  // accepted (see workspace.acceptInvite) — same "role is still the floor,
  // custom role layers permission deltas on top" relationship as
  // memberships.customRoleId above.
  customRoleId: uuid("custom_role_id").references(() => customRoles.id, { onDelete: "set null" }),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activity = pgTable(
  "activity",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    verb: text("verb").notNull(),
    payloadJson: jsonb("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_workspace_id_idx").on(table.workspaceId),
    // Task-detail (and similar) activity feeds filter by exactly this pair
    // (activity.ts's list query) — every mutation writes a row here, so
    // this table grows unbounded and needs a supporting index rather than
    // relying on the workspace-scoped one above to narrow it down.
    index("activity_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activity.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Hot: NotificationsBell polls this every 30s for every signed-in user.
  (table) => [index("notifications_user_id_idx").on(table.userId)],
);
