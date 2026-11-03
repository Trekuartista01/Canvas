-- Reverses 0068_vendim_status.sql (P8.5). Applied by `pnpm db:rollback`.
ALTER TABLE "leave_requests" DROP COLUMN "vendim_error";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "vendim_generated_at";
