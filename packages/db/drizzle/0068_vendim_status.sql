-- P8.5: Vendim job state on leave_requests. Reversed by down/0068_vendim_status.down.sql.
ALTER TABLE "leave_requests" ADD COLUMN "vendim_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "vendim_error" text;