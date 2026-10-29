# CLAUDE.md — instructions for Claude Code building "Canvas"

You are building a work-management platform with an image-native AI brain. The spec lives in:
- `PRD.md` — what to build and phase scope
- `ARCHITECTURE.md` — stack and system design (follow it; don't substitute technologies)
- `DATA_MODEL.md` — schema source of truth
- `ROADMAP.md` — build order. **Work on the current milestone only. Never pull work forward from a later phase.**

## Workflow
1. Read the current milestone in `ROADMAP.md`. Check `PROGRESS.md` (create if missing) for where we left off.
2. Plan briefly, then implement. Small vertical slices: schema → API route → UI → test.
3. After each milestone: update `PROGRESS.md` (done / decisions / TODOs), run all checks, commit.
4. If the spec is ambiguous, choose the simplest option consistent with ARCHITECTURE.md and note the decision in `PROGRESS.md` — don't invent new scope.

## Commands
- `pnpm dev` — full stack (web + api + worker); needs Redis running in WSL and `.env` pointing at Supabase `canvas-dev` + R2 `canvas-dev` — no Docker (see `docs/LOCAL_SETUP.md`)
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations (never edit applied migrations)
- `pnpm test` — vitest; `pnpm test:e2e` — Playwright
- `pnpm check` — typecheck + lint + format (must pass before every commit)
- `pnpm build` then `pnpm start` / `pnpm start:worker` — run the built output; prod runs these under PM2 via `ecosystem.config.cjs` (see `DEPLOYMENT.md`)

## Repo layout
```
apps/web        React SPA (Vite, TanStack, Tailwind, shadcn/ui)
apps/api        Fastify + tRPC + WS + BullMQ workers
packages/db     Drizzle schema + migrations (source of truth = DATA_MODEL.md)
packages/shared Zod schemas, types, constants shared web/api
```

## Hard rules
- TypeScript strict; no `any` without a `// justified:` comment.
- All permission checks through `can(user, action, resource)` in `apps/api/src/auth/can.ts`. Never inline role logic.
- UUIDv7 ids; fractional `order_key` for ordering (use the `fractional-indexing` package); soft delete via `deleted_at`.
- Every user-visible mutation writes an `activity` row.
- All external AI calls go through `packages/shared` typed clients and run in BullMQ workers — never in request handlers. Every AI call writes an `ai_usage` row.
- Image providers only via the `ImageEngine` interface (`apps/api/src/image-engine/`). UI must never reference a provider name.
- Secrets from env only (`.env.example` kept current). Never commit keys.
- Rich text is TipTap JSON in `*_json` columns — never HTML strings.
- WS messages are invalidation events only (`{entity, id, kind}`), no payloads.

## UI conventions
- shadcn/ui components; dark mode from day 1; every list/table virtualized (TanStack Virtual) — assume 5k+ rows.
- Optimistic updates via TanStack Query with rollback on error.
- Image displays use blurhash placeholder → thumb → full-res on demand.

## This is an original product
Feature *categories* overlap with existing PM tools, but all UI, naming, copy, and visuals must be our own. Do not replicate ClickUp's interface, wording, or assets.

## Testing bar per milestone
- Unit tests for new pure logic (permissions, ordering, engine adapters with mocked HTTP).
- At least one Playwright path per user-facing milestone.
- The Phase-2 smoke test (generate → edit ×3 → attach) must stay green from M2.5 onward.
