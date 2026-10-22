#!/bin/bash
# Runs the night-2 e2e specs under the shared lock. Usage: bash run-night2.sh <log> [spec files...]
LOG=$1; shift
SPECS=${@:-tests/night2-money.spec.ts}
until mkdir /c/Users/aloks/kora-e2e.lock 2>/dev/null; do sleep 30; done
trap 'rmdir /c/Users/aloks/kora-e2e.lock' EXIT
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3200,3201,3202 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }"
cd "$(dirname "$0")/.."
MIGRATE_DATABASE_URL=postgres://kora_owner:kora_owner_dev@localhost:54329/kora_e2e pnpm migrate > "$LOG" 2>&1
cd e2e
pnpm exec tsx scripts/prepare-db.ts >> "$LOG" 2>&1
pnpm exec playwright test $SPECS >> "$LOG" 2>&1
echo "exit $?" >> "$LOG"
