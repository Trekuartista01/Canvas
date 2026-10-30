import { boolean, date, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// M7.4 Kosovo public holiday calendar, per workspace. A recurring fixed-date
// holiday (Jan 1, Feb 17, …) is one row whose `date` anchors the month/day
// for every year; a movable one (Easter Mondays, Eids) is one row per year.
// `observed_date` is an HR override — null means "by the rule" (a weekend
// holiday moves to the next working day that isn't already a holiday; see
// packages/shared/src/holidays.ts), computed per year at read time.
export const publicHolidays = pgTable(
  "public_holidays",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
    observedDate: date("observed_date"),
    isRecurringFixed: boolean("is_recurring_fixed").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("public_holidays_workspace_id_idx").on(t.workspaceId)],
);

// Idempotency ledger for the "holiday in N days" notice: one row per
// workspace, holiday and day off, claimed before anyone is notified.
export const publicHolidayNotices = pgTable(
  "public_holiday_notices",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    holidayId: uuid("holiday_id")
      .notNull()
      .references(() => publicHolidays.id, { onDelete: "cascade" }),
    observedDate: date("observed_date").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("public_holiday_notices_uniq").on(t.workspaceId, t.holidayId, t.observedDate)],
);
