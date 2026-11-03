/**
 * M7.10 production preflight — the pure checks behind `pnpm preflight`
 * (apps/api/scripts/preflight.ts). Each returns a list of findings; the
 * script adds the ones that need a network (DB, Redis, storage, SMTP).
 */
export type Level = "ok" | "warn" | "fail";
export interface Finding {
  level: Level;
  check: string;
  detail: string;
}

const ok = (check: string, detail: string): Finding => ({ level: "ok", check, detail });
const warn = (check: string, detail: string): Finding => ({ level: "warn", check, detail });
const fail = (check: string, detail: string): Finding => ({ level: "fail", check, detail });

function parseUrl(value: string | undefined) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

export function nodeVersionFinding(version: string, minimum = "22.13.0"): Finding {
  const [a, b, c] = version.replace(/^v/, "").split(".").map(Number) as [number, number, number];
  const [x, y, z] = minimum.split(".").map(Number) as [number, number, number];
  const okVersion = a > x || (a === x && (b > y || (b === y && c >= z)));
  return okVersion
    ? ok("Node.js", `v${version.replace(/^v/, "")}`)
    : fail("Node.js", `v${version.replace(/^v/, "")} — needs ${minimum} or newer (Node 22 LTS)`);
}

/** The URL/config rules that don't need a network call. */
export function configFindings(env: Record<string, string | undefined>): Finding[] {
  const out: Finding[] = [];

  const web = parseUrl(env.WEB_URL);
  if (!web) out.push(fail("WEB_URL", "missing or not a URL"));
  else if (web.protocol !== "https:")
    out.push(fail("WEB_URL", `${env.WEB_URL} — must be https://`));
  else if (web.pathname !== "/" || env.WEB_URL!.endsWith("/")) {
    out.push(
      warn(
        "WEB_URL",
        "use the bare origin, e.g. https://canvas.example.com (no trailing slash/path)",
      ),
    );
  } else out.push(ok("WEB_URL", web.origin));

  const redirect = parseUrl(env.GOOGLE_REDIRECT_URI);
  if (env.GOOGLE_CLIENT_ID) {
    if (
      !redirect ||
      !web ||
      redirect.origin !== web.origin ||
      redirect.pathname !== "/auth/google/callback"
    ) {
      out.push(
        fail("GOOGLE_REDIRECT_URI", `must be ${web?.origin ?? "<WEB_URL>"}/auth/google/callback`),
      );
    } else out.push(ok("Google sign-in", "configured"));
  } else {
    out.push(warn("Google sign-in", "GOOGLE_CLIENT_ID not set — email + password sign-in only"));
  }

  const db = parseUrl(env.DATABASE_URL);
  if (!db) out.push(fail("DATABASE_URL", "missing or not a URL"));
  else if (db.port === "6543") {
    out.push(
      fail(
        "DATABASE_URL",
        "that's Supabase's Transaction pooler (6543) — use the Session pooler (5432)",
      ),
    );
  } else if (/localhost|127\.0\.0\.1/.test(db.hostname)) {
    out.push(fail("DATABASE_URL", "points at localhost — use the canvas-prod Session pooler URI"));
  } else out.push(ok("DATABASE_URL", `${db.hostname}:${db.port || "5432"}`));

  const redis = parseUrl(env.REDIS_URL ?? "redis://127.0.0.1:6379");
  if (!redis) out.push(fail("REDIS_URL", "not a URL"));
  else if (!redis.password) {
    out.push(
      warn(
        "REDIS_URL",
        "no password — set requirepass in redis.conf and redis://:<password>@127.0.0.1:6379",
      ),
    );
  } else if (!/^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(redis.hostname)) {
    out.push(warn("REDIS_URL", `${redis.hostname} — Redis is expected on this VM (127.0.0.1)`));
  } else out.push(ok("REDIS_URL", "local, with a password"));

  // File storage: Supabase Storage's S3 endpoint (DEPLOYMENT.md step 2) or,
  // where a card is accepted, Cloudflare R2. Any other S3 host only warns.
  const s3 = parseUrl(env.S3_ENDPOINT);
  const supabase = !!s3 && isSupabaseStorage(s3);
  const r2 = !!s3 && s3.hostname.endsWith(".r2.cloudflarestorage.com");
  if (!s3 || s3.protocol !== "https:") {
    out.push(fail("S3_ENDPOINT", "must be the https:// storage endpoint (Supabase Storage → S3)"));
  } else if (supabase) out.push(ok("S3_ENDPOINT", `Supabase Storage (${s3.hostname})`));
  else if (r2) out.push(ok("S3_ENDPOINT", `Cloudflare R2 (${s3.hostname})`));
  else {
    out.push(
      warn(
        "S3_ENDPOINT",
        `${s3.hostname} isn't Supabase Storage or R2 — fine only if you meant it`,
      ),
    );
  }
  if (supabase) {
    if (env.S3_FORCE_PATH_STYLE !== "true") {
      out.push(fail("S3_FORCE_PATH_STYLE", "Supabase Storage needs S3_FORCE_PATH_STYLE=true"));
    }
    if (!env.S3_REGION || env.S3_REGION === "auto" || env.S3_REGION === "us-east-1") {
      out.push(
        warn(
          "S3_REGION",
          "use the project's region from Storage → Settings → S3 Connection (e.g. eu-west-3)",
        ),
      );
    }
  }
  if (r2) {
    if (env.S3_REGION !== "auto") out.push(warn("S3_REGION", "R2 wants S3_REGION=auto"));
    if (env.S3_FORCE_PATH_STYLE !== "false")
      out.push(warn("S3_FORCE_PATH_STYLE", "R2 wants S3_FORCE_PATH_STYLE=false"));
  }

  if (env.SMTP_HOST) {
    if (!env.EMAIL_FROM || /canvas\.local/.test(env.EMAIL_FROM)) {
      out.push(fail("EMAIL_FROM", "set a real sender, e.g. Canvas <no-reply@your-domain>"));
    }
  } else {
    out.push(
      warn(
        "SMTP",
        "SMTP_HOST not set — reminders, invites and password emails are only logged, never sent",
      ),
    );
  }

  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    out.push(
      warn("AI providers", "no API keys — Brain and image generation use the mock providers"),
    );
  }
  return out;
}

