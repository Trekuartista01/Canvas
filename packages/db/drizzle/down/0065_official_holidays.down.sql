-- Reverses 0065_official_holidays.sql (P8.2). Applied by `pnpm db:rollback`.
-- Rows that didn't exist before 0065 (seeded years, substitutes, holidays HR
-- added since) are removed; the M7.4 rows keep any rename HR made since.
DELETE FROM "public_holidays" WHERE "id" NOT IN (SELECT "id" FROM "public_holidays_backup_0065");--> statement-breakpoint
DROP INDEX "public_holidays_workspace_year_idx";--> statement-breakpoint
ALTER TABLE "public_holidays" DROP COLUMN "is_observed_substitute";--> statement-breakpoint
ALTER TABLE "public_holidays" DROP COLUMN "name_sq";--> statement-breakpoint
ALTER TABLE "public_holidays" DROP COLUMN "year";--> statement-breakpoint
ALTER TABLE "public_holidays" RENAME COLUMN "name_en" TO "name";--> statement-breakpoint
DROP TABLE "public_holiday_years";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "holiday_weekend_substitution";--> statement-breakpoint
DROP TABLE "public_holidays_backup_0065";
