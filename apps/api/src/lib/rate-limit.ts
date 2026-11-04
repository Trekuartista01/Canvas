import { env } from "../env";
import { redisConnection } from "../queues/connection";

// Fixed-window limiter, 60/min by default. Auth (sign-up, login, forgot password)
// has a tighter budget per IP and per email to blunt credential stuffing, plus the
// hourly limits on emails sent and wrong passwords further down.
export const RATE_LIMIT_MAX_REQUESTS = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Env-configurable (env.ts) rather than a fixed literal — see that file's
// comment: the e2e suite overrides these much higher so a multi-worker
// local run isn't rate-limited by its own credential-stuffing protection.
export const AUTH_RATE_LIMIT_MAX = env.AUTH_RATE_LIMIT_MAX;
export const AUTH_EMAIL_RATE_LIMIT_MAX = env.AUTH_EMAIL_RATE_LIMIT_MAX;
const HOUR_MS = 60 * 60 * 1000;

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
 * Sign-up and reset emails to one address, so nobody can flood a colleague's
 * inbox. Counted per address whether or not it has an account, so hitting the
 * limit says nothing about who's a user.
 */
export async function assertEmailSendRateLimit(email: string) {
  const { overLimit } = await checkRateLimit(`auth:send:${email.trim().toLowerCase()}`, {
    max: env.AUTH_EMAIL_SEND_MAX_PER_HOUR,
    windowMs: HOUR_MS,
  });
  if (overLimit) throw new RateLimitError("Too many emails to this address. Try again later.");
}

// The per-minute limits still allow thousands of password guesses a day. This
// slower one counts only wrong passwords. It's per address AND IP, so an attacker
// elsewhere can't lock the real person out of their own account.
const loginFailureBucket = (email: string, ip: string) =>
  `auth:fail:${email.trim().toLowerCase()}:${ip || "unknown"}`;

export async function assertLoginFailuresUnderLimit(email: string, ip: string) {
  const key = rateLimitBucketKey(loginFailureBucket(email, ip), new Date(), HOUR_MS);
  const count = Number((await redisConnection.get(key)) ?? 0);
  if (count >= env.AUTH_LOGIN_FAILURES_PER_HOUR) {
    throw new RateLimitError("Too many wrong passwords. Try again later, or reset your password.");
  }
}

export async function recordLoginFailure(email: string, ip: string) {
  await checkRateLimit(loginFailureBucket(email, ip), { windowMs: HOUR_MS });
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
  constructor(message = "Too many attempts. Try again in a minute.") {
    super(message);
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
