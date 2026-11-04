-- Reverses 0069_contract_files.sql (P8.6). Applied by `pnpm db:rollback`.
-- A contract keeps its first live file; extra pages are lost on rollback.
UPDATE "employment_contracts" ec SET "attachment_id" = COALESCE((
  SELECT cf."attachment_id" FROM "contract_files" cf
  WHERE cf."contract_id" = ec."id" AND cf."deleted_at" IS NULL
  ORDER BY cf."order_key" COLLATE "C" LIMIT 1
), ec."attachment_id"
) WHERE ec."attachment_id" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "contract_files" cf
  WHERE cf."contract_id" = ec."id" AND cf."attachment_id" = ec."attachment_id" AND cf."deleted_at" IS NULL
);--> statement-breakpoint
DELETE FROM "employment_contracts" WHERE "attachment_id" IS NULL;--> statement-breakpoint
DROP TABLE "contract_files";--> statement-breakpoint
ALTER TABLE "employment_contracts" ALTER COLUMN "attachment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employment_contracts" DROP COLUMN "end_alert_sent_at";--> statement-breakpoint
ALTER TABLE "employment_contracts" DROP COLUMN "contract_type";
