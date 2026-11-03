-- P8.4 (docs/hr-ops-spec.md §3): per-year split, excluded holidays, rejection
-- reason, self-approval flag and the Vendim file keys on leave_requests.
-- Reversed by down/0067_leave_by_year.down.sql.
ALTER TABLE "leave_requests" ADD COLUMN "by_year" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "excluded_holidays" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "self_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "vendim_pdf_key" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "vendim_docx_key" text;--> statement-breakpoint
-- Until now a request lived in the year it started (cross-year was refused).
UPDATE "leave_requests" SET "by_year" = jsonb_build_object(EXTRACT(YEAR FROM "start_date")::integer::text, "working_days");--> statement-breakpoint
-- A rejection note was the reason.
UPDATE "leave_requests" SET "rejection_reason" = "decision_note" WHERE "status" = 'rejected';
