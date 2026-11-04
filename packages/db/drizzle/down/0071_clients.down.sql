-- Reverses 0071_clients.sql (P8.10). Applied by `pnpm db:rollback`.
ALTER TABLE "tasks" DROP COLUMN "client_set_manually";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "client_id";--> statement-breakpoint
DROP TABLE "clients";
