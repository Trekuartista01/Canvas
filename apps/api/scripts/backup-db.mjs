// Nightly database backup: pg_dump (custom format) of DATABASE_URL -> gzip
// -> the R2 bucket under backups/YYYY-MM-DD.dump.gz, keeping the newest 14.
// Run via scripts/backup-db.sh (cron on the prod VM — see DEPLOYMENT.md).
// Plain .mjs (not tsup-built) so it runs on the server with nothing but
// node + this package's installed dependencies. Needs `pg_dump` on PATH at
// a major version >= the Supabase server's (postgresql-client-17), or set
// PG_DUMP to its full path (e.g. /usr/lib/postgresql/17/bin/pg_dump).
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "dotenv";

const KEEP = 14;
const PREFIX = "backups/";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const databaseUrl = required("DATABASE_URL");
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

// Kosovo-local date, matching every other date rule in the app.
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
const key = `${PREFIX}${day}.dump.gz`;

function runPgDump(outFile) {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  return new Promise((resolve, reject) => {
    // Only the app's own schemas: a Supabase database also holds auth/
    // storage/realtime schemas this role can't (and shouldn't) dump.
    const child = spawn(
      process.env.PG_DUMP || "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--schema=public",
        "--schema=drizzle",
        "--dbname",
        databaseUrl,
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
        // TLS for anything but a local DB, unless PGSSLMODE is set explicitly.
        env:
          isLocal || process.env.PGSSLMODE ? process.env : { ...process.env, PGSSLMODE: "require" },
      },
    );
    const done = pipeline(child.stdout, createGzip(), createWriteStream(outFile));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`));
      else done.then(resolve, reject);
    });
  });
}

async function pruneOldBackups() {
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  // YYYY-MM-DD keys sort chronologically as plain strings.
  const stale = keys.sort().slice(0, Math.max(0, keys.length - KEEP));
  if (stale.length === 0) return 0;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: stale.map((Key) => ({ Key })) },
    }),
  );
  return stale.length;
}

const dir = await mkdtemp(path.join(tmpdir(), "canvas-backup-"));
const file = path.join(dir, "backup.dump.gz");
try {
  await runPgDump(file);
  const { size } = await stat(file);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: "application/gzip",
    }),
  );
  const removed = await pruneOldBackups();
  console.log(`backup: uploaded ${key} (${size} bytes), removed ${removed} old backup(s)`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
