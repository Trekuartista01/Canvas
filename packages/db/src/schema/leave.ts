import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { attachments } from "./attachments";
import { users } from "./auth";
import { workspaces } from "./workspaces";

export const leaveType = pgEnum("leave_type", [
  "sick",
  "vacation",
  "personal",
  "maternity",
  "paternity",
  "emergency",
]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);

// M7.5. `working_days` is computed server-side when the request is made —
// weekends and the workspace's observed public holidays excluded
// (apps/api/src/lib/working-days.ts) — and kept, so a holiday HR adds later
// doesn't silently rewrite an approved request. Numeric so half days stay
// possible later; whole days for now.
export const leaveRequests = pgTable(
  "leave_requests",
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
    type: leaveType("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    workingDays: numeric("working_days", { precision: 5, scale: 1, mode: "number" }).notNull(),
    reason: text("reason"),
    status: leaveStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    // Set when HR records leave on someone's behalf (approved immediately).
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    // e.g. a doctor's note. An attachments row with no task/comment — only
    // the employee and whoever may approve their leave can download it.
    documentAttachmentId: uuid("document_attachment_id").references(() => attachments.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_workspace_user_idx").on(t.workspaceId, t.userId),
    index("leave_requests_workspace_dates_idx").on(t.workspaceId, t.startDate, t.endDate),
  ],
);

// One row per member per year. Both numbers nullable on purpose:
// entitlement null = the workspace default (workspaces.default_vacation_days);
// carried_over null = not computed yet — the year-rollover scheduler job
// fills it in exactly once (lib/leave-carry-over.ts).
export const leaveBalances = pgTable(
  "leave_balances",
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
    year: integer("year").notNull(),
    entitlementDays: numeric("entitlement_days", { precision: 5, scale: 1, mode: "number" }),
    carriedOverDays: numeric("carried_over_days", { precision: 5, scale: 1, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("leave_balances_user_workspace_year_uniq").on(t.userId, t.workspaceId, t.year)],
);
