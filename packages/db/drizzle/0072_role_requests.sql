ALTER TABLE "memberships" ADD COLUMN "requested_people_role" "people_role";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "role_requested_at" timestamp with time zone;