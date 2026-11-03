import { date, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { memberships } from "./workspaces";

export const employeeStatus = pgEnum("employee_status", ["active", "inactive"]);
export const contractType = pgEnum("contract_type", ["fixed_term", "open_ended"]);

// M7.1 staff profile — HR data about a member of one workspace, so it hangs
// off the membership rather than the (global) user. Optional: a membership
// with no row here is an active member with an empty profile; HR creates the
// row on first edit. Deactivating (status 'inactive') blocks that member from
// the workspace (lib/membership.ts treats them as a non-member) and hides
// them from pickers, but keeps the membership and all history intact.
// P8.3: that is "archiving" (spec §5) — status 'inactive' + archived_at.
// The personal number, pay currency and contract terms are confidential:
// only HR ever receives them (people.confidential); the personal number is
// stored encrypted like payroll's secrets.
export const employeeProfiles = pgTable("employee_profiles", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  membershipId: uuid("membership_id")
    .notNull()
    .unique()
    .references(() => memberships.id, { onDelete: "cascade" }),
  phone: text("phone"),
  address: text("address"),
  dateOfBirth: date("date_of_birth"),
  jobTitle: text("job_title"),
  department: text("department"),
  employmentStartDate: date("employment_start_date"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  personalNumberEnc: text("personal_number_enc"),
  payCurrency: text("pay_currency").notNull().default("EUR"),
  contractType: contractType("contract_type"),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  status: employeeStatus("status").notNull().default("active"),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
