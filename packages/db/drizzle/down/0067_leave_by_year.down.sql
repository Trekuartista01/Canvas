-- Reverses 0067_leave_by_year.sql (P8.4). Applied by `pnpm db:rollback`.
-- Note: a cross-year request made since then keeps its working_days total
-- but goes back to counting in its start year only.
ALTER TABLE "leave_requests" DROP COLUMN "vendim_docx_key";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "vendim_pdf_key";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "self_approved";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "excluded_holidays";--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "by_year";
