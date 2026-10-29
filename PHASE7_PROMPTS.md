# Phase 7 — "People" build prompts for Claude Code

How to use: open Claude Code in the repo root, paste ONE prompt, let it finish (checks green + commit),
then `/clear` and paste the next. Do them strictly in order — later prompts assume earlier ones landed.
Every prompt inherits CLAUDE.md's hard rules (can(), activity rows, UUIDv7, soft delete, never edit
applied migrations, `pnpm check` before commit, PROGRESS.md entry per milestone).

Decisions already made (do not re-ask):
- Timezone for every schedule/date rule: **Europe/Belgrade** (Kosovo time, CET/CEST). Never hard-code UTC offsets.
- Public holidays: **Kosovo**.
- Hosting: no Docker, no Vercel. Dev + prod use Neon (Postgres + pgvector), Upstash Redis (or local Redis), Cloudflare R2. Prod = a small VPS running api + worker under PM2.
- Removed features: SSO/SAML + SCIM, public REST API + API keys + webhooks, importers, GitHub PR links, Tauri desktop app, Goals/OKRs, Chat (channels, threads, DMs, Brain-in-chat, DM sound, chat attachments). Slack notify + automations STAY.

---

## 7.0a — Remove features

```
Read CLAUDE.md, ROADMAP.md (Phase 7) and the end of PROGRESS.md. We are starting Phase 7, milestone 7.0a.

Fully remove these features — code, tRPC routers, REST routes, web routes/pages, sidebar/nav entries,
settings sections, shared Zod schemas, permission actions in can() (and their tests), queues/workers,
env vars (.env.example + env.ts), e2e specs, and docs references:
1. SAML SSO + SCIM (auth/saml.ts, routes/saml.ts, routes/scim.ts, sso + scim-token routers, security page)
2. Public REST API v1 + API keys + webhooks (+ webhook queue/worker/runner, developer page)
3. Importers (CSV/Google Sheet import, import queue/runner, import page)
4. GitHub PR links (pr-link router, github-client, task-panel UI)
5. Tauri desktop app (delete apps/desktop entirely, build:desktop scripts, CI steps)
6. Goals/OKRs (+ goal-progress, dashboard/automation references to goals)
7. Chat: channels, private channels, threads, DMs, DM sound, chat attachments, Brain in chat,
   chat realtime events, chat notifications.
KEEP: Slack notify integration, automations, Google Drive picker, docs (incl. Brain in docs), Copywriter,
Library, dashboards, everything task-related.

Database: write NEW Drizzle migrations that drop the removed tables (never edit applied migrations).
Leave Postgres enum values that other kept tables still use (e.g. brain context_type 'channel') in place
but stop the code from creating them; note this in PROGRESS.md. Remove now-orphaned FKs/columns.

Then: pnpm install (prune deps no longer used), pnpm check, pnpm test, pnpm test:e2e must all pass.
Keep the Phase-2 smoke test green. Update PRD.md/ARCHITECTURE.md/DATA_MODEL.md/ROADMAP.md to mark these
as removed (one line each, not rewrites). PROGRESS.md entry, then commit "7.0a: remove features".
```

## 7.0b — No Docker: hosted services for dev, PM2 for prod

