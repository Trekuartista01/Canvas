-- P8.9: board membership and archived lists.
-- Reversed by down/0070_board_members.down.sql.
CREATE TABLE "space_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_members_space_user_uniq" UNIQUE("space_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_members_user_idx" ON "space_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "space_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Nobody loses access: every active member joins every existing board. A person
-- is only left out from here on, when they join later or are removed.
INSERT INTO "space_members" ("id", "space_id", "user_id")
SELECT gen_random_uuid(), s."id", m."user_id"
FROM "spaces" s
JOIN "memberships" m ON m."workspace_id" = s."workspace_id"
LEFT JOIN "employee_profiles" p ON p."membership_id" = m."id"
WHERE s."deleted_at" IS NULL AND (p."status" IS NULL OR p."status" = 'active');
