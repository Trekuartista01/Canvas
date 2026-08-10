# Production-oriented image for the API (and a second container for the
# worker — see fly.toml's separate `worker` process group, same image).
# Expects managed Postgres (with pgvector), Redis, and S3 — not the Compose
# MinIO/dev defaults. Set NODE_ENV=production and real env vars at runtime.
#
# Build from repo root:
#   docker build -t canvas-api .
# Run API:
#   docker run --env-file .env.prod -p 3001:3001 canvas-api
# Run worker (same image, different command):
#   docker run --env-file .env.prod canvas-api pnpm start:worker
#
# `pnpm build` (turbo) builds both apps/api and apps/web — the API process
# itself serves apps/web's dist as static files (index.ts, prod-only) so
# there's a single public origin and no reverse-proxy to stand up.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS app
COPY . .
# Vite inlines VITE_* vars at build time, not runtime — unlike every other
# env var here they can't just be a Fly runtime secret. Pass via
# `--build-arg` (`docker build`) or fly.toml's `[build.args]` (`fly deploy`).
# Leave unset to ship without web-side Sentry (Dockerfile/DEPLOYMENT.md's
# other secrets are all runtime and unaffected either way).
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3001
# Migrate against the target DATABASE_URL before first traffic:
#   docker run --env-file .env.prod canvas-api pnpm db:migrate
CMD ["pnpm", "start:api"]
