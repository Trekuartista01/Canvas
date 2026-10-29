# PRD — "Canvas" (working name): Work OS with an Image-Native AI Brain

> **Removed in M7.0a (Phase 7):** SAML SSO + SCIM, public REST API + API keys + webhooks, importers, GitHub PR links, Tauri desktop app, Goals/OKRs, and Chat (channels, threads, DMs, chat attachments, Brain-in-chat). Mentions of these below are historical.

## 1. Vision

A ClickUp-class work platform (tasks, docs, chat, views, automations) that is **image-native at its core**. Where ClickUp bolted AI onto text, our AI brain treats images as first-class citizens: every task, doc, and chat can generate images from a prompt and iteratively edit any image through conversation ("make the background darker", "remove the person on the left", "turn this into a banner version").

This is an original product. We take feature *categories* from the work-management space but design our own UI, naming, data model, and workflows. No copying of ClickUp's UI, copy, or assets.

## 2. Target user

Teams whose daily work revolves around visual assets (marketing, design, content, e-commerce) and who currently juggle a PM tool + an image tool + an AI tool.

## 3. Differentiator

**The Image Brain.** One conversational AI, available everywhere in the app, that can:
- Generate images from a text prompt (with style presets and brand palette).
- Edit any image iteratively — every request produces a new *version*, never overwrites.
- Maintain a full version tree per image (branch, compare, revert).
- Attach generated/edited images directly to tasks, docs, and chat messages.
- Use workspace context (task description, brand settings) to inform generations.

## 4. Feature inventory (full parity target, mapped to phases)

### Phase 1 — Core work graph (MVP)
| Feature | Notes |
|---|---|
| Workspaces → Spaces → Folders → Lists → Tasks | Same hierarchy concept, our own naming |
| Tasks: title, description (rich text), status, assignees, due/start dates, priority | Statuses are custom per-list |
| Subtasks & checklists | Arbitrary nesting depth 2 for MVP |
| Comments with @mentions | Threaded, emoji reactions |
| Custom fields | text, number, date, dropdown, label, checkbox, URL, currency, **image** |
| Tags | Workspace-scoped |
| List view + Kanban board view | Drag-and-drop, inline edit |
| Search (basic) | Title + description, Postgres FTS |
| Auth & members | Email/password + Google OAuth, roles: owner/admin/member/guest |
| File attachments | S3-compatible storage; images get thumbnails + preview |

### Phase 2 — The Image Brain (the differentiator, built early on purpose)
| Feature | Notes |
|---|---|
| Brain chat panel | Slide-over panel available from any task/doc/chat |
| Image generation | Prompt → image(s); aspect-ratio presets; style presets; brand palette injection |
| Iterative image editing | Select any image → conversational edits; each edit = new version node |
| Version tree | Branch, compare side-by-side, revert, promote version to "current" |
| Attach to anything | One-click attach generated image to task/comment/doc/chat |
| Image understanding (supporting) | Auto-alt-text, auto-tagging, OCR — needed for search & context |
| Text assist (baseline) | Summarize task threads, draft descriptions — table stakes, low effort |
| Credit/usage metering | Track per-user generation cost; soft limits |

### Phase 3 — More views + collaboration
Calendar view, Table view, Gantt/Timeline view, Workload view, Everything view; watchers & notifications (in-app + email); task dependencies (blocks/blocked-by, waiting-on); milestones; recurring tasks; reminders; task templates; time tracking (manual + timer) and timesheets.

### Phase 4 — Docs, Chat, Whiteboard-lite
Docs/wikis with collaborative real-time editing (CRDT via Yjs); doc → task linking; channel-based chat with threads; image proofing/annotation on attachments (pin comments to image regions — pairs naturally with the Image Brain); forms that create tasks; clips (screen recording upload).

### Phase 5 — Automation & platform
Automations engine (trigger → condition → action, incl. "generate image" as an action); dashboards with widgets (charts over tasks, time, usage); goals/OKRs; public REST API + API keys; webhooks; import from a computer-uploaded CSV or a published Google Sheet (tool-agnostic column-alias parsing, not tied to any specific PM tool's export format); integrations: Slack, Google Drive, GitHub (start with these 3).

### Phase 6 — Enterprise & polish
SSO (SAML) & SCIM; granular permissions & custom roles; audit log; guest permission controls; mobile (React Native or PWA first); desktop wrapper (Tauri); connected/semantic search across tasks+docs+images (pgvector embeddings, incl. image embeddings for visual search); data export.

## 5. Explicitly out of scope (v1)
- Email client inside the app, native video calls, ClickUp-style "Super Agents" marketplace, whiteboards with infinite canvas (revisit after Phase 4), HIPAA-grade compliance.

## 6. Success criteria
- Phase 1+2 usable end-to-end by our own team within ~6–8 weeks of Claude Code sessions.
- Image loop: prompt → generate → 3 rounds of edits → attach to task in under 60 seconds.
- p95 board render < 200ms with 5k tasks in a list (virtualized).

## 7. Risks
| Risk | Mitigation |
|---|---|
| Scope explosion ("all features") | Strict phase gates; nothing from phase N+1 until N's acceptance criteria pass |
| Image API cost | Metering from day one; cache; low-res previews for edit iterations |
| Real-time sync complexity | Phase 1 uses simple WebSocket invalidation; CRDTs only for Docs in Phase 4 |
| Provider lock-in for image models | Provider-agnostic `ImageEngine` interface (see ARCHITECTURE.md) |
