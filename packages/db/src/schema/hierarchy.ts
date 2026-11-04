import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { brandSettings } from "./image-brain";
import { workspaces } from "./workspaces";

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    orderKey: text("order_key").notNull(),
    // Optional per-space brand kit override (e.g. a client's own space uses
    // their kit); falls back to the workspace's is_default kit when unset.
    brandKitId: uuid("brand_kit_id").references(() => brandSettings.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("spaces_workspace_id_idx").on(table.workspaceId)],
);

// P8.9 (spec §10): who is on a board. boards:manageAll roles reach every board
// without a row here; everyone else needs one to see a board or its cards.
export const spaceMembers = pgTable(
  "space_members",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("space_members_space_user_uniq").on(table.spaceId, table.userId),
    index("space_members_user_idx").on(table.userId),
  ],
);

// P8.10 (spec §11): who a card is for. A client's folder is a filtered view of
// the cards linked to it; the cards stay on their boards.
export const clients = pgTable(
  "clients",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default([]),
    logoKey: text("logo_key"),
    color: text("color").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("clients_workspace_id_idx").on(table.workspaceId)],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    orderKey: text("order_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("folders_space_id_idx").on(table.spaceId)],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    orderKey: text("order_key").notNull(),
    // P8.9: an archived list leaves the board with its cards, and can be restored.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("lists_space_id_idx").on(table.spaceId),
    index("lists_folder_id_idx").on(table.folderId),
  ],
);

// Phase 6: overrides a role's (or custom role's) default allow/deny for one
// WorkspaceAction, scoped to everything under this one space — the most
// specific layer `can()` consults, ahead of a custom role's grants/revokes
// and the base rank table. `principal` is "role:<name>" or
// "customRole:<id>", a synthetic key rather than two nullable columns, so
// uniqueness doesn't need Postgres's NULL-is-distinct workaround.
export const spacePermissionOverrides = pgTable(
  "space_permission_overrides",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    principal: text("principal").notNull(),
    action: text("action").notNull(),
    allow: boolean("allow").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.spaceId, table.principal, table.action)],
);
