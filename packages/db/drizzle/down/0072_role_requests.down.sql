-- Reverses 0072_role_requests.sql. Applied by `pnpm db:rollback`.
ALTER TABLE "memberships" DROP COLUMN "role_requested_at";--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "requested_people_role";
