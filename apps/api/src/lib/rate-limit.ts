import { env } from "../env";
import { redisConnection } from "../queues/connection";

// Fixed-window limiter, 60/min by default; auth (login/signup) uses a
// tighter per-IP (and per-email for login) budget to blunt credential stuffing.
export const RATE_LIMIT_MAX_REQUESTS = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Env-configurable (env.ts) rather than a fixed literal — see that file's
// comment: the e2e suite overrides these much higher so a multi-worker
// local run isn't rate-limited by its own credential-stuffing protection.
export const AUTH_RATE_LIMIT_MAX = env.AUTH_RATE_LIMIT_MAX;
export const AUTH_EMAIL_RATE_LIMIT_MAX = env.AUTH_EMAIL_RATE_LIMIT_MAX;

// The two fully-public, session-less, state-mutating/storage-consuming
// surfaces (form.getPublic/submitPublic, POST /public-forms/uploads) —
// gated only by a guessable-length publicToken, with no auth to fall back
// on. Forms gets the more generous budget since getPublic (a plain read,
// to render the page) and submitPublic share it; uploads are tighter since
// each one costs real S3 I/O.
export const PUBLIC_FORM_RATE_LIMIT_MAX = 30;
export const PUBLIC_UPLOAD_RATE_LIMIT_MAX = 20;

/** The window a given instant falls into, as a Redis key. */
export function rateLimitBucketKey(
  bucket: string,
  now: Date,
  windowMs = RATE_LIMIT_WINDOW_MS,
): string {
  const windowStart = Math.floor(now.getTime() / windowMs);
  return `ratelimit:${bucket}:${windowStart}`;
}

export function isOverRateLimit(
  requestCountInWindow: number,
  max = RATE_LIMIT_MAX_REQUESTS,
): boolean {
  return requestCountInWindow > max;
}

/**
 * Increments the bucket's window counter and reports whether this request
 * is over the limit. `bucket` should already be scoped (e.g. `upload:ip:${ip}`,
 * `auth:ip:${ip}`, `auth:email:${email}`).
 */
export async function checkRateLimit(
  bucket: string,
  opts: { max?: number; windowMs?: number; now?: Date } = {},
): Promise<{ overLimit: boolean; count: number }> {
  const max = opts.max ?? RATE_LIMIT_MAX_REQUESTS;
  const windowMs = opts.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const now = opts.now ?? new Date();
  const key = rateLimitBucketKey(bucket, now, windowMs);
  const count = await redisConnection.incr(key);
  if (count === 1) {
    await redisConnection.pexpire(key, windowMs);
  }
  return { overLimit: isOverRateLimit(count, max), count };
}

export async function assertAuthRateLimit(ip: string, email?: string) {
  const { overLimit: ipOver } = await checkRateLimit(`auth:ip:${ip || "unknown"}`, {
    max: AUTH_RATE_LIMIT_MAX,
  });
  if (ipOver) {
    throw new RateLimitError();
  }
  if (email) {
    const { overLimit: emailOver } = await checkRateLimit(
      `auth:email:${email.trim().toLowerCase()}`,
      { max: AUTH_EMAIL_RATE_LIMIT_MAX },
    );
    if (emailOver) {
      throw new RateLimitError();
    }
  }
}

/**
 * A single-bucket check for the public form/upload surfaces below — unlike
 * auth's ip+email dual-bucket shape, these each need one or two independent
 * buckets checked by their own callers (e.g. form.submitPublic checks both
 * an IP bucket and a publicToken bucket), so this stays a plain
 * check-and-throw rather than baking in a fixed set of buckets.
 */
export async function assertPublicRateLimit(bucket: string, max: number) {
  const { overLimit } = await checkRateLimit(bucket, { max });
  if (overLimit) {
    throw new RateLimitError();
  }
}

export class RateLimitError extends Error {
  readonly code = "TOO_MANY_REQUESTS" as const;
  constructor() {
    super("Too many attempts. Try again in a minute.");
    this.name = "RateLimitError";
  }
}

// `X-Forwarded-For` is appended-to by each proxy hop, so its FIRST entry is
// whatever the client itself sent — trusting it unconditionally lets anyone
// bypass a rate limit by sending a fresh spoofed value on every request.
// Its LAST entry is the one added by the hop closest to us, which — for the
// single reverse proxy this app expects in front of it (see index.ts's
// `trustProxy: true` comment) — is the one we actually control and can
// trust. If the real deployment ever sits behind more than one hop, this
// (and `trustProxy`, currently a blanket `true`) needs to change to trust
// exactly that many hops, not fewer/more.
export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const hops = forwarded.split(",").map((h) => h.trim());
    const nearest = hops.at(-1);
    if (nearest) return nearest;
  }
  return req.ip ?? "unknown";
}
