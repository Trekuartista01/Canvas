/**
 * M7.10 production preflight. Run on the server before the first start and
 * after every config change:
 *
 *   pnpm preflight            # treats .env as production (what PM2 runs)
 *   pnpm preflight --local    # same checks without the production rules
 *
 * Read-only apart from one tiny probe object in R2 (written and deleted).
 * Never prints a secret. Exits 1 if anything is a ✗.
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import IORedis from "ioredis";
import pg from "pg";
import { pgPoolConfig } from "../../../packages/db/src/connection";
import {
  configFindings,
  corsFinding,
  migrationFinding,
  nodeVersionFinding,
  pgDumpFinding,
  type Finding,
} from "../src/lib/preflight";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const local = process.argv.includes("--local");
config({ path: resolve(root, ".env"), quiet: true });
if (!local) process.env.NODE_ENV = "production";
const env = process.env;
const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);
const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 160);

// 1. The app's own env validation (the same code the API/worker boot with).
try {
  await import("../src/env");
  add({
    level: "ok",
    check: "Environment",
    detail: local ? "valid (local rules)" : "valid for production",
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const fields = [...message.matchAll(/"path":\s*\[\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  add({
    level: "fail",
    check: "Environment",
    detail:
      fields.length > 0
        ? `invalid: ${[...new Set(fields)].join(", ")}`
        : message.split("\n")[0]!.slice(0, 200),
  });
}

add(nodeVersionFinding(process.version));
if (!local) for (const f of configFindings(env)) add(f);

// 2. Build output.
for (const [label, file] of [
  ["API build", "apps/api/dist/index.js"],
  ["Worker build", "apps/api/dist/worker.js"],
  ["Web build", "apps/web/dist/index.html"],
] as const) {
  add(
    existsSync(resolve(root, file))
      ? { level: "ok", check: label, detail: file }
      : { level: "fail", check: label, detail: `${file} missing — run pnpm build` },
  );
}

// 3. Database: reachable, pgvector, migrations, and a pg_dump that can back it up.
let serverVersion = "";
const client = new pg.Client(
  pgPoolConfig({ DATABASE_URL: env.DATABASE_URL, SUPABASE_CA_CERT: env.SUPABASE_CA_CERT }),
);
try {
  await client.connect();
  serverVersion = (await client.query<{ v: string }>("select version() as v")).rows[0]!.v;
  add({ level: "ok", check: "Database", detail: serverVersion.split(" on ")[0]! });

  const vector = await client.query("select 1 from pg_extension where extname = 'vector'");
  if (vector.rowCount) add({ level: "ok", check: "pgvector", detail: "installed" });
  else {
    const available = await client.query(
      "select 1 from pg_available_extensions where name = 'vector'",
    );
    add(
      available.rowCount
        ? {
            level: "warn",
            check: "pgvector",
            detail: "available, not installed yet — pnpm db:migrate creates it",
          }
        : { level: "fail", check: "pgvector", detail: "not available on this server" },
    );
  }

  const journal = JSON.parse(
    readFileSync(resolve(root, "packages/db/drizzle/meta/_journal.json"), "utf8"),
  ) as {
    entries: unknown[];
  };
  const table = await client.query("select to_regclass('drizzle.__drizzle_migrations') as t");
  const applied = table.rows[0]?.t
    ? Number(
        (await client.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0]!
          .n,
      )
    : 0;
  add(migrationFinding(journal.entries.length, applied));
} catch (err) {
  add({ level: "fail", check: "Database", detail: errorText(err) });
} finally {
  await client.end().catch(() => {});
}

const dump = spawnSync(env.PG_DUMP || "pg_dump", ["--version"], { encoding: "utf8" });
if (serverVersion || dump.status === 0) {
  add(pgDumpFinding(serverVersion || "PostgreSQL 0", dump.status === 0 ? dump.stdout : null));
}

// 4. Redis.
const redis = new IORedis(env.REDIS_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
try {
  await redis.connect();
  const pong = await redis.ping();
  add({ level: pong === "PONG" ? "ok" : "fail", check: "Redis", detail: pong });
} catch (err) {
  add({ level: "fail", check: "Redis", detail: errorText(err) });
} finally {
  redis.disconnect();
}

// 5. R2: bucket, write/read/delete with the app's token, and the browser CORS rule.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || "auto",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const bucket = env.S3_BUCKET ?? "";
const probeKey = `preflight/${Date.now()}.txt`;
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: probeKey, Body: "ok", ContentType: "text/plain" }),
  );
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: probeKey }));
  const body = await got.Body?.transformToString();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }));
  add({
    level: body === "ok" ? "ok" : "fail",
    check: "R2 bucket",
    detail:
      body === "ok"
        ? `${bucket}: read/write/delete with the app token`
        : "probe object didn't round-trip",
  });

  const origin = new URL(env.WEB_URL || "http://localhost:5183").origin;
  const putUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: probeKey, ContentType: "image/png" }),
    { expiresIn: 60 },
  );
  const preflight = await fetch(putUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  add(corsFinding(origin, preflight.status, preflight.headers));
} catch (err) {
  add({ level: "fail", check: "R2 bucket", detail: `${bucket}: ${errorText(err)}` });
}

// 6. Email.
if (env.SMTP_HOST) {
  try {
    const nodemailer = await import("nodemailer");
    await nodemailer
      .createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === "true",
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      })
      .verify();
    add({ level: "ok", check: "SMTP", detail: `${env.SMTP_HOST} accepts the login` });
  } catch (err) {
    add({ level: "fail", check: "SMTP", detail: errorText(err) });
  }
}

// 7. The running app, if it's up.
try {
  const res = await fetch(`http://127.0.0.1:${env.API_PORT || 3001}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  const health = (await res.json()) as { checks?: Record<string, string> };
  const checks = Object.entries(health.checks ?? {})
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  add({ level: res.ok ? "ok" : "fail", check: "Running app (/health)", detail: checks });
} catch {
  add({
    level: "warn",
    check: "Running app (/health)",
    detail: "not running (expected before pm2 start)",
  });
}

// Report.
const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
const width = Math.max(...findings.map((f) => f.check.length));
console.log(`\nCanvas preflight (${local ? "local" : "production"} rules)\n`);
for (const f of findings) console.log(`  ${icon[f.level]} ${f.check.padEnd(width)}  ${f.detail}`);
const failures = findings.filter((f) => f.level === "fail").length;
const warnings = findings.filter((f) => f.level === "warn").length;
console.log(
  `\n${failures === 0 ? "Ready" : "Not ready"}: ${failures} problem${failures === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.\n`,
);
process.exit(failures === 0 ? 0 : 1);
