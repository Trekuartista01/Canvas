// Restore test (M7.10): download a nightly backup from the R2 bucket in .env
// (backups/YYYY-MM-DD.dump.gz, written by backup-db.mjs) and pg_restore it
// into ANOTHER database — canvas-dev — to prove the backups actually work.
//
//   scripts/restore-db.sh --target "<canvas-dev Session pooler URI>" [--date 2026-11-02] --yes
//
// It replaces the target's `public` and `drizzle` schemas (pg_restore
// --clean), so it refuses to run without --yes, and refuses outright when
// the target is the DATABASE_URL in .env (production). Needs pg_restore at
// the same major version as pg_dump (postgresql-client-17), or PG_RESTORE.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import pg from "pg";

const PREFIX = "backups/";
config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
// host/port/database — enough to tell two databases apart without comparing passwords.
function identity(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}/${u.pathname.slice(1)}?user=${decodeURIComponent(u.username)}`;
}

const target = arg("target");
if (!target) {
  console.error(
    'Usage: scripts/restore-db.sh --target "<postgres URL of canvas-dev>" [--date YYYY-MM-DD] --yes',
  );
  process.exit(1);
}
if (process.env.DATABASE_URL && identity(target) === identity(process.env.DATABASE_URL)) {
  console.error(
    "Refusing: --target is the DATABASE_URL in .env (production). Restore into canvas-dev.",
  );
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(
    `This replaces everything in ${identity(target)} with the backup. Re-run with --yes.`,
  );
  process.exit(1);
}

const bucket = required("S3_BUCKET");
const s3 = new S3Client({
  endpoint: required("S3_ENDPOINT"),
  region: process.env.S3_REGION || "auto",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

async function latestKey() {
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? [])
      if (object.Key?.endsWith(".dump.gz")) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  if (keys.length === 0) throw new Error(`No backups in ${bucket}/${PREFIX}`);
  return keys.sort().at(-1);
}

const isLocal = (url) => /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pgEnv = (url) =>
  isLocal(url) || process.env.PGSSLMODE ? process.env : { ...process.env, PGSSLMODE: "require" };
// The same rule for the restore's own pg connections.
const sslFor = (url) =>
  isLocal(url) || process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };

function run(command, args, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "pipe"], env: pgEnv(url) });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

const date = arg("date");
const key = date ? `${PREFIX}${date}.dump.gz` : await latestKey();
const dir = await mkdtemp(path.join(tmpdir(), "canvas-restore-"));
const file = path.join(dir, "backup.dump");
try {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(object.Body, createGunzip(), createWriteStream(file));
  console.log(`restore: downloaded ${key} (${(await stat(file)).size} bytes)`);

  // A clean slate: the app's two schemas go (pg_restore --clean can't drop
  // `public` while the pgvector extension lives in it), then pgvector comes
  // back before the tables that use it. Only these two schemas — Supabase's
  // own (auth, storage, …) are untouched.
  const prep = new pg.Client({ connectionString: target, ssl: sslFor(target) });
  await prep.connect();
  await prep.query("drop schema if exists drizzle cascade");
  await prep.query("drop schema if exists public cascade");
  await prep.query("create schema public");
  await prep.query("create extension if not exists vector");
  await prep.end();

  const { code, stderr } = await run(
    process.env.PG_RESTORE || "pg_restore",
    ["--no-owner", "--no-privileges", "--dbname", target, file],
    target,
  );
  // "schema public already exists" is expected (it was just recreated);
  // anything else is worth showing.
  const noise =
    /already exists|does not exist, skipping|errors ignored on restore|^\s*Command was: CREATE SCHEMA public;$/;
  const problems = stderr.split("\n").filter((line) => line.trim() && !noise.test(line));
  if (problems.length) console.error(problems.slice(0, 20).join("\n"));
  if (code !== 0 && problems.length) throw new Error(`pg_restore exited with code ${code}`);

  const check = new pg.Client({ connectionString: target, ssl: sslFor(target) });
  await check.connect();
  const counts = {};
  for (const table of ["users", "workspaces", "tasks", "leave_requests", "payroll_records"]) {
    counts[table] = Number(
      (await check.query(`select count(*)::int as n from public.${table}`)).rows[0].n,
    );
  }
  const migrations = (
    await check.query("select count(*)::int as n from drizzle.__drizzle_migrations")
  ).rows[0].n;
  await check.end();
  console.log(`restore: ${identity(target)} now has`, { ...counts, migrations });
} finally {
  await rm(dir, { recursive: true, force: true });
}