/** "PostgreSQL 17.4 on aarch64…" / "pg_dump (PostgreSQL) 16.9" → 17 / 16. */
export function pgMajor(versionText: string): number | null {
  const match = /(?:PostgreSQL\)?)\s+(\d+)(?:\.\d+)?/.exec(versionText);
  return match ? Number(match[1]) : null;
}

export function pgDumpFinding(serverVersion: string, pgDumpVersion: string | null): Finding {
  const server = pgMajor(serverVersion);
  const dump = pgDumpVersion ? pgMajor(pgDumpVersion) : null;
  if (dump === null) {
    return fail("pg_dump (backups)", "not found — install postgresql-client-" + (server ?? 17));
  }
  if (server !== null && dump < server) {
    return fail(
      "pg_dump (backups)",
      `v${dump} is older than the server (v${server}) — install postgresql-client-${server} or set PG_DUMP`,
    );
  }
  return ok("pg_dump (backups)", `v${dump}`);
}

export function migrationFinding(expected: number, applied: number): Finding {
  if (applied === expected) return ok("Migrations", `${applied}/${expected} applied`);
  if (applied < expected) {
    return fail("Migrations", `${applied}/${expected} applied — run pnpm db:migrate`);
  }
  return warn(
    "Migrations",
    `${applied} applied but the code knows ${expected} — is this checkout older than the database?`,
  );
}

export function isSupabaseStorage(endpoint: URL) {
  return (
    endpoint.hostname.endsWith(".supabase.co") && endpoint.pathname.startsWith("/storage/v1/s3")
  );
}

// Supabase's free plan caps a single file at 50 MB, and the nightly backup is
// one file — warn well before it stops fitting.
export const SUPABASE_FREE_FILE_LIMIT = 50 * 1024 * 1024;

/** The newest nightly backup's size, against the storage's per-file limit. */
export function backupSizeFinding(newestBytes: number | null, limitBytes: number | null): Finding {
  if (newestBytes === null) return ok("Backups", "none yet (the nightly cron writes the first)");
  const mb = (newestBytes / 1024 / 1024).toFixed(1);
  if (limitBytes !== null && newestBytes > limitBytes * 0.8) {
    return warn(
      "Backups",
      `newest is ${mb} MB — close to the ${limitBytes / 1024 / 1024} MB per-file limit; raise it (paid plan) before backups stop fitting`,
    );
  }
  return ok("Backups", `newest is ${mb} MB`);
}

/** Does a CORS preflight response let the browser PUT an upload from `origin`? */
export function corsFinding(origin: string, status: number, headers: Headers): Finding {
  const allowOrigin = headers.get("access-control-allow-origin");
  const allowMethods = (headers.get("access-control-allow-methods") ?? "").toUpperCase();
  if (status >= 400 || !allowOrigin) {
    return fail(
      "Storage CORS",
      `uploads from ${origin} are blocked — check the bucket's CORS settings (DEPLOYMENT.md step 2)`,
    );
  }
  if (allowOrigin !== "*" && allowOrigin !== origin) {
    return fail("Storage CORS", `allows ${allowOrigin}, not ${origin}`);
  }
  if (allowMethods && !allowMethods.includes("PUT")) {
    return fail("Storage CORS", "PUT isn't an allowed method");
  }
  return ok("Storage CORS", `browser uploads from ${origin} allowed`);
}

/**
 * P8.5: the Vendim PDF needs LibreOffice, and Garamond (or EB Garamond under
 * that name) to stay on one page. Without them HR still gets the Word file.
 */
export function vendimToolsFinding(sofficeVersion: string | null, garamondFonts: string): Finding {
  if (!sofficeVersion) {
    return warn(
      "Vendim PDF",
      "LibreOffice (soffice) not found — Vendims are Word-only until it's installed (deploy/setup-server.sh)",
    );
  }
  if (!/garamond/i.test(garamondFonts)) {
    return warn(
      "Vendim PDF",
      `${sofficeVersion.trim()}, but no Garamond font — the PDF may not fit one page`,
    );
  }
  return ok("Vendim PDF", `${sofficeVersion.trim()} with Garamond`);
}
