#!/usr/bin/env bash
# One-shot prod → self-host data migration. Runs ON THE VPS (it needs Docker +
# network reach to the internal `supabase-db` container, neither of which exists
# off-box). Fully self-contained: SQL is embedded, target creds are read from the
# container's own env, so the only input is PROD_DATABASE_URL.
#
#   PROD_DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres' \
#     CONFIRM=yes bash run-on-vps.sh
#
# Or remotely, piped over SSH (env passed through the ssh command):
#   ssh root@57.129.63.224 "PROD_DATABASE_URL='…' CONFIRM=yes bash -s" < run-on-vps.sh
#
# Idempotent enough to re-run: the restore uses --clean --if-exists, so a second
# run rebuilds public from a fresh dump. Target is the just-created self-host, so
# there is no pre-existing app data to lose.

set -euo pipefail

: "${PROD_DATABASE_URL:?Set PROD_DATABASE_URL (prod session-pooler DSN, port 5432)}"
DUMP_PATH="/tmp/hearted-prod-public.dump"

# Docker may need sudo (it does on the OVH host). Prefer plain docker, fall back
# to passwordless sudo.
if docker ps >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo -n docker"; fi

# Locate the self-host Postgres container by Coolify service id.
DB_CONTAINER="$($DOCKER ps --format '{{.Names}}' | grep -E 'supabase-db.*fcuhypd724cwmn4dhx74qqja' | head -n1 || true)"
[ -n "$DB_CONTAINER" ] || { echo "✗ supabase-db container not found (is the stack running?)"; exit 1; }
echo "▶ target container: $DB_CONTAINER"

dx() { $DOCKER exec -e PROD_DATABASE_URL="$PROD_DATABASE_URL" -i "$DB_CONTAINER" bash -lc "$1"; }

echo "▶ [1/5] bootstrap extensions on target"
dx 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
create schema if not exists extensions;
create extension if not exists vector  schema extensions;
create extension if not exists pg_trgm schema extensions;
alter database postgres set search_path to "$user", public, extensions;
SQL

echo "▶ [2/5] pg_dump prod public schema (custom format)"
# </dev/null on the non-heredoc dx calls: this script is often run as
# `ssh host bash -s < run-on-vps.sh`, so the script lives on stdin — without
# tying off stdin here, `docker exec -i` would swallow the rest of the script.
dx "pg_dump \"\$PROD_DATABASE_URL\" --schema=public --no-owner --format=custom --file=$DUMP_PATH" </dev/null
dx "ls -lh $DUMP_PATH" </dev/null

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "⚠ Dry run complete (dump created, NOT restored). Re-run with CONFIRM=yes to restore."
  exit 0
fi

echo "▶ [3/5] pg_restore into target public schema"
dx "pg_restore --no-owner --clean --if-exists --jobs=2 \
      -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" $DUMP_PATH" </dev/null \
  || echo "  (pg_restore reported non-fatal warnings — review above)"

echo "▶ [4/5] recreate sync-payloads storage bucket"
dx 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit)
values ('sync-payloads', 'sync-payloads', false, 52428800)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;
SQL

echo "▶ [5/5] validate"
dx 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select 'match_result' as t, count(*) from match_result
union all select 'song', count(*) from song
union all select '"user"', count(*) from "user"
union all select 'account', count(*) from account order by t;
select extname, extnamespace::regnamespace as schema from pg_extension where extname in ('vector','pg_trgm');
select pg_size_pretty(pg_database_size(current_database())) as db_size;
SQL

echo "✓ migration data load complete. Next: cut over app env (see gen-jwt.ts output)."