```
Milestone 7.0b (read ROADMAP.md Phase 7). Remove Docker from the workflow.
- package.json "dev": stop running `docker compose`; just run api + web + worker (turbo).
- Delete docker-compose.yml, Dockerfile, fly.toml; remove the Docker services from .github/workflows/ci.yml
  and instead use GitHub Actions `services:` containers for postgres(pgvector)/redis in CI only, plus a local
  S3-compatible fake if e2e needs storage (or mock storage in e2e) — CI may use containers, devs do not.
- .env.example: document Neon (DATABASE_URL, needs pgvector), Upstash or local Redis (REDIS_URL, note
  BullMQ needs a TCP redis:// / rediss:// URL, not the REST URL), Cloudflare R2 (S3_ENDPOINT etc.,
  S3_FORCE_PATH_STYLE=false). Make storage.ts bucket-CORS logic work with R2.
- env.ts production guard: keep rejecting localhost/dev defaults.
- Add ecosystem.config.cjs for PM2 with two apps: `canvas-api` (serves API + built web SPA, single origin)
  and `canvas-worker`. Add `pnpm start` / `pnpm start:worker` scripts that run the built output.
- Rewrite DEPLOYMENT.md for: Ubuntu VPS → install Node 20+ & pnpm & PM2 → git clone → .env → pnpm build →
  pnpm db:migrate → pm2 start ecosystem.config.cjs → pm2 save/startup → Caddy as HTTPS reverse proxy
  (WebSocket-friendly) with a sample Caddyfile. Write it for someone who has never used a VPS.
- Update CLAUDE.md "Commands" + ARCHITECTURE.md deploy row.
pnpm check + pnpm test pass. PROGRESS.md entry. Commit "7.0b: drop Docker, PM2 deploy".
```

## 7.1 — People roles, reporting lines, staff profiles

```
Milestone 7.1 (ROADMAP.md Phase 7).
Roles: add `people_role` enum ('super_admin','hr','operation_manager','staff_manager','staff')
on memberships, default 'staff'. Workspace owner is always treated as super_admin. Migrate the existing
`is_operations_manager` flag into people_role='operation_manager' (keep notifications working) and drop
the flag in a new migration. Add `manager_user_id` (nullable, "reports to") on memberships.
Permissions: extend can() with people actions (people:viewDirectory, people:manageStaff, leave:approve,
leave:recordForOthers, payroll:view, payroll:manage, contract:manage, report:viewTeam, performance:view,
holiday:manage, tasks:manageTeam ...). Staff managers act only on their direct reports (resource-level
check, same pattern as private-resource checks elsewhere). Unit-test the matrix.
Staff profiles: new `employee_profiles` table (membership_id uniq, phone, address, date_of_birth,
position/job_title, department, employment_start_date, emergency_contact_name/phone, status
'active'|'inactive', deactivated_at). HR can add/edit/deactivate; deactivating blocks login for that
workspace and hides them from pickers but keeps history.
UI: "People" section in the sidebar — Directory (virtualized, search, active/all filter), profile page,
HR edit form, role + reports-to editor. Landing after login: managers (super_admin/hr/operation_manager/
staff_manager) → team task view; staff → "My Tasks" (build a simple My Tasks page here if none exists:
all tasks assigned to me across lists, grouped by status, sorted by due).
Each role only sees nav sections it can use. Activity rows for every mutation. Playwright: HR creates
staff, sets manager, staff logs in and lands on My Tasks. PROGRESS.md, commit.
```

## 7.2 — Task approval flow, proof photo, transfer, collaborators

```
Milestone 7.2. Task lifecycle: pending → in progress → awaiting approval → completed.
- Add status kind 'review' (new migration, ALTER TYPE ADD VALUE). Seed new lists with statuses
  Pending(open) / In progress(active) / Awaiting approval(review) / Completed(done).
- Add `tasks.due_time` (time, nullable) and `tasks.requires_proof` (bool default false). Show due time
  everywhere due date shows. Overdue = past due date+time in Europe/Belgrade.
- Assignee can move a task to review; moving review → done requires tasks:manageTeam (task creator,
  the assignee's manager, operation_manager, hr, super_admin) = "approve"; "reject" sends it back to
  active with a required comment. If requires_proof, moving to review requires at least one image
  attachment marked `is_proof` (add column on attachments); show proof prominently in the task panel.
- Collaborators: `task_collaborators` (task_id, user_id) — can comment/attach/see, distinct from assignees.
- Transfer: "Transfer to colleague" action replaces one assignee with another, requires a note, notifies
  both, activity row.
- Notifications: approver notified on review; assignee notified on approve/reject; managers creating
  tasks for multiple people works from the create dialog (multi-assign + priority + due date + time).
Keep existing done-kind logic (completedAt, ops-manager notify) correct with the new kind; unit-test
transitions. Playwright: staff submits with proof → manager approves → completed. PROGRESS.md, commit.
```

