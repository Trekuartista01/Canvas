/**
 * `pnpm db:rollback` — undoes the newest applied migration (P8.1: every
 * migration from 0064 on has a hand-written `drizzle/down/<tag>.down.sql`).
 * Runs the down file's statements and removes the migration's row from
 * drizzle.__drizzle_migrations, in one transaction. The migration file itself
 * stays, so a later `pnpm db:migrate` re-applies it; delete it (and revert the
 * schema change) only for a migration that was never shipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { pgPoolConfig } from "./connection";

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

/** Statements of a migration file — drizzle's own breakpoint marker splits them. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, "").trim().length > 0);
}

/**
 * The journal entry to roll back: the newest one, which must also be the
 * newest applied (`appliedWhen`, drizzle's created_at) — anything else means
 * the journal and the database disagree, and guessing would be dangerous.
 */
export function entryToRollBack(entries: JournalEntry[], appliedWhen: number | null) {
  const newest = entries.at(-1);
  if (!newest) throw new Error("The migration journal is empty");
  if (appliedWhen === null) throw new Error("No migrations are applied to this database");
  if (appliedWhen !== newest.when) {
    throw new Error(
      `The newest applied migration (created_at ${appliedWhen}) isn't the journal's newest (${newest.tag}); not rolling back`,
    );
  }
  return newest;
}

async function main() {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const rootEnv = resolve(root, "../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const journal = JSON.parse(readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const client = new pg.Client(pgPoolConfig(process.env));
  await client.connect();
  try {
    const applied = await client.query<{ created_at: string }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );
    const appliedWhen = applied.rows[0] ? Number(applied.rows[0].created_at) : null;
    const entry = entryToRollBack(journal.entries, appliedWhen);
    const downFile = resolve(root, `drizzle/down/${entry.tag}.down.sql`);
    if (!existsSync(downFile)) throw new Error(`No down migration for ${entry.tag} (${downFile})`);

    await client.query("BEGIN");
    for (const statement of splitStatements(readFileSync(downFile, "utf8"))) {
      await client.query(statement);
    }
    await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [
      entry.when,
    ]);
    await client.query("COMMIT");
    console.log(`rolled back ${entry.tag}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
