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
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("employment_contracts_workspace_user_idx").on(t.workspaceId, t.userId)],
);

// Idempotency ledger for the 30/7-day expiry notices. Keyed on the expiry
// date too, so extending a contract re-arms its notices.
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
