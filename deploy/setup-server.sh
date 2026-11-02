#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for Canvas (DEPLOYMENT.md
# step 4). Run from the cloned repo as the normal `ubuntu` user:
#
#   bash deploy/setup-server.sh
#
# Safe to run again: every step checks before it changes anything.
# Installs: timezone Europe/Belgrade, Node 22 LTS + pnpm (corepack) + PM2,
# Redis (localhost only, with a password), Caddy, postgresql-client-17
# (pg_dump for the nightly backup), and opens ports 80/443 in the VM firewall.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
have_systemd() { [ -d /run/systemd/system ]; }
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# sudo when needed (keeping the environment, e.g. DEBIAN_FRONTEND); plain when already root.
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -E "$@"; fi; }
export DEBIAN_FRONTEND=noninteractive

say "Base packages"
as_root apt-get update -qq
as_root apt-get install -y -qq ca-certificates curl gnupg git openssl tzdata debian-keyring debian-archive-keyring apt-transport-https >/dev/null

say "Timezone → Europe/Belgrade (the nightly backup cron runs at 02:00 Kosovo time)"
if have_systemd; then
  as_root timedatectl set-timezone Europe/Belgrade
else
  as_root ln -sf /usr/share/zoneinfo/Europe/Belgrade /etc/localtime
  echo "Europe/Belgrade" | as_root tee /etc/timezone >/dev/null
fi
date

say "Node.js 22 LTS"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | as_root bash - >/dev/null
  as_root apt-get install -y -qq nodejs >/dev/null
fi
node --version

say "pnpm (the version pinned in package.json, via corepack) and PM2"
as_root corepack enable
(cd "$REPO" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --version)
command -v pm2 >/dev/null || as_root npm install -g pm2@7 >/dev/null 2>&1
pm2 --version

say "Redis (127.0.0.1 only, password, no eviction, append-only)"
as_root apt-get install -y -qq redis-server >/dev/null
REDIS_CONF=/etc/redis/redis.conf
if ! as_root grep -q "Canvas production Redis settings" "$REDIS_CONF"; then
  REDIS_PASSWORD="$(openssl rand -hex 24)"
  sed "s/CHANGE_ME_TO_A_LONG_RANDOM_HEX_STRING/${REDIS_PASSWORD}/" "$REPO/deploy/redis-canvas.conf" \
    | as_root tee -a "$REDIS_CONF" >/dev/null
  echo "redis://:${REDIS_PASSWORD}@127.0.0.1:6379" > "$HOME/.canvas-redis-url"
  chmod 600 "$HOME/.canvas-redis-url"
  echo "Generated a Redis password. Put this line in .env (it's also saved in ~/.canvas-redis-url):"
  echo "  REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:6379"
else
  echo "Already configured. REDIS_URL is in ~/.canvas-redis-url"
fi
if have_systemd; then
  as_root systemctl enable --now redis-server >/dev/null
  as_root systemctl restart redis-server
fi

say "Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | as_root gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | as_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  as_root apt-get update -qq
  as_root apt-get install -y -qq caddy >/dev/null
fi
caddy version

say "PostgreSQL 17 client (pg_dump/pg_restore for backups)"
if ! command -v pg_dump >/dev/null || [ "$(pg_dump --version | grep -oE '[0-9]+' | head -1)" -lt 17 ]; then
  as_root apt-get install -y -qq postgresql-common >/dev/null
  as_root /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  as_root apt-get install -y -qq postgresql-client-17 >/dev/null
fi
pg_dump --version

say "Firewall: open 80/443 (Oracle's Ubuntu image only allows SSH by default)"
if as_root iptables -L INPUT -n >/dev/null 2>&1; then
  for port in 80 443; do
    if ! as_root iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
      # Insert before Oracle's final REJECT rule.
      as_root iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    fi
  done
  as_root apt-get install -y -qq iptables-persistent >/dev/null || true
  command -v netfilter-persistent >/dev/null && as_root netfilter-persistent save >/dev/null
  as_root iptables -L INPUT -n --line-numbers | grep -E "dpt:(80|443)" || true
else
  echo "Couldn't read iptables here (not a VM?) — skipped."
fi

say "Done"
cat <<EOF
Next (DEPLOYMENT.md step 4):
  cd $REPO
  cp .env.example .env && nano .env        # use the checklist in DEPLOYMENT.md
  pnpm install --frozen-lockfile && pnpm build
  pnpm preflight                            # must say "Ready"
  pnpm db:migrate
  pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
EOF
