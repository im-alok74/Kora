#!/usr/bin/env bash
# Takes one backup of the Kora database: a pg_dump in custom format, optionally encrypted and copied to object storage.
#
#   BACKUP_DATABASE_URL   required. A role that can read everything (the owner role), through a direct or session-mode connection.
#   BACKUP_DIR            where files go. Default ./backups
#   BACKUP_KEEP_DAYS      delete local backups older than this. Default 14. 0 keeps everything.
#   BACKUP_PASSPHRASE     if set, the file is encrypted with AES-256 (openssl). Keep the passphrase somewhere other than the backup.
#   BACKUP_S3_URI         if set (s3://bucket/path), the file is copied there with the aws cli.
#   BACKUP_S3_ENDPOINT    for S3-compatible storage such as Cloudflare R2 or Backblaze B2.
#   PG_PREFIX             a command placed before pg_dump, for example "docker exec -i kora-db-1". Leave empty if pg_dump is installed.
#
# Prints the path of the file it wrote. Exits non-zero on any failure, including a dump that cannot be read back.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_KEEP_DAYS:-14}"
prefix="${PG_PREFIX:-}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dir/kora-$stamp.dump"

# A dump of everything the application owns. --no-owner and --no-privileges keep it restorable into a different set of roles.
# shellcheck disable=SC2086
$prefix pg_dump --format=custom --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" > "$file.partial"

# It must be a real archive that lists tables, or it is not a backup.
# shellcheck disable=SC2086
if ! $prefix pg_restore --list < "$file.partial" | grep -q "TABLE DATA"; then
  rm -f "$file.partial"; echo "backup: the dump has no table data" >&2; exit 1
fi
mv "$file.partial" "$file"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$file" -out "$file.enc"
  rm -f "$file"; file="$file.enc"
fi

if [ -n "${BACKUP_S3_URI:-}" ]; then
  endpoint=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  aws "${endpoint[@]}" s3 cp "$file" "${BACKUP_S3_URI%/}/$(basename "$file")" --only-show-errors
fi

if [ "$keep" != "0" ]; then
  find "$dir" -maxdepth 1 -name 'kora-*.dump*' -type f -mtime +"$keep" -delete
fi
echo "$file"
