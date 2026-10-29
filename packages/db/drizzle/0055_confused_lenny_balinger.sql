CREATE TYPE "public"."people_role" AS ENUM('super_admin', 'hr', 'operation_manager', 'staff_manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"phone" text,
	"address" text,
	"date_of_birth" date,
	"job_title" text,
	"department" text,
	"employment_start_date" date,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_membership_id_unique" UNIQUE("membership_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "people_role" "people_role" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "manager_user_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- M7.1: the old Operations Manager flag becomes people_role 'operation_manager'
-- (task.ts's notifyOperationsManagers now reads people_role). Owners are
-- treated as super_admin in code regardless, so they're left as-is.
UPDATE "memberships" SET "people_role" = 'operation_manager' WHERE "is_operations_manager" = true AND "role" <> 'owner';