## 7.3 — Daily reports + 16:45 reminder

```
Milestone 7.3. `daily_reports` (id, workspace_id, user_id, report_date date, body_json TipTap,
submitted_at, uniq(workspace_id,user_id,report_date)) and `daily_report_reads` (report_id, user_id,
read_at). Staff: "Daily report" page — today's form (edit until midnight) + own history. Managers: team
view by date (who submitted / who didn't), opening a report records a read; report shows "Read by" list.
Reminder: scheduler job that runs every few minutes and, on working days (Mon–Fri, not a public holiday
once 7.4 exists — leave a hook), at 16:45 Europe/Belgrade sends in-app + email reminder to active staff
who haven't submitted; idempotent (one reminder per user per day, tracked in a table or column). Pure
helper `isReminderDue(nowUtc, tz)` unit-tested incl. DST change days. Playwright for submit + read
receipt. PROGRESS.md, commit.
```

## 7.4 — Kosovo public holidays

```
Milestone 7.4. `public_holidays` (id, workspace_id, date, name, observed_date, is_recurring_fixed bool).
Seed Kosovo fixed-date holidays (Jan 1, Jan 2, Jan 7 Orthodox Christmas, Feb 17 Independence Day,
Apr 9 Constitution Day, May 1, May 9 Europe Day, Dec 25 Christmas) as recurring; movable ones (Catholic
& Orthodox Easter Monday, Eid al-Fitr, Eid al-Adha) are entered yearly by HR — UI makes that easy and
flags "no movable holidays entered for <year>". Observed rule: a holiday on Sat/Sun is observed the next
working day that is not already a holiday (pure fn, unit-tested). HR manages the calendar
(holiday:manage); everyone sees a calendar/list. Notifications: in-app + email to all active staff N days
before (default 2, workspace setting) — scheduler, idempotent. Wire the 7.3 reminder to skip holidays.
Add a `lib/working-days.ts` (isWorkingDay, countWorkingDays(from,to)) that 7.5 will use. PROGRESS.md, commit.
```

## 7.5 — Leave management

```
Milestone 7.5. Leave types: sick, vacation, personal, maternity, paternity, emergency.
Tables: `leave_requests` (id, workspace_id, user_id, type, start_date, end_date, working_days numeric,
reason, status pending|approved|rejected|cancelled, decided_by, decided_at, decision_note, recorded_by
null — set when HR records on someone's behalf, document attachment null), `leave_balances`
(user_id, workspace_id, year, entitlement_days, carried_over_days, uniq). Default vacation entitlement
is a workspace setting (default 20 working days — HR confirms); per-employee override.
Rules (pure, heavily unit-tested in lib/leave-balance.ts): only vacation consumes balance; working days
exclude weekends and observed public holidays (use lib/working-days.ts); unused vacation carries over to
next year (carry-over computed at year rollover by a scheduler job, idempotent); can't request more
than remaining balance; overlapping requests rejected.
Flow: staff request → their staff_manager or HR approves/rejects (leave:approve) → notifications both ways.
HR can record leave for anyone (status approved immediately). Calendar of who's off. Download a leave
document as PDF (use an existing PDF lib in the repo if any, else pdf-lib) with employee, dates, type,
working days, approver. Playwright: request → approve → balance decreases. PROGRESS.md, commit.
```

## 7.6 — Contracts & company documents

