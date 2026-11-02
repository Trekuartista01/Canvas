-- Reverses 0064_silky_obadiah_stane.sql (P8.1). Applied by `pnpm db:rollback`.
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
		EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DEFAULT 'staff'::text;--> statement-breakpoint
-- Restore the exact old role where the backup has it; memberships created
-- since map back by name (ceo had no old equivalent → staff).
UPDATE "memberships" m SET "people_role" = COALESCE(
	(SELECT b."people_role" FROM "people_role_backup_0064" b WHERE b."membership_id" = m."id"),
	CASE m."people_role"
		WHEN 'admin' THEN 'super_admin'
		WHEN 'hr_finance' THEN 'hr'
		WHEN 'operations_manager' THEN 'operation_manager'
		ELSE 'staff'
	END
);--> statement-breakpoint
DROP TYPE "public"."people_role";--> statement-breakpoint
CREATE TYPE "public"."people_role" AS ENUM('super_admin', 'hr', 'operation_manager', 'staff_manager', 'staff');--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DEFAULT 'staff'::"public"."people_role";--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DATA TYPE "public"."people_role" USING "people_role"::"public"."people_role";--> statement-breakpoint
DROP TABLE "people_role_backup_0064";--> statement-breakpoint
DROP TABLE "audit_log";
