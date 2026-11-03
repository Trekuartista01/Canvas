-- P8.3 (docs/hr-ops-spec.md §5): confidential people fields + archiving.
-- Reversed by down/0066_people_confidential.down.sql.
CREATE TYPE "public"."contract_type" AS ENUM('fixed_term', 'open_ended');--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "personal_number_enc" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "pay_currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "contract_type" "contract_type";--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "contract_start" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "contract_end" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "gross_salary" numeric(12, 2);--> statement-breakpoint
-- Deactivated (M7.1) = archived (spec §5).
UPDATE "employee_profiles" SET "archived_at" = COALESCE("deactivated_at", "updated_at") WHERE "status" = 'inactive';
