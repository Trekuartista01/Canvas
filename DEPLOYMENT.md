# DEPLOYMENT.md — Canvas in production, step by step (€0)

This walks through putting Canvas online for the first time, assuming you've never run a server. Follow the steps in order; each one ends with a check. Budget an afternoon.

**What runs where**

- **Database:** a Supabase project `canvas-prod` (free tier, Postgres + pgvector).
- **Files and backups:** a Cloudflare R2 bucket `canvas-prod` (free tier, 10 GB).
- **App server:** one Oracle Cloud _Always Free_ Ubuntu VM. On it:
  - PM2 keeps two processes running (`ecosystem.config.cjs`):
    - `canvas-api`: the API plus the built web app, from one origin, listening on `127.0.0.1:3001` only;
    - `canvas-worker`: background jobs and the scheduler (reminders, notices, Employee of the Month…).
  - Caddy terminates HTTPS on ports 80/443 and forwards to the API.
  - Redis (localhost only, with a password) holds the job queues.
  - A nightly cron job backs the database up to R2.

No Docker anywhere. For a development machine see `docs/LOCAL_SETUP.md`.

Files in the repo you'll use: `deploy/setup-server.sh` (installs everything on the VM), `deploy/Caddyfile`, `deploy/redis-canvas.conf`, `scripts/backup-db.sh`, `scripts/restore-db.sh`, `pnpm preflight` (checks the whole setup) and the smoke test (`apps/e2e/smoke`).

---

## 1. Supabase: the database

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
   - Name: `canvas-prod`. Region: **Central EU (Frankfurt)** (closest to Kosovo). Plan: Free.
   - Set a long **database password** and save it in your password manager. You need it in a moment.
2. When the project is ready: top bar → **Connect** → **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Put your password in place of `[YOUR-PASSWORD]`. This is `DATABASE_URL`.
   - Use the **Session** pooler (port **5432**). Never the Transaction pooler (port 6543): it breaks the app.
3. pgvector: **Database → Extensions** → search `vector` → enable it. (The first migration also creates it if missing; `pnpm preflight` checks either way.)
4. Optional, stricter TLS: **Project Settings → Database → SSL Configuration → Download certificate**. Later you'll copy it to the VM and set `SUPABASE_CA_CERT` to its path.

Free projects pause after 7 days with no activity. A live app's traffic and the nightly backup keep it awake.

✅ Check: you have the Session pooler URI with your password in it.

## 2. Cloudflare R2: file storage

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage** → **Create bucket** → name `canvas-prod`, location _Automatic_ (or EU).
2. Bucket → **Settings → CORS Policy → Add CORS policy**, paste (with your real domain):
   ```json
   [
     {
       "AllowedOrigins": ["https://canvas.your-domain.com"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Browsers upload attachments straight to R2, so without this rule every upload fails.
3. R2 overview → **Manage R2 API Tokens** → **Create API token**:
   - Permissions: **Object Read & Write**. Specify bucket: **`canvas-prod` only**. TTL: forever.
   - Copy the **Access Key ID** and **Secret Access Key** (shown once) → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
   - Copy the **S3 endpoint** shown on the same page (`https://<account-id>.r2.cloudflarestorage.com`) → `S3_ENDPOINT` (without the `/canvas-prod` at the end).

The app never creates buckets or changes CORS on R2; both are dashboard-only.

✅ Check: you have the endpoint, the key pair and the CORS rule saved.

## 3. Oracle Cloud: the server

### 3.1 An SSH key (on your Windows PC)

Open **PowerShell** and run:

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\canvas_oracle -C "canvas-prod"
Get-Content $HOME\.ssh\canvas_oracle.pub
```

Press Enter twice (no passphrase), or set one if you prefer. The second command prints your **public** key (`ssh-ed25519 AAAA… canvas-prod`); copy it. The private key `canvas_oracle` never leaves your PC.

### 3.2 Create the VM

[cloud.oracle.com](https://cloud.oracle.com) → sign up (a card is asked for identity; Always Free resources cost nothing) → choose an **EU home region** (Frankfurt or Amsterdam; it can't be changed later).

**Compute → Instances → Create instance**:

- **Name:** `canvas-prod`.
- **Image and shape → Edit:**
  - Image: **Canonical Ubuntu 24.04**.
  - Shape: **Ampere** → `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB memory** (inside the Always Free limits).
- **Networking:** keep "Create new virtual cloud network" and "Assign a public IPv4 address".
- **Add SSH keys → Paste public keys** → paste the key from 3.1.
- **Create**.

"Out of capacity" is common for free Ampere shapes. Try another **availability domain** (AD-1/2/3) in the same screen, try again later, or use a smaller shape (1 OCPU / 6 GB is enough for this app).

When it's running, copy its **Public IP address** from the instance page.

