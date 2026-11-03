-- Reverses 0066_people_confidential.sql (P8.3). Applied by `pnpm db:rollback`.
-- Archived people stay deactivated (status 'inactive' is untouched).
ALTER TABLE "payroll_records" DROP COLUMN "gross_salary";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "archived_at";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "contract_end";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "contract_start";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "contract_type";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "pay_currency";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "personal_number_enc";--> statement-breakpoint
DROP TYPE "public"."contract_type";
