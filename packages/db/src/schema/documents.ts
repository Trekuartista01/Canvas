import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { attachments } from "./attachments";
import { users } from "./auth";
import { contractType } from "./people";
import { workspaces } from "./workspaces";

export const contractKind = pgEnum("contract_kind", ["contract", "annex", "amendment"]);

// M7.6. The file is an attachments row stored under contracts/… — only the
// employee and HR (contract:manage) can download it. Replacing the file
// points attachment_id at a new row and keeps the old one.
export const employmentContracts = pgTable(
  "employment_contracts",
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
    kind: contractKind("kind").notNull(),
    // An annex/amendment belongs to a contract; a contract has no parent.
    parentContractId: uuid("parent_contract_id").references(
      (): AnyPgColumn => employmentContracts.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    startDate: date("start_date").notNull(),
    expiryDate: date("expiry_date"),
    // P8.6: superseded by contract_files (one contract, many files/pages).
    // Kept, nullable and no longer written, so the down migration can
    // restore it; 0069 copied every existing file into contract_files.
    attachmentId: uuid("attachment_id").references(() => attachments.id),
    // P8.6: fixed-term / open-ended, shown on the Contracts page.
    contractType: contractType("contract_type"),
    // P8.6: the one-working-day-before alert went out (spec §6). Cleared
    // when the end date changes or a file is uploaded for the contract.
    endAlertSentAt: timestamp("end_alert_sent_at", { withTimezone: true }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("employment_contracts_workspace_user_idx").on(t.workspaceId, t.userId)],
);

// P8.6: the files of one contract (a multi-page contract is several photos),
// in order_key order. Each is a private attachments row under hr/contracts/.
// Replacing a file points the row at a new attachment; delete is soft.
export const contractFiles = pgTable(
  "contract_files",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => employmentContracts.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    orderKey: text("order_key").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("contract_files_contract_idx").on(t.contractId),
    unique("contract_files_attachment_uniq").on(t.attachmentId),
  ],
);

// The old M7.6 30/7-day notice ledger. P8.6 replaced those notices with one
// alert (end_alert_sent_at); kept as history, no longer written.
export const contractExpiryNotices = pgTable(
  "contract_expiry_notices",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => employmentContracts.id, { onDelete: "cascade" }),
    thresholdDays: integer("threshold_days").notNull(),
    expiryDate: date("expiry_date").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("contract_expiry_notices_uniq").on(t.contractId, t.thresholdDays, t.expiryDate)],
);

export const companyDocumentCategories = pgTable("company_document_categories", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Everyone can read these. attachment_id is the current version; every
// version (current included) is in company_document_versions.
export const companyDocuments = pgTable(
  "company_documents",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => companyDocumentCategories.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("company_documents_workspace_idx").on(t.workspaceId)],
);

export const companyDocumentVersions = pgTable(
  "company_document_versions",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    documentId: uuid("document_id")
      .notNull()
      .references(() => companyDocuments.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    version: integer("version").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("company_document_versions_uniq").on(t.documentId, t.version)],
);