### 3.3 Open ports 80 and 443 in Oracle's network

Instance page → the **Subnet** link → **Security Lists** → the default list → **Add Ingress Rules**, twice:

| Source CIDR | IP protocol | Destination port |
| ----------- | ----------- | ---------------- |
| `0.0.0.0/0` | TCP         | `80`             |
| `0.0.0.0/0` | TCP         | `443`            |

Don't open 3001: the API only listens on localhost behind Caddy. The VM has its own firewall too; `setup-server.sh` opens 80/443 there (step 4).

### 3.4 Log in

```powershell
ssh -i $HOME\.ssh\canvas_oracle ubuntu@<public-ip>
```

Type `yes` the first time. You're now on the server: everything in steps 4–6 runs there, in this window.

✅ Check: the prompt reads `ubuntu@canvas-prod:~$`.

## 4. Install and configure the app on the server

### 4.1 Get the code

The repo is private, so give the server a read-only **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_canvas -N "" -C "canvas-prod deploy key"
cat ~/.ssh/github_canvas.pub
```

GitHub → `Trekuartista01/Canvas` → **Settings → Deploy keys → Add deploy key** → paste it, title `canvas-prod`, leave "Allow write access" **off**. Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_canvas
  IdentitiesOnly yes
EOF
git clone git@github.com:Trekuartista01/Canvas.git ~/canvas-app
cd ~/canvas-app
```

### 4.2 Install everything

```bash
bash deploy/setup-server.sh
```

It sets the timezone to Europe/Belgrade and installs Node 22 LTS, pnpm (the version pinned in `package.json`), PM2, Redis (localhost only, generated password), Caddy and the PostgreSQL 17 client (for backups). It also opens ports 80/443 in the VM's firewall. It's safe to re-run. At the end it prints a `REDIS_URL=…` line (also saved in `~/.canvas-redis-url`): you need it for `.env`.

> Node 22 rather than the older "Node 20" you may see mentioned elsewhere: the repo requires ≥ 22.13, and Node 20 is end-of-life.

### 4.3 The `.env` file

```bash
cp .env.example .env
chmod 600 .env
nano .env        # Ctrl+O, Enter to save; Ctrl+X to exit
```

Fill it in from this checklist (`.env.example` explains each line too):

| Variable                                                              | Required    | Value / where to get it                                                                                                 |
| --------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                        | yes         | Supabase Session pooler URI with your password (step 1.2)                                                               |
| `SUPABASE_CA_CERT`                                                    | optional    | path to the downloaded certificate, e.g. `/home/ubuntu/canvas-app/prod-ca.crt` (step 1.4)                               |
| `REDIS_URL`                                                           | yes         | the line printed by `setup-server.sh` (`cat ~/.canvas-redis-url`)                                                       |
| `S3_ENDPOINT`                                                         | yes         | `https://<account-id>.r2.cloudflarestorage.com` (step 2.3)                                                              |
| `S3_REGION` / `S3_FORCE_PATH_STYLE`                                   | yes         | `auto` / `false`                                                                                                        |
| `S3_BUCKET`                                                           | yes         | `canvas-prod`                                                                                                           |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`                           | yes         | the R2 token (step 2.3)                                                                                                 |
| `WEB_URL`                                                             | yes         | `https://canvas.your-domain.com`: no trailing slash                                                                     |
| `PAYROLL_ENCRYPTION_KEY`                                              | yes         | generate it on the server, step 4.4. Never invent or reuse one                                                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | recommended | your mail provider's SMTP settings. Without them, reminders, invites and password emails are only logged, never sent    |
| `EMAIL_FROM`                                                          | with SMTP   | e.g. `Canvas <no-reply@your-domain.com>` (a sender your SMTP provider allows)                                           |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                           | optional    | Google Cloud console → APIs & Services → Credentials (OAuth client, Web). Leave empty for email + password sign-in only |
| `GOOGLE_REDIRECT_URI`                                                 | with Google | `https://canvas.your-domain.com/auth/google/callback` (also add it in the Google console)                               |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`               | optional    | AI providers. Unset = Brain/image generation use mock providers                                                         |
| `SENTRY_DSN` / `VITE_SENTRY_DSN`                                      | optional    | Sentry project DSN (API / web). `VITE_SENTRY_DSN` must be in `.env` **before** `pnpm build`                             |

Don't set these in `.env`: `NODE_ENV`, `DB_POOL_MAX` and `API_HOST` come from `ecosystem.config.cjs`. Never set `SAFE_OUTBOUND_ALLOW_PRIVATE`, `E2E_TEST_HOOKS` or `SERVE_WEB_DIST` in production (the API refuses to start with the first two).

### 4.4 Payroll encryption key

Payroll ID-card numbers and IBANs are stored encrypted (AES-256-GCM). The key lives only in `.env` on the server, as `PAYROLL_ENCRYPTION_KEY`: 32 random bytes, base64-encoded. **Generate it once, on the server, and never change it afterwards.** Anything encrypted with one key can't be read with another.

**1. Generate it and write it into `.env`:**

```bash
cd ~/canvas-app
# Fills the empty PAYROLL_ENCRYPTION_KEY= line (copied from .env.example) with a new random key.
sed -i "s|^PAYROLL_ENCRYPTION_KEY=.*|PAYROLL_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
```

If your `.env` is older and has no `PAYROLL_ENCRYPTION_KEY=` line at all, append one instead of running the `sed`:

```bash
echo "PAYROLL_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

