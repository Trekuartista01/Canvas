CREATE TYPE "public"."contract_kind" AS ENUM('contract', 'annex', 'amendment');--> statement-breakpoint
CREATE TABLE "company_document_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_document_versions_uniq" UNIQUE("document_id","version")
);
--> statement-breakpoint
CREATE TABLE "company_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_id" uuid,
	"title" text NOT NULL,
	"attachment_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contract_expiry_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"threshold_days" integer NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_expiry_notices_uniq" UNIQUE("contract_id","threshold_days","expiry_date")
);
--> statement-breakpoint
CREATE TABLE "employment_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "contract_kind" NOT NULL,
	"parent_contract_id" uuid,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"expiry_date" date,
	"attachment_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_document_categories" ADD CONSTRAINT "company_document_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_versions" ADD CONSTRAINT "company_document_versions_document_id_company_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."company_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_versions" ADD CONSTRAINT "company_document_versions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_versions" ADD CONSTRAINT "company_document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_category_id_company_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."company_document_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_expiry_notices" ADD CONSTRAINT "contract_expiry_notices_contract_id_employment_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."employment_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_parent_contract_id_employment_contracts_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."employment_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_documents_workspace_idx" ON "company_documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "employment_contracts_workspace_user_idx" ON "employment_contracts" USING btree ("workspace_id","user_id");