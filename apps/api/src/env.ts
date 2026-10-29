import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Explicit absolute path, not a bare config() call — turbo/tsx run this
// package's scripts (dev/worker) with apps/api as cwd, not the repo root
// where .env actually lives, so dotenv's default cwd-relative lookup would
// silently find nothing and every var would fall back to its default.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const isProd = process.env.NODE_ENV === "production";

const optionalString = z.string().optional();

const envSchema = z.object({
  API_PORT: z.coerce.number().default(3001),
  DATABASE_URL: isProd
    ? z.string().min(1)
    : z.string().default("postgres://canvas:canvas@localhost:5432/canvas"),
  REDIS_URL: isProd ? z.string().min(1) : z.string().default("redis://localhost:6379"),
  WEB_URL: isProd ? z.string().url() : z.string().default("http://localhost:5183"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: isProd
    ? z.string().url()
    : z.string().default("http://localhost:3001/auth/google/callback"),
  S3_ENDPOINT: isProd ? z.string().url() : z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: isProd ? z.string().min(1) : z.string().default("canvas-dev"),
  S3_ACCESS_KEY_ID: isProd ? z.string().min(1) : z.string().default("canvas"),
  S3_SECRET_ACCESS_KEY: isProd ? z.string().min(1) : z.string().default("canvas12345"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  SCHEDULER_TICK_MS: z.coerce.number().default(60_000),
  // Per-IP / per-email signup+login budget (rate-limit.ts). Overridden much
  // higher in the e2e webServer env — every parallel Playwright worker signs
  // up from the same localhost IP, so the production-appropriate default
  // (20/min) starves a multi-worker local run of the app's own real
  // credential-stuffing protection, not a bug in the app itself.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  AUTH_EMAIL_RATE_LIMIT_MAX: z.coerce.number().default(10),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: z.string().default("Canvas <notifications@canvas.local>"),
  DIGEST_INTERVAL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
  // Optional — leave unset locally; paste the real project DSN in prod.
  SENTRY_DSN: optionalString,
  // safe-outbound-url.ts's SSRF guard blocks every private/loopback
  // address unconditionally — correct for real Slack URLs, but it
  // also blocks the local mock HTTP server the Slack e2e spec
  // stands in for a real receiver with. Set only by the e2e webServer env
  // (never a real deployment — see assertProdNotLocalhost below).
  SAFE_OUTBOUND_ALLOW_PRIVATE: z.coerce.boolean().default(false),
});

function assertProdNotLocalhost(parsed: z.infer<typeof envSchema>) {
  if (!isProd) return;
  const offenders: string[] = [];
  for (const [name, value] of [
    ["DATABASE_URL", parsed.DATABASE_URL],
    ["REDIS_URL", parsed.REDIS_URL],
    ["WEB_URL", parsed.WEB_URL],
    ["S3_ENDPOINT", parsed.S3_ENDPOINT],
    ["GOOGLE_REDIRECT_URI", parsed.GOOGLE_REDIRECT_URI],
  ] as const) {
    if (/localhost|127\.0\.0\.1/i.test(value)) offenders.push(name);
  }
  if (parsed.S3_ACCESS_KEY_ID === "canvas" || parsed.S3_SECRET_ACCESS_KEY === "canvas12345") {
    offenders.push("S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (dev MinIO defaults)");
  }
  if (parsed.SAFE_OUTBOUND_ALLOW_PRIVATE) {
    offenders.push("SAFE_OUTBOUND_ALLOW_PRIVATE (disables SSRF protection — e2e-only)");
  }
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to start in production with localhost/dev defaults for: ${offenders.join(", ")}. Set real values in the environment.`,
    );
  }
}

export const env = envSchema.parse(process.env);
assertProdNotLocalhost(env);
