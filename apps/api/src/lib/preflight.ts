/**
 * M7.10 production preflight — the pure checks behind `pnpm preflight`
 * (apps/api/scripts/preflight.ts). Each returns a list of findings; the
 * script adds the ones that need a network (DB, Redis, R2, SMTP).
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

  const s3 = parseUrl(env.S3_ENDPOINT);
  if (!s3 || s3.protocol !== "https:")
    out.push(fail("S3_ENDPOINT", "must be the https:// R2 endpoint"));
  else if (!s3.hostname.endsWith(".r2.cloudflarestorage.com")) {
    out.push(
      warn(
        "S3_ENDPOINT",
        `${s3.hostname} isn't an R2 endpoint — fine only if you meant another S3 host`,
      ),
    );
  } else out.push(ok("S3_ENDPOINT", s3.hostname));
  if (env.S3_ENDPOINT?.includes("r2.cloudflarestorage.com")) {
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

/** Does a CORS preflight response let the browser PUT an upload from `origin`? */
export function corsFinding(origin: string, status: number, headers: Headers): Finding {
  const allowOrigin = headers.get("access-control-allow-origin");
  const allowMethods = (headers.get("access-control-allow-methods") ?? "").toUpperCase();
  if (status >= 400 || !allowOrigin) {
    return fail(
      "R2 CORS",
      `uploads from ${origin} are blocked — add the CORS rule from DEPLOYMENT.md to the bucket`,
    );
  }
  if (allowOrigin !== "*" && allowOrigin !== origin) {
    return fail("R2 CORS", `allows ${allowOrigin}, not ${origin}`);
  }
  if (allowMethods && !allowMethods.includes("PUT")) {
    return fail("R2 CORS", "PUT isn't an allowed method");
  }
  return ok("R2 CORS", `browser uploads from ${origin} allowed`);
}
