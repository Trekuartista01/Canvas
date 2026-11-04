-- Sign-ups wait here for their emailed link. Reversed by down/0073_signup_requests.down.sql.
CREATE TABLE "signup_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"invite_id" uuid,
	"requested_role" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "signup_requests_email_idx" ON "signup_requests" USING btree ("email");--> statement-breakpoint
ALTER TABLE "signup_requests" ENABLE ROW LEVEL SECURITY;