```
Milestone 7.6. `employment_contracts` (id, workspace_id, user_id, kind contract|annex|amendment,
parent_contract_id null, title, start_date, expiry_date null, attachment_id, uploaded_by, deleted_at).
HR uploads/replaces (contract:manage) using the existing direct-to-storage upload flow; "My Contract"
page shows the employee only their own documents (signed download URLs, permission-checked). Expiry:
scheduler notifies HR 30 and 7 days before expiry (idempotent). Company document library:
`company_document_categories` + `company_documents` (category, title, attachment, version history on
replace: keep old attachment rows). Everyone can view/download; HR manages. PROGRESS.md, commit.
```

## 7.7 — Payroll

```
Milestone 7.7. `payroll_records` (id, workspace_id, user_id uniq per workspace, net_salary_eur numeric(12,2),
id_card_number_enc, bank_name, iban_enc, account_holder, updated_by, updated_at). Encrypt id_card_number
and IBAN with AES-256-GCM using PAYROLL_ENCRYPTION_KEY (env, 32-byte base64; add to .env.example and the
env.ts production guard); lib/field-crypto.ts unit-tested. Only payroll:view / payroll:manage (hr,
super_admin) can see this — not managers, not staff (staff may see only their own record, masked except
last 4). Every view, edit and export writes an activity row (this is the payroll audit trail). Payroll page:
virtualized table, edit drawer. Export the whole table to Excel (exceljs) and PDF. Never log decrypted
values; never send them over WS. PROGRESS.md, commit.
```

## 7.8 — Performance report, Employee of the Month, Engagements board

```
Milestone 7.8.
Performance (performance:view; staff_manager sees own reports only): per employee for a date range —
total tasks, completed on time (completedAt ≤ due date+time), completed late, overdue (open & past due),
in progress; charts (reuse components/charts.tsx) + overdue task list. Pure metrics in
lib/performance.ts, unit-tested.
Employee of the Month: scheduler job on the 1st (Europe/Belgrade) computes last month's winner from
performance: score = 2×(completed on time) + 1×(completed late) − 2×(overdue at month end);
minimum 3 completed tasks to qualify; ties → more on-time, then fewer late, then earliest last completion.
Record the formula in PROGRESS.md as a decision.
Store in `employee_of_month` (workspace_id, month, user_id, score, breakdown_json). Banner on Home for
everyone all month; admins see a result panel with the ranking for days 1–5 of the following month.
Engagements: live board, one card per active employee — current in-progress tasks, next deadline,
status (on track / due today / overdue), updates via existing WS invalidation. Extend Workload page or
new route. Playwright for EoM computation via a test hook + engagements render. PROGRESS.md, commit.
```

## 7.9 — Import from Seri (needs a mongodump or read-only connection string)

```
Milestone 7.9. Write `apps/api/scripts/import-seri/` — a one-off importer from the old Seri HR app
(MongoDB). Input: a folder of mongodump/mongoexport JSON (or MONGO_URL read-only). Step 1: inspect the
collections and write SERI_MAPPING.md mapping each collection/field to Canvas tables; STOP and show me
the mapping before writing data. Step 2: importer with --dry-run (default) that prints counts + problems,
and --commit. Map: users → users/memberships/people_role/employee_profiles; tasks (+comments, statuses,
proof photos) → tasks; daily reports; leave requests + balances; holidays; contracts + documents;
payroll (encrypt on the way in). Idempotent via a `seri_import_map` (source_collection, source_id,
target_table, target_id). Passwords are NOT imported — after commit, send each imported user a
"set your password" email. Files: download from Seri's storage URLs into R2. PROGRESS.md, commit.
```

## 7.10 — Deploy

```
Milestone 7.10. Walk me (non-expert) through deploying with DEPLOYMENT.md: create Neon project
(enable pgvector), Upstash Redis (TCP URL), R2 bucket + CORS, VPS + domain, Caddy, PM2. Generate the
production .env checklist with every required value, run migrations, verify /health, then run the
Phase-0 and Phase-7 smoke paths against production. Fix anything that breaks, PROGRESS.md, commit.
```
