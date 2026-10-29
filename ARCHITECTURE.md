# ARCHITECTURE.md

> **Removed in M7.0a (Phase 7):** SAML SSO + SCIM, public REST API + API keys + webhooks, importers, GitHub PR links, Tauri desktop app, Goals/OKRs, and Chat (channels, threads, DMs, chat attachments, Brain-in-chat). Mentions of these below are historical.

## 1. Stack (chosen for Claude Code velocity)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Claude Code navigates one repo well |
| Frontend | React + Vite + TypeScript, TanStack Router/Query/Table, dnd-kit, Tailwind + shadcn/ui | Fast iteration, virtualized tables for 5k+ rows |
| Backend | Node + TypeScript, Fastify, tRPC (internal) + REST (public API later) | End-to-end types; tRPC keeps Claude Code honest |
| DB | Supabase Postgres (pgvector) + Drizzle ORM, via the Session pooler (TLS, small pools) | Migrations as code; free hosted Postgres with pgvector, no local DB server |
| Realtime | WebSocket (fastify-websocket) publishing invalidation events; clients refetch via TanStack Query | Simple, replace with CRDT only for Docs |
| Jobs | BullMQ + Redis (local: WSL in dev, apt on the server) | Image generation runs async; notifications |
| Storage | Cloudflare R2 (S3 API), bucket per environment | Images are the hot path — no egress fees |
| Auth | Lucia or Auth.js; sessions in Postgres | Google OAuth + email/password |
| Deploy | No Docker. Dev: `pnpm dev` + Supabase/R2 dev resources. Prod: PM2 (`ecosystem.config.cjs`) + Caddy on an Oracle Always Free VM, nightly `pg_dump` to R2 | €0 hosting, one public origin |

## 2. System diagram

```
Browser (React SPA)
   │  tRPC / WS
   ▼
Fastify API ──────────► Postgres (core data, sessions)
   │      │
   │      └───────────► Redis (queues, pub/sub, rate limits)
   ▼
BullMQ workers
   ├── image-worker ──► ImageEngine (provider adapters) ──► S3 (originals, versions, thumbs)
   ├── notify-worker ─► email / in-app
   └── webhook-worker
```

## 3. The Image Brain (core subsystem)

### 3.1 ImageEngine — provider-agnostic interface
Claude models do not generate images, so the Brain is two-headed:
- **Reasoning/orchestration + image understanding:** Claude API (vision input for critique, alt-text, tagging, edit-prompt refinement).
- **Generation/editing:** a pluggable image model behind one interface.

```ts
interface ImageEngine {
  generate(req: { prompt: string; size: AspectPreset; style?: StylePreset;
                  brandPalette?: string[]; n?: number }): Promise<GeneratedImage[]>;
  edit(req: { sourceImageUrl: string; instruction: string;
              maskUrl?: string; size?: AspectPreset }): Promise<GeneratedImage[]>;
}
```

**Adapters (build in this order):**
1. `GeminiImageAdapter` — Gemini image model ("nano-banana" family): strong iterative, instruction-based editing; best fit for the "change images to each request" loop.
2. `OpenAIImageAdapter` — gpt-image-1: strong generation quality + inpainting with masks.
3. `FalAdapter` / `ReplicateAdapter` — access to FLUX etc. for cost/style flexibility.

Config picks the default per workspace; the UI never knows which provider ran. Verify current model names/pricing at build time — this space moves monthly.

### 3.2 Edit loop & version tree
- Every image is an `image_asset` (original upload or generation).
- Every generation/edit creates an `image_version` node with `parent_version_id` → a tree.
- Conversational edits: the Brain (Claude) rewrites the user's casual request into a precise edit instruction, optionally auto-generates a mask (Phase 2.5), calls `ImageEngine.edit` on the *selected version*, appends a child node.
- UI: version tree sidebar, side-by-side compare, "set as current", branch from any node.
- Store: original at full res; per-version full res + 512px thumb + blurhash. Edit iterations preview at reduced res; final "upscale/finalize" step re-runs at full res.

### 3.3 Brain chat
- One `brain_conversation` per context (task, doc, channel, or global), messages persisted.
- Tool-use pattern: Claude with tools `generate_image`, `edit_image`, `attach_to_task`, `search_workspace`, `summarize_thread`. The model decides; the server executes via BullMQ and streams status (queued → generating → done) over WS.
- Context injection: task title/description, list name, brand settings (palette, tone, logo do/don'ts) prepended as system context.

### 3.4 Metering
`ai_usage` row per operation (user, workspace, provider, model, credits, cost estimate). Soft monthly cap per workspace; admin dashboard widget in Phase 5.

## 4. Cross-cutting decisions
- **IDs:** UUIDv7 everywhere (sortable).
- **Soft deletes** on user-visible entities (`deleted_at`).
- **Ordering:** fractional indexing (`order_key` string) for tasks within status columns and lists — avoids reorder cascades.
- **Permissions:** role on workspace membership + per-space overrides. Check in one `can(user, action, resource)` helper; never inline.
- **Activity log:** append-only `activity` table from Phase 1 (feeds notifications, later audit log).
- **Realtime protocol:** server emits `{ entity: "task", id, listId, kind: "updated" }`; clients invalidate queries. No payloads over WS in Phase 1.
- **Public API (Phase 5):** REST mirroring internal tRPC routers, versioned `/api/v1`, API-key auth.

## 5. Data model (summary — full DDL in DATA_MODEL.md)
Core: `users, sessions, workspaces, memberships, spaces, folders, lists, statuses, tasks, subtask via parent_task_id, checklists, checklist_items, comments, tags, task_tags, custom_field_defs, custom_field_values, attachments, activity, notifications`.
Image Brain: `image_assets, image_versions, brain_conversations, brain_messages, ai_usage, brand_settings`.
Later: `docs, doc_revisions, channels, messages, automations, automation_runs, dashboards, widgets, time_entries, goals, api_keys, webhooks`.

## 6. Testing & quality gates
- Vitest unit tests for permission helper, ordering, ImageEngine adapters (mocked HTTP).
- Playwright smoke: create task → generate image in Brain → edit twice → attach → appears on task.
- CI: typecheck + lint + tests on every phase gate.
