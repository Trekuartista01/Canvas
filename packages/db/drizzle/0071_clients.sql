-- P8.10: clients, and the link from a card to its client.
-- Reversed by down/0071_clients.down.sql.
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"logo_key" text,
	"color" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_set_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_workspace_id_idx" ON "clients" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_client_id_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
