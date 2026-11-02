import { index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// P8.1 (docs/hr-ops-spec.md §1): every view, download, create, update and
// delete of HR data, plus every role change. Readable by HR only (hr:audit,
// apps/api/src/trpc/routers/audit.ts). Separate from `activity`, which is the
// general feed and keeps its own rows for mutations.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Null for system actions (the seed script, scheduled jobs).
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    ip: inet("ip"),
    payloadJson: jsonb("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_workspace_created_idx").on(table.workspaceId, table.createdAt)],
);
