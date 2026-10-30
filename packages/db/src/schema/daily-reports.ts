import {
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// M7.3 end-of-day report: one per member per (Kosovo) calendar day. The
// author can keep editing it until midnight Europe/Belgrade — after that
// report_date is no longer "today" and the save path refuses it.
export const dailyReports = pgTable(
  "daily_reports",
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
    reportDate: date("report_date").notNull(),
    bodyJson: jsonb("body_json").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("daily_reports_workspace_user_date_uniq").on(t.workspaceId, t.userId, t.reportDate),
    index("daily_reports_workspace_date_idx").on(t.workspaceId, t.reportDate),
  ],
);

// Read receipts: the first time someone other than the author opens a report.
export const dailyReportReads = pgTable(
  "daily_report_reads",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => dailyReports.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.userId] })],
);

// The 16:45 reminder's idempotency ledger: a row is claimed before the
// reminder goes out, so a second scheduler tick (or a second worker) can't
// remind the same person twice on the same day.
export const dailyReportReminders = pgTable(
  "daily_report_reminders",
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
    reportDate: date("report_date").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("daily_report_reminders_workspace_user_date_uniq").on(
      t.workspaceId,
      t.userId,
      t.reportDate,
    ),
  ],
);
