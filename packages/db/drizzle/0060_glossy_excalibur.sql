CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('sick', 'vacation', 'personal', 'maternity', 'paternity', 'emergency');--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"entitlement_days" numeric(5, 1),
	"carried_over_days" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balances_user_workspace_year_uniq" UNIQUE("user_id","workspace_id","year")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"working_days" numeric(5, 1) NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"recorded_by" uuid,
	"document_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_vacation_days" numeric(5, 1) DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_document_attachment_id_attachments_id_fk" FOREIGN KEY ("document_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_workspace_user_idx" ON "leave_requests" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "leave_requests_workspace_dates_idx" ON "leave_requests" USING btree ("workspace_id","start_date","end_date");