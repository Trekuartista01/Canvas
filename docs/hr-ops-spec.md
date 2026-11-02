# Canvas: HR/Finance and Operations Manager features (build spec for Claude Code)

You are working on **Canvas**, Trekuartista's internal platform (React frontend, Node.js backend, PostgreSQL on Supabase, private file storage on Cloudflare R2, server on Oracle Always Free). Canvas is taking over the features of the old HR platform ("Seri"): People, Leave, Payroll, Contracts, Tasks, and Smart Search.

This spec adds two privileged roles and the features they own. **Before writing code:**

1. Explore the repo and summarise how auth, roles, routing, the People / Leave / Payroll / Contracts / Tasks / Smart Search pages, notifications, and file uploads work today.
2. Show me a plan that maps each section below to concrete files and migrations. Wait for my OK before making changes.
3. Build in the phase order at the bottom, and commit after each phase. Don't delete existing data. Write migrations so they can be reversed.

If something in the codebase contradicts this spec, stop and ask me. Don't guess.

---

## 1. Roles and permissions (everything else depends on this)

### Roles

| Role                 | Who                | Notes                                                                                                                                                                                  |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`              | Olsi (developer)   | Can view, edit and change **everything in Canvas except HR data**. That includes all boards, the Clients page, settings, accounts and roles. **No access to any HR data** (see below). |
| `ceo`                | The 2 CEOs         | Same responsibilities as the Operations Manager: manage all boards and full Clients page. No HR data.                                                                                  |
| `hr_finance`         | HR/Finance Manager | The only role that can see confidential HR data. There can be more than one.                                                                                                           |
| `operations_manager` | Operations Manager | Owns Tasks boards and the Clients page. No HR data.                                                                                                                                    |
| `employee`           | Everyone else      | Default role.                                                                                                                                                                          |

Implement this with named permissions, not role checks scattered around the code. For example `hr.view`, `clients.manage`, `boards.manage_all`, `roles.assign`, mapped to roles in one file. Then `ceo` and `operations_manager` share the same set, and future changes happen in one place.

### Permission matrix

| Area                                                                                                           | employee | operations_manager    | ceo                   | hr_finance | admin                 |
| -------------------------------------------------------------------------------------------------------------- | -------- | --------------------- | --------------------- | ---------- | --------------------- |
| People directory: name, photo, position, department, email                                                     | view     | view                  | view                  | view       | view                  |
| People: confidential fields (pay, contract details, personal data, leave allowance) and add/edit/remove people | no       | no                    | no                    | **full**   | no                    |
| Leave Approvals page                                                                                           | no       | no                    | no                    | **full**   | no                    |
| Contracts page                                                                                                 | no       | no                    | no                    | **full**   | no                    |
| Payroll page                                                                                                   | no       | no                    | no                    | **full**   | no                    |
| My Pay Details (**own** pay only)                                                                              | own      | own                   | own                   | own        | own                   |
| Request leave, see own leave history and balance                                                               | yes      | yes                   | yes                   | yes        | yes                   |
| Tasks (boards they belong to)                                                                                  | yes      | **manage all boards** | **manage all boards** | yes        | **manage all boards** |
| Clients page                                                                                                   | no       | **full**              | **full**              | no         | **full**              |
| Smart Search: HR documents (contracts, payroll, leave requests, Vendims)                                       | no       | no                    | no                    | **yes**    | no                    |
| Smart Search: Clients and client folders                                                                       | no       | yes                   | yes                   | no         | yes                   |
| Settings (non-HR), accounts, assign roles                                                                      | no       | no                    | no                    | no         | **yes**               |

### Hard rules

- **Enforce every rule on the server.** Hiding a menu item is not security. Every API route for HR data checks the `hr.*` permissions, which only `hr_finance` has. Every Clients route checks `clients.manage` (`operations_manager`, `ceo`, `admin`). Anything else gets a 403. If the frontend queries Supabase directly anywhere, add **Row Level Security** policies that enforce the same rules, and add tests for them.
- **No `admin` bypass for HR data.** Admin can do everything else, but HR data is the one exception. Grep for any existing "isAdmin → allow everything" shortcut and make sure it never reaches HR routes, HR files, HR search results or HR notifications.
- **Admin can never grant `hr_finance` to their own account.** Every change to who holds `hr_finance`, `ceo` or `operations_manager` is written to the audit log. It also sends an email and an in-app notice to every current HR user ("Olsi Sopi changed roles: X is now HR/Finance Manager").
- **Bootstrap:** a one-off seed script (`npm run seed:roles`) sets the first HR, Operations Manager and both CEO accounts by email, read from env vars (`SEED_HR_EMAILS`, `SEED_OPS_EMAILS`, `SEED_CEO_EMAILS`, all comma-separated). It refuses to run once an `hr_finance` user already exists.
- **Audit log** (`audit_log` table: who, action, entity, entity_id, timestamp, IP). Log every view, download, create, update and delete of HR data, plus every role change. Only HR can read it, from a simple "Access log" tab on the Payroll or People page.
- **Contract and Vendim files** go in a **private** R2 bucket under unguessable keys (`hr/contracts/{uuid}`). They are served only through short-lived signed URLs (5 minutes), created after the server-side role check. No public URLs, ever.
- **Cut over to production:** while developing, use dummy data for pay and contracts. When we go live, the real data is entered by HR, not by me.

---

## 2. Kosovo working-day calculator (shared by leave requests, balances and the Vendim)

Create one shared module (for example `server/lib/workingDays.ts`, with a client copy or an API endpoint) that every leave feature uses. **Never count days anywhere else.**

### Holiday calendar

- Table `official_holidays (id, date, name_sq, name_en, year, is_observed_substitute, created_by)`. Each row is an actual **non-working day**.
- **HR manages it** from a "Festat zyrtare / Official holidays" tab on the Leave Approvals page (add, edit, delete).
- **Seed 2026 and 2027.**
  - Fixed dates: 1 Jan (Viti i Ri), 2 Jan (Dita e dytë e Vitit të Ri), 7 Jan (Krishtlindjet Ortodokse), 17 Feb (Dita e Pavarësisë), 9 Apr (Dita e Kushtetutës), 1 May (Dita Ndërkombëtare e Punës), 9 May (Dita e Evropës), 25 Dec (Krishtlindjet Katolike).
  - Easter: compute Catholic Easter Monday and Orthodox Easter Monday with the standard algorithms.
  - Eid: Fitër Bajrami and Kurban Bajrami move every year and are announced by the government. Seed the expected dates with `name` including "(confirm date)". Show HR a banner on Home in December: "Add next year's official holidays".
- **Weekend rule:** add a setting `holiday_weekend_substitution` (default **ON**, editable by HR). When ON and a fixed holiday falls on a Saturday or Sunday, the seed adds the following Monday as a substitute day off (`is_observed_substitute = true`). HR can delete any substitute row.

### Functions

```
countWorkingDays(start, end) -> { total, byYear: {2026: n, 2027: m}, excludedHolidays: [{date, name}], excludedWeekendDays: n }
nextWorkingDay(date) -> date   // first Mon–Fri after `date` that is not an official holiday (return-to-work date)
previousWorkingDay(date) -> date   // last Mon–Fri before `date` that is not an official holiday (contract-ending alert day)
```

- A working day is Monday to Friday and not in `official_holidays`. The range is inclusive. Use Kosovo time (`Europe/Belgrade`) and date-only values: no time-of-day bugs around midnight or daylight saving.

### Required unit tests

- `25.02.2026 – 02.03.2026` → **4** working days. Return date **03.03.2026**. (This is the real Vendim in our reference photo.)
- `30.12.2026 – 05.01.2027`:
  - with substitution OFF → **4** days (30 and 31 Dec = 2 in 2026; 4 and 5 Jan = 2 in 2027). 1 Jan is excluded as a holiday; 2 Jan is a Saturday.
  - with substitution ON → **3** days, because 2 Jan 2027 falls on a Saturday so Mon 4 Jan is a substitute day off. `byYear = {2026: 2, 2027: 1}`.
- A range that is entirely weekends or holidays → 0, and the form blocks submission.
- `nextWorkingDay` skips weekends and holidays (for example, leave ending Thu 31.12.2026 → return Mon 04.01.2027 with substitution OFF, Tue 05.01.2027 with it ON).
- `previousWorkingDay`:
  - Tue 03.11.2026 → Mon 02.11.2026.
  - Mon 09.11.2026 → Fri 06.11.2026 (skips the weekend).
  - Mon 04.01.2027 → Thu 31.12.2026 (skips the weekend and the 1 Jan holiday).
  - Wed 18.02.2026 → Mon 16.02.2026 (skips Independence Day, Tue 17.02).

---

## 3. Leave: request → HR approval → Vendim

### Annual leave balance

- `leave_allowances (user_id, year, days_allowed, carried_over)`. HR sets these (default 20 working days, which is the legal minimum in Kosovo). HR can edit them per person, from People → confidential tab.
- **Balance** = allowed + carried_over − approved annual-leave days in that year − pending days (show pending separately).
- A request that crosses years deducts from each year using `byYear`.

### Employee: request leave

- Form fields: leave type (keep the existing types if Canvas has them. Balance and Vendim apply to **Annual leave / Pushim vjetor** only), start date, end date, optional note.
- **Live preview** as dates are picked: "4 working days · 1 Jan and 2 Jan are official holidays and are not counted · Remaining after this: 12 days".
- If the request goes over the balance, show a warning but still allow submitting. HR decides.
- The employee sees their own requests and status (Pending / Approved / Rejected) plus their balance.

### On submit

- Create `leave_requests (id, user_id, type, start, end, working_days, by_year jsonb, status, note, decided_by, decided_at, rejection_reason, vendim_pdf_key, vendim_docx_key)`. **Store the calculated days on the request** so a later holiday-calendar edit doesn't silently change past decisions.
- **In-app notification to every `hr_finance` user**, shown as a pop-up toast on **Home** and kept in the notification bell. Example: **"Olsi Sopi has requested annual leave from 30.12.2026 until 05.01.2027 (4 working days)."** Clicking it opens that request on Leave Approvals.
  - Use Supabase Realtime so it appears without a refresh. Fall back to polling every 60 seconds.
- **Email to every HR user** with the same text and a link to the request. Use **Resend** (free tier), configured through `RESEND_API_KEY` and `MAIL_FROM` env vars. Put it behind a small `sendEmail()` wrapper so SMTP can replace it later.

### Leave Approvals page (HR only)

- Tabs: **Pending** (default, with a count badge), **Approved**, **Rejected**, **Official holidays**, **Calendar** (month view of who is off).
- Each request shows: person, type, dates, working days, which holidays were excluded, the person's balance before and after, overlap with other approved leave on the same dates, and the note.
- **Approve** or **Reject**. Reject requires a short reason.
- **HR's own requests:** these also appear here. If more than one HR user exists, another HR user must approve them. If HR is alone, they can approve their own request, but the request is flagged "self-approved" in the audit log.

### On approve

1. Status → Approved. Deduct from the balance.
2. Employee gets an **in-app notification and an email**: "Your annual leave from 30.12.2026 until 05.01.2027 (4 working days) has been approved. You are expected back at work on 06.01.2027." The employee does **not** get the Vendim file.
3. **Generate the Vendim** (section 4) as **PDF and DOCX** and save both to private R2. Attach them to the request on Leave Approvals with **Download PDF**, **Download Word** and **Regenerate** buttons.

On reject: employee gets an in-app notification and an email with the reason.

---

## 4. Vendim document generation

The template is ready. Use **`templates/vendim-pushim-vjetor-template.docx`** (I'll add it to the repo). It is our original Vendim with the names and dates replaced by docxtemplater tags. **Don't redesign it or retype it.** Fill it as-is so the layout, logo, fonts and signature block stay identical. HR can also fill the same file by hand in Word, which is why the tags are in Albanian.

### Approach

- Use **docxtemplater** (default `{ }` delimiters) to fill the template → that file is the Word output.
- Convert that same DOCX to PDF with **LibreOffice headless** on the Oracle server (`soffice --headless --convert-to pdf`), so the PDF and Word versions are always identical. If LibreOffice isn't available, tell me before falling back to another method.
- The template uses Garamond. Install it (or a metric-compatible substitute) on the server so the PDF stays on one page. Check the rendered PDF is 1 page.

### Tags in the template

| Tag                                  | Source                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `{data_vendimit}`                    | approval date, `dd.MM.yyyy`. Appears twice: the intro and "Prishtinë, …"                                     |
| `{emri_mbiemri}`                     | People record → full name. Appears twice: point 1 and under "Pranoi:"                                        |
| `{lloji_kontrates}`                  | contract type on the People record: fixed-term → `për kohë të caktuar`; open-ended → `për kohë të pacaktuar` |
| `{data_kontrates}`                   | People record → current contract start date, `dd.MM.yyyy`                                                    |
| `{pozita}`                           | People record → position                                                                                     |
| `{viti}`                             | year of the leave start date. For a request crossing years, use `2026/2027`. Appears 3 times                 |
| `{data_fillimit}`, `{data_mbarimit}` | the request's start and end dates, `dd.MM.yyyy`                                                              |
| `{ditet_pune}`                       | **the stored value** from the request, which was calculated with section 2                                   |
| `{data_kthimit}`                     | `nextWorkingDay(end_date)`, `dd.MM.yyyy`                                                                     |

- Fixed text stays as in the template: Arian Ahmeti / Drejtor Menaxhues, the company name and address, and the gender-neutral forms "i/e punësuar", "i/e caktuar", "Punonjësi/ja". If the signer ever changes, HR edits the template file.
- Every tag must be filled. Fail loudly (no Vendim saved, error shown to HR) if any value is missing, for example a person with no contract start date. HR should then fix the People record.
- Add a test that renders the 25.02.2026–02.03.2026 example. Check that the DOCX text contains "(4 ditë pune)" and "03.03.2026".

---

## 5. People section (HR only for anything confidential)

- **Everyone** sees the directory: name, photo, position, department, email.
- **HR only:** a "Confidential" tab per person, plus **Add person**, **Edit** and **Remove**.
  - Confidential fields: gross and net salary, pay currency, bank details, personal number, address, phone, contract type (fixed-term / open-ended), contract start and end, annual leave allowance per year.
  - **Remove = archive** (soft delete with `archived_at`). Archived people disappear from lists and logins are disabled, but their contracts, payroll and leave history stay for records. Only HR can view archived people, and only HR can permanently delete.
- The API returns confidential fields **only** to HR. For everyone else, strip them in the serializer. Don't send the fields and hide them in the UI.

---

## 6. Contracts page (HR only)

- A list of people. Each person has their contract files: preview thumbnails, upload date, contract type, start and end, and who uploaded it.
- **Upload with drag-and-drop or click-to-choose.** It accepts JPG, PNG, HEIC and PDF, multiple files at once (multi-page contracts), up to 20 MB each. Show upload progress, and preview before saving.
- Files go to private R2 (section 1). Viewing means a signed URL plus a full-screen preview. Also: download, replace, delete (with confirmation, logged).
- On the Contracts page, show an "Ending soon" badge on contracts that end within 30 days. This is visual only; no notification.

### Contract-ending alert (in-app and email to HR)

- **One working day before a contract's end date, every HR user gets a Home notification and an email.**
  - Example: "Kontrata e Olsi Sopi përfundon më 03.11.2026. / Olsi Sopi's contract ends on 03.11.2026."
  - The notification links to that person on the Contracts page.
- The alert day is `previousWorkingDay(contract_end_date)`, using the section 2 calculator, so it always lands on a working day:
  - End date Tue 03.11.2026 → alert Mon 02.11.2026.
  - End date Mon 09.11.2026 → alert Fri 06.11.2026 (the weekend is skipped).
  - End date Mon 04.01.2027 → alert Thu 31.12.2026 (the weekend and 1 Jan are skipped).
  - If the end date itself falls on a weekend or holiday, the rule still applies: alert on the last working day before it.
- Run it as a **daily scheduled job at 08:00 Kosovo time** (node-cron on the Oracle server, or Supabase `pg_cron`). Each day the job finds contracts whose alert day is today and sends the alerts.
- Make the job **idempotent**: store `end_alert_sent_at` on the contract so a restart or a second run never sends a duplicate. If the server was down on the alert day, the next run sends any missed alerts for contracts that haven't ended yet.
- If HR changes a contract's end date, or uploads a new contract for that person, reset `end_alert_sent_at`.
- Archived people get no alerts. The alert goes to every `hr_finance` user and nobody else.

---

## 7. Payroll page (HR only)

- Keep the existing payroll features and put them behind the HR guard (server and client).
- Every view and export is written to the audit log.

---

## 8. My Pay Details (every user, own data only)

- On opening, show a **confirmation modal before loading any data**: "Kjo faqe përmban informacione konfidenciale. A jeni të sigurt që doni ta hapni? / This page contains confidential information. Are you sure you want to open it?" Buttons: **Cancel** (go back) / **Open**.
- Pay data is **fetched only after** the user clicks Open. It must not be in the page payload behind the modal.
- Ask again every time the page is opened. Add a "Hide" button to blur the amounts again.
- The API always uses the logged-in user's id from the session, never a user id from the URL or the body.

---

## 9. Smart Search permissions

- **Filter results on the server, before ranking.** Confidential items must never be returned to, or counted for, unauthorised users. That rules out "3 results hidden".
- If search uses embeddings or an AI index, HR documents (contracts, payroll, leave requests, Vendims, confidential People fields) live in a **separate HR scope** that is only queried for HR. Clients and client folders live in an Ops scope.
- Expected behaviour:
  - HR searches "Olsi Sopi" → directory card, contract files, payroll entries, leave requests, Vendims.
  - An employee, Ops, CEO or Admin searches "Olsi Sopi" → directory card plus normal shared content (tasks they can see). **No** contracts, payroll or leave approvals.
  - Ops, CEO or Admin searches "Zone" → Zone Club client folder plus its tasks. An employee searching "Zone" gets only tasks on boards they're members of.
- Write a test for each line above.

---

## 10. Tasks: Trello-style boards (Operations Manager)

- **Rename "Spaces" to "Boards"** everywhere in the UI (DB rename optional; a UI label is fine if a rename is risky).
- **Move board navigation from the bottom of the sidebar to the top of the Tasks page.** Use a horizontal board switcher (tabs plus a "+ New board" button, with a dropdown when there are many boards), like Trello's board header.
- Board view:
  - Horizontal **lists** (columns), defaults: To Do, In Progress, Review, Done. Lists can be added, renamed, reordered, archived. The board scrolls horizontally.
  - **Cards** drag and drop within and between lists (use `@dnd-kit`). Order is persisted (`position` float or lexorank). Updates are optimistic.
  - "+ Add a card" at the bottom of each list for quick-add by title.
  - Card front: title, labels, client chip, assignee avatars, due date (red when overdue), checklist progress, comment and attachment counts.
  - **Card detail modal:** description, assignees, due date, labels, checklist, attachments, comments/activity, **Client** field (section 11), move to another board or list, archive.
  - Filters at the top: assignee, label, client, due date.
- Permissions: Operations Manager, CEOs and Admin can create, edit and archive any board and manage members. Other users see boards they're members of, and can create and move cards there.
- Assigning someone to a card sends them an in-app notification.

---

## 11. Clients page (Operations Manager, CEOs and Admin)

- Table `clients (id, name, aliases text[], logo_key, color, archived_at)`. Example: name "Zone Club", aliases ["Zone", "Zone Club Prishtina"].
- **Clients page:** a grid of client "folders" (logo, name, open-task count). Opening a folder shows **every task linked to that client across all boards**, grouped by status/list, with a link to open the card. Ops can add, edit and archive clients and their aliases.
- **Linking tasks to clients (auto-detect plus manual):**
  - When a card is created or its title/description changes, match against every client's name and aliases. Matching is case-insensitive, on word boundaries, and ignores Albanian diacritics (ë→e, ç→c).
  - On a match, **pre-fill the card's Client field** and show a small chip: "Detected: Zone Club". It can be changed or cleared. If several clients match, show them as suggestions and let the user pick one.
  - Once a user sets or clears the field by hand, don't overwrite it on later edits.
  - The Client field also has a normal searchable dropdown, plus "+ New client" (Ops, CEO and Admin only).
  - The task stays on its board. The Clients page is a filtered view (no copying or moving).
- The Clients page and client routes are for **Ops, CEOs and Admin only** (not HR, not employees). Board members can see the client chip on cards they already have access to.

---

## 12. Notifications (shared)

- Table `notifications (id, user_id, type, title, body, link, read_at, created_at)`.
- Home shows new ones as toast pop-ups once, then they live in the bell dropdown with an unread count and "mark all read".
- Types used by this spec: leave_requested (to HR), leave_approved / leave_rejected (to the employee), contract_expiring (to HR), role_changed (to HR), task_assigned (to the assignee), holidays_missing (to HR, December).
- Emails go out for: leave_requested, leave_approved, leave_rejected, role_changed, contract_expiring (one working day before the end date; see section 6).

---

## Build order (commit after each phase)

1. Roles (including `ceo`), permission map, middleware, RLS, audit log, seed script. Add tests proving that Admin, CEO, Ops and employees get a 403 on every HR route, and that employees and HR get a 403 on every Clients route.
2. Working-day calculator, official holidays table and seed, HR holidays tab, plus the unit tests in section 2.
3. People confidential fields and archiving, leave allowances.
4. Leave request form → notifications (in-app and email) → Leave Approvals page → approve/reject flow.
5. Vendim generation (DOCX and PDF), storage, download and regenerate.
6. Contracts page with drag-and-drop uploads and private R2, plus the daily contract-ending alert job.
7. Payroll guard and My Pay Details confirmation modal.
8. Smart Search scoping and its tests.
9. Tasks → Trello-style Boards.
10. Clients page and auto-detect.

## Acceptance checklist (run through it at the end and report results)

- [ ] Logged in as Admin or CEO: Leave Approvals, Contracts, Payroll and People → Confidential all return 403 from the API, and their nav items are hidden.
- [ ] Logged in as Admin or CEO: the Clients page and board management work exactly as for the Operations Manager.
- [ ] Admin cannot give themselves `hr_finance`. Role changes email HR.
- [ ] Employee request 30.12.2026–05.01.2027 shows the right day count for the current substitution setting. HR gets a Home pop-up and an email.
- [ ] HR approves → employee gets a notification and an email with the correct return date. A PDF and a DOCX Vendim appear on the request, matching the reference layout.
- [ ] Contracts: drag 3 images in at once → they save, preview, and are only reachable via expiring links.
- [ ] A contract ending 03.11.2026 triggers one HR notification and one email on 02.11.2026 at 08:00. A contract ending Mon 04.01.2027 triggers them on Thu 31.12.2026. Running the job twice sends nothing extra.
- [ ] My Pay Details: no pay data in the network tab until "Open" is clicked.
- [ ] Smart Search behaves as described in section 9 for HR, Ops, Admin and employee accounts.
- [ ] Boards switcher is at the top. Cards drag between lists and stay in place after a refresh.
- [ ] A new card titled "Zone – story posts" auto-suggests Zone Club and shows up in the Zone Club folder on the Clients page (visible to Ops, CEOs and Admin only).
