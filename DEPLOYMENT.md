# DEPLOYMENT.md — production on an Oracle Always Free VM (€0)

Production setup (Phase 7, see ARCHITECTURE.md):

- **App server:** one Oracle Cloud _Always Free_ VM running Ubuntu. On it:
  - PM2 runs two processes from `ecosystem.config.cjs`:
    - `canvas-api`: the API plus the built web app, served from one origin.
    - `canvas-worker`: the BullMQ jobs.
  - Caddy terminates HTTPS in front of the API.
  - Redis is installed locally with apt.
- **Database:** a Supabase project `canvas-prod` (free tier, pgvector).
- **Files and backups:** a Cloudflare R2 bucket `canvas-prod`.

No Docker anywhere. For a dev machine, see `docs/LOCAL_SETUP.md` instead.

## 1. Provision accounts (once)

1. **Supabase**: create project `canvas-prod` (Frankfurt region, Free plan) and save the DB password. Under **Connect → Session pooler**, copy the URI (port **5432**, never the 6543 Transaction pooler).
   - Optional: Project Settings → Database → SSL Configuration → download the CA certificate for `SUPABASE_CA_CERT`.
   - Free projects pause after 7 days with no activity. A live app's traffic, plus the nightly backup, keeps it awake.
2. **Cloudflare R2**: create bucket `canvas-prod`.
   - Bucket → Settings → CORS Policy:
     ```json
     [
       {
         "AllowedOrigins": ["https://your-domain"],
         "AllowedMethods": ["GET", "PUT"],
         "AllowedHeaders": ["content-type"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
   - Manage API tokens → Create API token → _Object Read & Write_, scoped to `canvas-prod`.
   - The app never creates R2 buckets or edits their CORS; both are dashboard-only.
3. **Domain**: an `A` record pointing `your-domain` at the VM's public IP (from step 2).

## 2. Create the VM

Oracle Cloud console → Compute → Instances → Create instance:

- **Image:** Canonical Ubuntu 24.04. **Shape:** Ampere `VM.Standard.A1.Flex` (Always Free, e.g. 2 OCPU / 12 GB). Upload your SSH public key.
- **Networking:** in the VCN's security list, add ingress rules for TCP **80** and **443** from `0.0.0.0/0`. Don't open 3001: the API is only reached through Caddy.
- Oracle's Ubuntu image also ships its own iptables rules, so open the ports on the VM too:
  ```bash
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save
  ```

## 3. Install the runtime

```bash
# Node 22 + pnpm + PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm install -g pnpm@11 pm2

# Redis (stays on 127.0.0.1 — env.ts allows that in production)
sudo apt install -y redis-server
sudo systemctl enable --now redis-server

# pg_dump matching Supabase's Postgres major version (for backups)
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-client-17

# Caddy (automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`sharp` and `@node-rs/argon2` ship arm64 builds, so the Ampere VM needs no extra build tools.

## 4. Configure and start the app

```bash
git clone <repo-url> ~/canvas-app && cd ~/canvas-app
cp .env.example .env && nano .env
```

Set at least the following (each is explained in `.env.example`):

