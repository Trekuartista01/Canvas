import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// Kosovo official holidays, per workspace (M7.4; P8.2 = the spec's
// `official_holidays`). Since P8.2 every live row is one concrete
// non-working day in `year`; weekend substitutes are rows of their own
// (`is_observed_substitute`). `observed_date` and `is_recurring_fixed` are
// M7.4's model, kept only so migration 0065 can be rolled back — no code
// reads them.
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
    year: integer("year").notNull(),
    nameSq: text("name_sq").notNull(),
    nameEn: text("name_en").notNull(),
    isObservedSubstitute: boolean("is_observed_substitute").notNull().default(false),
    observedDate: date("observed_date"),
    isRecurringFixed: boolean("is_recurring_fixed").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("public_holidays_workspace_id_idx").on(t.workspaceId),
    index("public_holidays_workspace_year_idx").on(t.workspaceId, t.year),
  ],
);

// P8.2: one row per workspace and year once that year's official holidays
// were seeded (so rows HR deleted are never re-seeded), and when HR got the
// December "add next year's holidays" notice.
export const publicHolidayYears = pgTable(
  "public_holiday_years",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    seededAt: timestamp("seeded_at", { withTimezone: true }),
    missingNotifiedAt: timestamp("missing_notified_at", { withTimezone: true }),
  },
  (t) => [unique("public_holiday_years_uniq").on(t.workspaceId, t.year)],
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
