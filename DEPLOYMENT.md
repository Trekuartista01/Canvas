# DEPLOYMENT.md — production deploy checklist

Target shape per ARCHITECTURE.md: Docker Compose locally → Fly.io/Railway in
prod. `fly.toml` in the repo root is a Fly starting point; swap the
equivalent steps if deploying to Railway instead (same image, same env
vars). This doc assumes Fly.

## 1. Provision infrastructure (once)

- **Postgres with pgvector** — managed (Fly Postgres, Neon, Supabase, RDS…).
  Must support `CREATE EXTENSION vector` (the embeddings migration runs
  this itself; the extension binary just needs to be present).
- **Redis** — managed (Upstash, Fly Redis, ElastiCache…). Used for BullMQ
  (image gen, webhooks, notifications, scheduler) — required in prod, not
  optional.
- **S3-compatible bucket** — real S3 or Cloudflare R2 (cheap egress, see
  ARCHITECTURE.md). Configure real bucket CORS for the direct-upload flows
  (`attachment.presignUpload` etc. — this is `MINIO_API_CORS_ALLOW_ORIGIN`'s
  prod equivalent, done on the bucket, not via env var).
- **Fly app**: `fly launch --no-deploy` from repo root (reuses `fly.toml`;
  pick the real app name + region when prompted, or edit the file first).
  Fly auto-detects the two process groups (`app`, `worker`) already
  declared in `fly.toml`.

## 2. Required secrets

`apps/api/src/env.ts` refuses to boot in production if any of these still
look like local/dev defaults (localhost URLs, the MinIO `canvas`/
`canvas12345` credentials). Set the real values as Fly secrets — never
commit them:

```
fly secrets set \
  DATABASE_URL=postgres://... \
  REDIS_URL=redis://... \
  S3_ENDPOINT=https://... \
  S3_REGION=... \
  S3_BUCKET=... \
  S3_ACCESS_KEY_ID=... \
  S3_SECRET_ACCESS_KEY=... \
  WEB_URL=https://your-domain \
  GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback
```

Notes:

- **`WEB_URL` is the single public origin.** The API
  process now also serves the built web SPA (single-origin, see
  `apps/api/src/index.ts` and the Dockerfile) — there's no separate web
  deployment or cross-site cookie story to configure.
- `S3_FORCE_PATH_STYLE` defaults to `true` (needed for MinIO); set it to
  `false` for real S3/R2 virtual-hosted-style URLs if your bucket needs
  that.

Optional but recommended, same `fly secrets set` mechanism:

- `ANTHROPIC_API_KEY` — Brain chat + image understanding. Unset = mocked.
- `OPENAI_API_KEY`, `GEMINI_API_KEY` — image generation adapters. Unset =
  mocked per-workspace ImageEngine calls.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — "Continue with Google".
  Unset = that button is hidden, email/password still works.
- `SENTRY_DSN` (API/worker) and `VITE_SENTRY_DSN` (build-time, web) — error
  tracking. `VITE_SENTRY_DSN` must be set _before_ `pnpm build` runs (Vite
  inlines it), so it needs to be a build-arg/build-time env var, not just a
  runtime Fly secret.
- SMTP vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `EMAIL_FROM`) — notification digest emails. Unset = logged, not sent.

Full var list with descriptions: `.env.example`.

## 3. Deploy

```
fly deploy
```

Builds the root `Dockerfile` (`pnpm build` → both `apps/api` and
`apps/web`), ships one image, and runs it as both the `app` and `worker`
process groups per `fly.toml`.

**Before first traffic, run migrations against the target `DATABASE_URL`:**

```
fly ssh console -C "pnpm db:migrate"
```

(or run `pnpm db:migrate` from CI/a one-off machine with the same
`DATABASE_URL` secret — never edit an already-applied migration, per
CLAUDE.md).

## 4. Verify

- `GET https://your-domain/health` → `{"ok":true,"checks":{"api":"ok","database":"ok","redis":"ok"}}`
  (this is also `fly.toml`'s own health check — a red deploy means this
  isn't 200 yet).
- Sign up → create workspace → invite a second user (Phase 0 accept
  criteria) as a live smoke test.
- Phase-2 smoke test (generate → edit ×3 → attach) if image provider keys
  are set.

## Known scaling caveat

Realtime invalidation (WS) is in-process pub/sub, not Redis (see
PROGRESS.md's note near "In-process pub/sub, not Redis") — correct for a
single `app` machine, which is what `fly.toml` and this checklist assume
(`min_machines_running = 1`, no autoscale-out). Revisit with Redis pub/sub
before running more than one `app` instance concurrently.