Do this **once**. Running it again later replaces the key and makes every stored ID-card number and IBAN unreadable.

**2. Check it:**

```bash
grep -c "^PAYROLL_ENCRYPTION_KEY=" .env                                   # → 1 (exactly one line)
grep "^PAYROLL_ENCRYPTION_KEY=" .env | cut -d= -f2- | base64 -d | wc -c  # → 32
```

**3. Back it up now, away from the server.** Print it once and save it in a password manager (an entry such as "Canvas production: payroll key"):

```bash
grep "^PAYROLL_ENCRYPTION_KEY=" .env
```

The nightly database backup ([step 6](#6-nightly-backup-and-a-restore-test)) holds payroll values only in encrypted form, so restoring it is useless for payroll without this key. Never put the key in git, chat or email.

**Moving to a new server or restoring a backup:** don't generate a new key. Put the **same** value in the new `.env`: paste it from the password manager with `nano .env`, or copy the line from the old server over SSH:

```bash
sed -i "/^PAYROLL_ENCRYPTION_KEY=/d" ~/canvas-app/.env   # drop the empty line from .env.example
ssh ubuntu@<old-server-ip> 'grep "^PAYROLL_ENCRYPTION_KEY=" ~/canvas-app/.env' >> ~/canvas-app/.env
```

**If the key is ever lost:** salaries, bank names and account holders are unaffected, because they aren't encrypted. The ID-card numbers and IBANs show as "[unreadable]", and HR has to re-enter them after a new key is set.

Locally (`pnpm dev`) none of this is needed: leave `PAYROLL_ENCRYPTION_KEY` empty and a public dev key is used.

### 4.5 Build, check, migrate, start

```bash
cd ~/canvas-app
pnpm install --frozen-lockfile
pnpm build                 # apps/api/dist + apps/web/dist
pnpm preflight             # checks everything below; must end with "Ready"
pnpm db:migrate            # creates the tables in canvas-prod
pnpm preflight             # now "Migrations 64/64 applied" (or however many there are)
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                # prints a sudo command — copy-paste and run it, so PM2 starts on reboot
```

`pnpm preflight` checks the production rules for every `.env` value, Node, the build output, the database (reachable, pgvector, migrations), that `pg_dump` is new enough for backups, Redis (with its password), R2 (writes, reads and deletes a probe object, and that the bucket's CORS rule lets the browser upload from `WEB_URL`), SMTP login and, once started, `/health`. It never prints a secret. Fix every ✗ before going on; ! lines are warnings, such as no SMTP or no AI keys.

✅ Check: `pm2 status` shows `canvas-api` and `canvas-worker` **online**, and `curl -s http://127.0.0.1:3001/health` prints `{"ok":true,"checks":{"api":"ok","database":"ok","redis":"ok","storage":"ok"}}`.

## 5. Domain and HTTPS

1. Where your domain's DNS is managed (e.g. Cloudflare → your domain → **DNS → Records**), add:
   - Type **A**, name **`canvas`**, IPv4 address: the VM's public IP.
   - If the DNS is on Cloudflare: **Proxy status: DNS only** (grey cloud). Caddy needs to answer the certificate challenge itself.
2. Wait until it resolves (usually minutes): on your PC, `nslookup canvas.your-domain.com` shows the VM's IP.
3. On the server:
   ```bash
   sudo cp ~/canvas-app/deploy/Caddyfile /etc/caddy/Caddyfile
   sudo sed -i "s/canvas.example.com/canvas.your-domain.com/" /etc/caddy/Caddyfile
   sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Caddy fetches a Let's Encrypt certificate on its own and renews it. WebSockets (live updates) pass through without extra config.

✅ Check: `https://canvas.your-domain.com/health` in your browser shows all four checks `ok`, with a padlock.

## 6. Nightly backup, and a restore test

`scripts/backup-db.sh` dumps the `public` and `drizzle` schemas with `pg_dump`, gzips the dump and uploads it to the R2 bucket as `backups/YYYY-MM-DD.dump.gz` (Kosovo date). It keeps the newest 14.

1. Run it once by hand:
   ```bash
   ~/canvas-app/scripts/backup-db.sh
   ```
   It prints `backup: uploaded backups/<today>.dump.gz (… bytes)`.
2. Schedule it for **02:00 Kosovo time** (the server's clock is Europe/Belgrade after `setup-server.sh`):
   ```bash
   crontab -e         # choose nano if asked
   ```
   Add this line, save and exit:
   ```
   0 2 * * * /home/ubuntu/canvas-app/scripts/backup-db.sh >> /home/ubuntu/canvas-backup.log 2>&1
   ```
   `crontab -l` shows it. The next morning, `tail ~/canvas-backup.log` shows the night's upload.
3. **Prove the backup restores**, into **canvas-dev** (never production). This wipes canvas-dev's `public` and `drizzle` schemas and replaces them with the backup. Supabase's own schemas are left alone.
   ```bash
   ~/canvas-app/scripts/restore-db.sh --target "<canvas-dev Session pooler URI>" --yes
   ```
   It downloads the newest backup from the bucket in `.env`, restores it and prints row counts (users, workspaces, tasks, leave, payroll, migrations). Compare them with production. It refuses to run if `--target` is the production `DATABASE_URL`. `--date YYYY-MM-DD` restores an older backup.

Restoring production itself (after a disaster), into a new empty Supabase project: point `--target` at the new project, then switch `DATABASE_URL` to it and `pm2 reload ecosystem.config.cjs`. Payroll needs the same `PAYROLL_ENCRYPTION_KEY` (4.4).

## 7. Verify everything

1. `pnpm preflight` on the server ends with **Ready**.
2. `https://canvas.your-domain.com/health` → `{"ok":true,…}` with `api`, `database`, `redis`, `storage` all `ok`.
3. **Automated smoke test**, from your PC in the repo (it drives a real browser against the live site):

   ```powershell
   $env:SMOKE_BASE_URL="https://canvas.your-domain.com"; pnpm --filter @canvas/e2e test:smoke
   ```

   It runs through:
   - health, then signing up an owner, creating a workspace and inviting someone;
   - adding a staff member;
   - the staff member submits a daily report, uploads a proof photo (straight to R2) and submits the task;
   - the owner approves the task;
   - the staff member requests a week of leave and the owner approves it;
   - the owner saves an encrypted payroll record and exports payroll to Excel, and the staff member gets 403 on the export.

   It must say `1 passed`.

4. Remove the smoke test's data: Supabase → **SQL Editor** → run
   ```sql
   delete from workspaces where name like 'Smoke test %';
   delete from users where email like 'smoke-%@example.com';
   ```
   (A small proof photo stays in R2; harmless.)
5. By hand: sign up your real account. Create the company workspace and invite HR. As HR, add a few staff with Directory → Add staff. Open Holidays and add this year's movable holidays.

## 8. Updating the app

When new code is pushed to `main`:

```bash
cd ~/canvas-app
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm preflight
pm2 reload all
```

`pm2 reload` restarts the two processes one at a time. Then check `https://canvas.your-domain.com/health`. If a reload fails, `pm2 logs --lines 50` shows why.

Updating a server that ran a version from before payroll (M7.7)? Add the key first ([4.4](#44-payroll-encryption-key)), otherwise the reloaded processes refuse to start.

Never edit an already-applied migration (CLAUDE.md).

## Troubleshooting

| Symptom                                                  | Likely cause / fix                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pm2 status` shows `errored` / restarting                | `pm2 logs canvas-api --lines 50`. `Refusing to start in production …` names the `.env` value to fix. Then run `pnpm preflight`           |
| Browser can't reach the site, `curl` on the server works | Port 80/443 not open: Oracle security list (3.3) **and** VM firewall (`sudo iptables -L INPUT -n`; re-run `deploy/setup-server.sh`)      |
| Caddy: "certificate" errors                              | DNS doesn't point at the VM yet, or Cloudflare proxy (orange cloud) is on. `sudo journalctl -u caddy -n 50`                              |
| Uploads fail in the browser                              | R2 CORS rule missing / wrong domain. `pnpm preflight` reports it as **R2 CORS**                                                          |
| `/health` shows `database: error`                        | Supabase project paused (free tier, 7 days idle): unpause in the dashboard. Or the Transaction pooler URL (6543) is in use               |
| Emails never arrive                                      | `SMTP_*` not set (preflight warns), or the provider rejects `EMAIL_FROM`                                                                 |
| Backup log: `server version mismatch`                    | `pg_dump` older than Supabase's Postgres: re-run `deploy/setup-server.sh`, or set `PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump` in `.env` |

## Scaling note

Run exactly **one** `canvas-api` process. Board realtime goes through Redis pub/sub, but the collaborative doc editor (`lib/doc-collab.ts`) keeps each document's Yjs room in memory, so two API processes would split editors of the same doc between them.
