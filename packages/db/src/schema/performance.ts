import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// M7.8 — one row per workspace per month ("YYYY-MM"), written by the
// scheduler on the 1st for the month before. user_id is null when nobody
// qualified (the row still marks the month as computed). breakdown_json is
// the full ranking ({ winner, ranking: [...] }) the admin result panel shows.
export const employeeOfMonth = pgTable(
  "employee_of_month",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    score: integer("score"),
    breakdownJson: jsonb("breakdown_json").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("employee_of_month_workspace_month_uniq").on(t.workspaceId, t.month)],
);
