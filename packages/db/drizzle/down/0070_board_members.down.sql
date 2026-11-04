-- Reverses 0070_board_members.sql (P8.9). Applied by `pnpm db:rollback`.
-- Archived lists come back onto the board.
DROP TABLE "space_members";--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "archived_at";
