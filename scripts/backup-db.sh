#!/usr/bin/env bash
# Nightly database backup to the R2 bucket (backups/YYYY-MM-DD.dump.gz,
# newest 14 kept). Reads DATABASE_URL and S3_* from the repo-root .env.
# Install as a cron job on the prod VM (see DEPLOYMENT.md), e.g.:
#   30 2 * * * /home/ubuntu/canvas-app/scripts/backup-db.sh >> /home/ubuntu/canvas-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
exec node apps/api/scripts/backup-db.mjs
