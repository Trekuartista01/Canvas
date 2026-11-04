-- P8.6: many files per contract, contract type, the end-date alert flag.
-- Reversed by down/0069_contract_files.down.sql.
CREATE TABLE "contract_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"order_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contract_files_attachment_uniq" UNIQUE("attachment_id")
);
--> statement-breakpoint
ALTER TABLE "employment_contracts" ALTER COLUMN "attachment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD COLUMN "contract_type" "contract_type";--> statement-breakpoint
ALTER TABLE "employment_contracts" ADD COLUMN "end_alert_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_contract_id_employment_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."employment_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_files_contract_idx" ON "contract_files" USING btree ("contract_id");--> statement-breakpoint
ALTER TABLE "contract_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Every existing contract's one file becomes its first contract_files row
-- (the contract's own UUIDv7 id is reused: unique, and time-ordered).
INSERT INTO "contract_files" ("id", "contract_id", "attachment_id", "order_key", "uploaded_by", "created_at")
SELECT "id", "id", "attachment_id", 'a0', "uploaded_by", "created_at" FROM "employment_contracts" WHERE "attachment_id" IS NOT NULL;
