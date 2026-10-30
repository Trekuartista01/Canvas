CREATE TABLE "employee_of_month" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"month" text NOT NULL,
	"user_id" uuid,
	"score" integer,
	"breakdown_json" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_of_month_workspace_month_uniq" UNIQUE("workspace_id","month")
);
--> statement-breakpoint
ALTER TABLE "employee_of_month" ADD CONSTRAINT "employee_of_month_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_of_month" ADD CONSTRAINT "employee_of_month_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;