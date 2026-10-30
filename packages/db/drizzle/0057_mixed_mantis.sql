ALTER TYPE "public"."status_kind" ADD VALUE 'review' BEFORE 'done';--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_collaborators_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "requires_proof" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "is_proof" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_collaborators_user_id_idx" ON "task_collaborators" USING btree ("user_id");