| Variable                                                | Production value                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | `canvas-prod` Session pooler URI                                                 |
| `SUPABASE_CA_CERT`                                      | optional; path to the downloaded CA, e.g. `/home/ubuntu/canvas-app/prod-ca.crt`  |
| `REDIS_URL`                                             | `redis://127.0.0.1:6379`                                                         |
| `S3_ENDPOINT`                                           | `https://<account-id>.r2.cloudflarestorage.com`                                  |
| `S3_REGION` / `S3_FORCE_PATH_STYLE`                     | `auto` / `false`                                                                 |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `canvas-prod` and its token                                                      |
| `WEB_URL`                                               | `https://your-domain` (the one public origin)                                    |
| `GOOGLE_REDIRECT_URI`                                   | `https://your-domain/auth/google/callback`                                       |
| `PAYROLL_ENCRYPTION_KEY`                                | a new random key, generated on the server — see [4a](#4a-payroll-encryption-key) |

Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (AI is mocked when they're unset), `GOOGLE_CLIENT_ID`/`_SECRET`, SMTP vars, `SENTRY_DSN`. `VITE_SENTRY_DSN` is baked into the web bundle at build time, so it must be in `.env` before `pnpm build`.

`NODE_ENV=production` and `DB_POOL_MAX` come from `ecosystem.config.cjs`, so you don't need them in `.env`. In production, the API refuses to boot if `.env` still has localhost or dev values for the database, web URL or storage, or no real `PAYROLL_ENCRYPTION_KEY`.

Set `PAYROLL_ENCRYPTION_KEY` with the steps in [4a](#4a-payroll-encryption-key) **before the first start** — the API and the worker both refuse to boot without it. Then:

```bash
pnpm install --frozen-lockfile
pnpm build            # apps/api/dist + apps/web/dist
pnpm db:migrate       # against canvas-prod
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup           # run the command it prints, so PM2 restarts on reboot
```

## 4a. Payroll encryption key

Payroll ID-card numbers and IBANs are stored encrypted (AES-256-GCM). The key lives only in `.env` on the server, as `PAYROLL_ENCRYPTION_KEY`: 32 random bytes, base64-encoded. **Generate it once, on the server, and never change it afterwards.** Anything encrypted with one key can't be read with another.

**1. Generate it and write it into `.env`.** In `~/canvas-app`, after `cp .env.example .env`:

```bash
cd ~/canvas-app
# Fills the empty PAYROLL_ENCRYPTION_KEY= line (copied from .env.example) with a new random key.
sed -i "s|^PAYROLL_ENCRYPTION_KEY=.*|PAYROLL_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
chmod 600 .env   # only your user can read .env
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

The nightly database backup ([section 6](#6-nightly-database-backup)) holds payroll values only in encrypted form, so restoring it is useless for payroll without this key. Never put the key in git, chat or email.

**4. Start or reload.** On a first install, carry on with the `pnpm install … pm2 start` steps in section 4. On a server that was already running before payroll existed (M7.7), reload once the key is in `.env`. Both processes read `.env` when they start:

```bash
pm2 reload ecosystem.config.cjs
pm2 logs canvas-api --lines 20 --nostream   # no "Refusing to start … PAYROLL_ENCRYPTION_KEY"
curl https://your-domain/health
```

If the key is missing, too short or still the built-in dev key, the log shows `Refusing to start in production … PAYROLL_ENCRYPTION_KEY` and PM2 keeps restarting the process until it's fixed.

**Moving to a new server or restoring a backup:** don't generate a new key. Put the **same** value in the new `.env`: paste it from the password manager with `nano .env`, or copy the line from the old server over SSH:

```bash
sed -i "/^PAYROLL_ENCRYPTION_KEY=/d" ~/canvas-app/.env   # drop the empty line from .env.example
ssh ubuntu@<old-server-ip> 'grep "^PAYROLL_ENCRYPTION_KEY=" ~/canvas-app/.env' >> ~/canvas-app/.env
```

**If the key is ever lost:** salaries, bank names and account holders are unaffected, because they aren't encrypted. The ID-card numbers and IBANs show as "[unreadable]", and HR has to re-enter them after a new key is set.

Locally (`pnpm dev`) none of this is needed: leave `PAYROLL_ENCRYPTION_KEY` empty and a public dev key is used.

## 5. Caddy (HTTPS)

`/etc/caddy/Caddyfile`:

```
your-domain {
	reverse_proxy 127.0.0.1:3001
}
```

```bash
sudo systemctl reload caddy
```

Caddy gets and renews the TLS certificate by itself and proxies WebSockets without extra config.

## 6. Nightly database backup

`scripts/backup-db.sh` dumps `public` and `drizzle` with `pg_dump --format=custom`, gzips the dump, and uploads it to the R2 bucket as `backups/YYYY-MM-DD.dump.gz` (Kosovo date). It keeps the newest 14 backups. Install it with `crontab -e`:

```
30 2 * * * /home/ubuntu/canvas-app/scripts/backup-db.sh >> /home/ubuntu/canvas-backup.log 2>&1
```

Set `PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump` in `.env` if several Postgres client versions are installed.

The backup contains payroll ID-card numbers and IBANs only in encrypted form. Restoring them needs the same `PAYROLL_ENCRYPTION_KEY`.

**Restore** into an empty database:

```bash
gunzip -c 2026-01-31.dump.gz > db.dump
psql "$DATABASE_URL" -c "create extension if not exists vector"
pg_restore --no-owner -d "$DATABASE_URL" db.dump   # "schema public already exists" is expected
```

## 7. Deploying an update

```bash
cd ~/canvas-app && git pull
pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate
pm2 reload ecosystem.config.cjs
```

Updating a server that ran a version from before payroll (M7.7)? Add the key first ([section 4a](#4a-payroll-encryption-key)), otherwise the reloaded processes refuse to start.

Never edit an already-applied migration (CLAUDE.md).

## 8. Verify

- `curl https://your-domain/health` → `{"ok":true,"checks":{"api":"ok","database":"ok","redis":"ok"}}`.
- `pm2 status` shows `canvas-api` and `canvas-worker` online. Check `pm2 logs` for any `storage: bucket … isn't reachable` warning.
- Sign up → create a workspace → upload an attachment. The upload goes directly to R2, so this also exercises the CORS rule.
- Phase-2 smoke test (generate → edit ×3 → attach), if image provider keys are set.

## Scaling note

Run exactly **one** `canvas-api` process. Board realtime goes through Redis pub/sub, but the collaborative doc editor (`lib/doc-collab.ts`) keeps each document's Yjs room in memory. Two API processes would split editors of the same doc between them.
