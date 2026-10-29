-- M7.0a: remove SSO/SCIM, public API/keys/webhooks, importers, GitHub PR links, Goals, Chat.
-- Chat attachments belong to no task/comment once messages are gone — delete them
-- (their S3 objects are left orphaned; see PROGRESS.md 7.0a).
DELETE FROM "attachments" WHERE "message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_message_id_messages_id_fk";--> statement-breakpoint
DROP INDEX "attachments_message_id_idx";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "message_id";--> statement-breakpoint
-- Chat-mention notifications would link to channels that no longer exist. The
-- activity rows themselves stay as audit history.
DELETE FROM "notifications" WHERE "activity_id" IN (SELECT "id" FROM "activity" WHERE "verb" = 'message.created');--> statement-breakpoint
-- brain_context_type keeps its 'channel' value (enum values can't be dropped
-- cheaply); hide the conversations whose channel is gone.
UPDATE "brain_conversations" SET "deleted_at" = now() WHERE "context_type" = 'channel' AND "deleted_at" IS NULL;--> statement-breakpoint
-- Permission actions removed from WORKSPACE_ACTIONS.
UPDATE "custom_roles" SET
  "grants" = COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements_text("grants") a WHERE split_part(a, ':', 1) NOT IN ('channel', 'message', 'dm', 'goal', 'apiKey', 'webhook', 'import', 'prLink', 'sso', 'scimToken')), '[]'::jsonb),
  "revokes" = COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements_text("revokes") a WHERE split_part(a, ':', 1) NOT IN ('channel', 'message', 'dm', 'goal', 'apiKey', 'webhook', 'import', 'prLink', 'sso', 'scimToken')), '[]'::jsonb);--> statement-breakpoint
DELETE FROM "space_permission_overrides" WHERE split_part("action", ':', 1) IN ('channel', 'message', 'dm', 'goal', 'apiKey', 'webhook', 'import', 'prLink', 'sso', 'scimToken');--> statement-breakpoint
DROP TABLE "channel_members" CASCADE;--> statement-breakpoint
DROP TABLE "messages" CASCADE;--> statement-breakpoint
DROP TABLE "channels" CASCADE;--> statement-breakpoint
DROP TABLE "goal_links" CASCADE;--> statement-breakpoint
DROP TABLE "goals" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_deliveries" CASCADE;--> statement-breakpoint
DROP TABLE "webhooks" CASCADE;--> statement-breakpoint
DROP TABLE "api_keys" CASCADE;--> statement-breakpoint
DROP TABLE "imports" CASCADE;--> statement-breakpoint
DROP TABLE "task_pr_links" CASCADE;--> statement-breakpoint
DROP TABLE "scim_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "sso_configs" CASCADE;--> statement-breakpoint
DROP TYPE "public"."import_source";--> statement-breakpoint
DROP TYPE "public"."task_pr_link_state";--> statement-breakpoint
DROP TYPE "public"."import_status";
