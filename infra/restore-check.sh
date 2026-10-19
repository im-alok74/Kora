#!/usr/bin/env bash
# Proves a backup can be restored: loads it into a scratch database and compares row counts with the source.
# A backup that was never restored is a hope, not a backup. Run this on a schedule, and after changing how backups are made.
#
#   RESTORE_FILE          the backup file (.dump, or .dump.enc with BACKUP_PASSPHRASE)
#   RESTORE_ADMIN_URL     a URL to a server where a scratch database may be created and dropped (a role with CREATEDB)
#   SOURCE_DATABASE_URL   optional. The live database; its counts must match the restored copy. Only meaningful right after a backup.
#   PG_PREFIX             as for backup.sh
set -euo pipefail
: "${RESTORE_FILE:?RESTORE_FILE is not set}"
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL is not set}"
prefix="${PG_PREFIX:-}"
scratch="kora_restore_check_$$"
admin_base="${RESTORE_ADMIN_URL%/*}"
src="$RESTORE_FILE"
tmp=""
if [[ "$src" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is needed to read an encrypted backup}"
  tmp="$(mktemp)"; openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$src" -out "$tmp"; src="$tmp"
fi
cleanup() { [ -n "$tmp" ] && rm -f "$tmp"; $prefix psql "$RESTORE_ADMIN_URL" -qc "drop database if exists $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

$prefix psql "$RESTORE_ADMIN_URL" -qc "create database $scratch"
# shellcheck disable=SC2086
$prefix pg_restore --no-owner --no-privileges --dbname="$admin_base/$scratch" < "$src"

tables="business document document_line payment payment_allocation party item audit_log"
count() { $prefix psql "$1" -Atqc "select count(*) from $2"; }
status=0
for t in $tables; do
  restored="$(count "$admin_base/$scratch" "$t")"
  line="restore-check: $t restored=$restored"
  if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
    live="$(count "$SOURCE_DATABASE_URL" "$t")"
    line="$line live=$live"
    [ "$restored" = "$live" ] || { line="$line MISMATCH"; status=1; }
  fi
  echo "$line"
done
[ "$status" = 0 ] && echo "restore-check: ok" || echo "restore-check: FAILED" >&2
exit $status
