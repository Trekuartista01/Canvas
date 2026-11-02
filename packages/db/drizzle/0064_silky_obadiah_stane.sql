-- P8.1 (docs/hr-ops-spec.md): new people roles, audit_log, RLS deny-all.
-- Reversed by down/0064_silky_obadiah_stane.down.sql.
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"ip" "inet",
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every membership's role before the rename, so nothing is lost (staff_manager
-- has no new equivalent) and the down migration restores it exactly.
CREATE TABLE "people_role_backup_0064" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"people_role" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "people_role_backup_0064" ("membership_id", "people_role")
SELECT "id", "people_role"::text FROM "memberships";--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DEFAULT 'employee'::text;--> statement-breakpoint
UPDATE "memberships" SET "people_role" = CASE "people_role"
	WHEN 'super_admin' THEN 'admin'
	WHEN 'hr' THEN 'hr_finance'
	WHEN 'operation_manager' THEN 'operations_manager'
	ELSE 'employee'
END;--> statement-breakpoint
DROP TYPE "public"."people_role";--> statement-breakpoint
CREATE TYPE "public"."people_role" AS ENUM('admin', 'ceo', 'hr_finance', 'operations_manager', 'employee');--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DEFAULT 'employee'::"public"."people_role";--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "people_role" SET DATA TYPE "public"."people_role" USING "people_role"::"public"."people_role";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_workspace_created_idx" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- RLS on, no policies: Supabase's Data API (anon / authenticated roles) sees
-- nothing. The app connects as the tables' owner, which RLS doesn't apply to.
-- New tables must do the same (packages/db/src/rls.test.ts checks).
DO $$
DECLARE t record;
BEGIN
	FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
	END LOOP;
END $$;
