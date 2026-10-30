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

| Variable                                                | Production value                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | `canvas-prod` Session pooler URI                                                |
| `SUPABASE_CA_CERT`                                      | optional; path to the downloaded CA, e.g. `/home/ubuntu/canvas-app/prod-ca.crt` |
| `REDIS_URL`                                             | `redis://127.0.0.1:6379`                                                        |
| `S3_ENDPOINT`                                           | `https://<account-id>.r2.cloudflarestorage.com`                                 |
| `S3_REGION` / `S3_FORCE_PATH_STYLE`                     | `auto` / `false`                                                                |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `canvas-prod` and its token                                                     |
| `WEB_URL`                                               | `https://your-domain` (the one public origin)                                   |
| `GOOGLE_REDIRECT_URI`                                   | `https://your-domain/auth/google/callback`                                      |
| `PAYROLL_ENCRYPTION_KEY`                                | output of `openssl rand -base64 32` — see the warning below                     |

Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (AI is mocked when they're unset), `GOOGLE_CLIENT_ID`/`_SECRET`, SMTP vars, `SENTRY_DSN`. `VITE_SENTRY_DSN` is baked into the web bundle at build time, so it must be in `.env` before `pnpm build`.

`NODE_ENV=production` and `DB_POOL_MAX` come from `ecosystem.config.cjs`, so you don't need them in `.env`. In production, the API refuses to boot if `.env` still has localhost or dev values for the database, web URL or storage, or no real `PAYROLL_ENCRYPTION_KEY`.

> **Keep a copy of `PAYROLL_ENCRYPTION_KEY` somewhere safe, apart from the server** (a password manager). Payroll ID-card numbers and IBANs are stored encrypted with it; the nightly database backup is useless for payroll without it, and a lost key can't be recovered. Never change it on a running system: values encrypted with the old key would become unreadable.

```bash
pnpm install --frozen-lockfile
pnpm build            # apps/api/dist + apps/web/dist
pnpm db:migrate       # against canvas-prod
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup           # run the command it prints, so PM2 restarts on reboot
```

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

Never edit an already-applied migration (CLAUDE.md).

## 8. Verify

- `curl https://your-domain/health` → `{"ok":true,"checks":{"api":"ok","database":"ok","redis":"ok"}}`.
- `pm2 status` shows `canvas-api` and `canvas-worker` online. Check `pm2 logs` for any `storage: bucket … isn't reachable` warning.
- Sign up → create a workspace → upload an attachment. The upload goes directly to R2, so this also exercises the CORS rule.
- Phase-2 smoke test (generate → edit ×3 → attach), if image provider keys are set.

## Scaling note

Run exactly **one** `canvas-api` process. Board realtime goes through Redis pub/sub, but the collaborative doc editor (`lib/doc-collab.ts`) keeps each document's Yjs room in memory. Two API processes would split editors of the same doc between them.
