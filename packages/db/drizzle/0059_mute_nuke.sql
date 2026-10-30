CREATE TABLE "public_holiday_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"holiday_id" uuid NOT NULL,
	"observed_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_holiday_notices_uniq" UNIQUE("workspace_id","holiday_id","observed_date")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"observed_date" date,
	"is_recurring_fixed" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "holiday_notice_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "holidays_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_holiday_notices" ADD CONSTRAINT "public_holiday_notices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holiday_notices" ADD CONSTRAINT "public_holiday_notices_holiday_id_public_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."public_holidays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_holidays_workspace_id_idx" ON "public_holidays" USING btree ("workspace_id");