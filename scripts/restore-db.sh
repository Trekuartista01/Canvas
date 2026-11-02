#!/usr/bin/env bash
# Restore test: pull a nightly backup from R2 and restore it into canvas-dev
# (never production). See DEPLOYMENT.md "Nightly backup" and
# apps/api/scripts/restore-db.mjs. Example:
#   scripts/restore-db.sh --target "<canvas-dev Session pooler URI>" --yes
set -euo pipefail
cd "$(dirname "$0")/.."
exec node apps/api/scripts/restore-db.mjs "$@"
