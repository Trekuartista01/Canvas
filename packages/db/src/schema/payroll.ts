import { numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./auth";
import { workspaces } from "./workspaces";

// M7.7 — HR-only (payroll:view / payroll:manage). The ID-card number and
// IBAN are only ever stored encrypted (AES-256-GCM, apps/api/src/lib/
// field-crypto.ts, key PAYROLL_ENCRYPTION_KEY); every read, edit and export
// writes an activity row, which is the payroll audit trail.
export const payrollRecords = pgTable(
  "payroll_records",
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
    netSalaryEur: numeric("net_salary_eur", { precision: 12, scale: 2, mode: "number" }),
    idCardNumberEnc: text("id_card_number_enc"),
    bankName: text("bank_name"),
    ibanEnc: text("iban_enc"),
    accountHolder: text("account_holder"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("payroll_records_workspace_user_uniq").on(t.workspaceId, t.userId)],
);
