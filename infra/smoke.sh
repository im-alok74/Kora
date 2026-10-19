#!/usr/bin/env bash
# Loads replica/schema.sql into a scratch database as superuser and runs the SQL smoke test.
# Needs the compose Postgres (pnpm db:up). Prints SMOKE OK or fails.
set -euo pipefail
export MSYS_NO_PATHCONV=1
C=$(docker compose ps -q db)
docker cp replica/schema.sql "$C":/schema.sql
docker cp replica/schema-smoke.sql "$C":/smoke.sql
docker exec "$C" psql -U postgres -q -c "drop database if exists smoke" -c "create database smoke"
docker exec "$C" psql -U postgres -d smoke -v ON_ERROR_STOP=1 -q -f /schema.sql
docker exec "$C" psql -U postgres -d smoke -v ON_ERROR_STOP=1 -q -f /smoke.sql | grep -E "SMOKE OK"
docker exec "$C" psql -U postgres -q -c "drop database smoke"
