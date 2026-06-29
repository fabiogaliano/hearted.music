# Supabase (hosted) → self-host Supabase migration

Moves the production database off hosted Supabase (free-tier DB quota exceeded —
1.7 GB, dominated by `match_result`) onto the self-hosted Supabase stack running
on the Coolify VPS (`supabase-fcuhypd724cwmn4dhx74qqja`).

**Strategy A:** keep the Supabase API surface (PostgREST + Storage) so the 58
`createAdminSupabaseClient()` query files and the `sync-payloads` storage calls
work unchanged. Only env vars change at cutover.

## What moves

- `public` schema: all app tables **and** the `better-auth` tables (drizzle puts
  them in `public`). This is the whole working set — `match_result` (~2.85M rows)
  and friends.
- `extensions`: NOT dumped. Recreated fresh on the target (`vector`, `pg_trgm`)
  by `01-bootstrap-extensions.sql` before restore, because the `public` tables
  depend on the `extensions.vector` type.
- `storage.buckets`: the single private `sync-payloads` bucket, recreated by
  `05-storage-bucket.sql` (its objects are transient/reproducible — none moved).
- Supabase-managed schemas (`auth`, `storage` internals, `realtime`, …) are NOT
  moved — the self-host stack provisions its own.

## Prerequisites

- `pg_dump` / `pg_restore` **v17** locally (Supabase is PG17). Verify:
  `pg_dump --version`. If older, run these scripts from the VPS instead (the
  worker image ships `postgresql-client-17`), or `brew install postgresql@17`.
- Source creds: `SUPABASE_DB_PASSWORD` in `.env` + `supabase/.temp/pooler-url`
  (session pooler, port 5432 — dump-capable), same as `bun run prod:sql`.
- Target creds: the self-host DB connection string, from Coolify service env
  (`coolify service env <uuid> -s`). Export as `TARGET_DATABASE_URL`.

## Order

```bash
# 0. point at the target (self-host supabase-db)
export TARGET_DATABASE_URL='postgresql://postgres:<pw>@<host>:5432/postgres'
# source URL is auto-built from .env + pooler-url, or override with PROD_DATABASE_URL

# 1. prepare target: extensions schema + vector/pg_trgm
psql "$TARGET_DATABASE_URL" -f 01-bootstrap-extensions.sql

# 2. dump prod public schema (custom format) → ./artifacts/prod_public.dump
./02-dump-prod.sh

# 3. restore into target (parallel, no-owner)
./03-restore-target.sh

# 4. validate row counts + indexes match
psql "$PROD_URL"          -f 04-validate.sql   # capture source numbers
psql "$TARGET_DATABASE_URL" -f 04-validate.sql # compare

# 5. recreate the sync-payloads bucket on target
psql "$TARGET_DATABASE_URL" -f 05-storage-bucket.sql
```

## STATUS (2026-06-29)

DONE and verified:
- Self-host upgraded PG15 → **PG17.6** (matches prod). Image tag bumped in
  Coolify's DB, stale data+config volumes wiped, redeployed healthy.
- **Data migrated**: `pg_dump` (custom, --no-owner, privileges kept) of prod
  `public` → restored into self-host. `match_result` = **2,849,422** rows
  (exact prod match); 56 tables; `vector`+`pg_trgm` in `extensions`; HNSW/trgm
  indexes rebuilt; `sync-payloads` bucket created.
- **API proven**: internal Kong `/rest/v1/song` → 200 with real rows;
  `match_result` count 2,849,422 via PostgREST, using the real service key.

The 89 "errors ignored" during restore are benign: `DROP ... IF EXISTS` on the
empty target + a few `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` that
`postgres` can't set for another role (does not affect the explicit table grants
service_role already has).

## Infra prerequisites — DONE (2026-06-29)

- **HTTPS REST/Storage**: `https://supabase.hearted.music` → 200 with the real
  service key, valid Let's Encrypt cert. (Done via the Coolify UI: set the
  supabase-kong domain + Redeploy, after the DNS A record. Editing
  `service_applications.fqdn` in Coolify's DB + `restart` does NOT regenerate
  Traefik's TLS labels — don't do that; it left the stack `exited` once.)
- **Direct Postgres for the edge CF Worker**: the supavisor session pooler is now
  reachable at `supabase.hearted.music:5432` over TLS. supavisor terminates TLS
  itself (`GLOBAL_DOWNSTREAM_CERT_PATH`), so a TLS-terminating proxy can't sit in
  front (Postgres' STARTTLS handshake). Exposure is a `socat` sidecar container
  `pooler-proxy` (`--restart unless-stopped`, on the stack's Docker network,
  `-p 5432:5432`) — fully reversible (`docker rm -f pooler-proxy`).
  - Connect as **`postgres.dev_tenant`** (the `<role>.<tenant>` form supavisor
    requires; bare `postgres` fails auth), `sslmode=require`. Proven from an
    external host with the same `postgres.js` driver the Worker uses.
  - Security posture = TLS + the 32-char `SERVICE_PASSWORD_POSTGRES`, same as
    hosted Supabase's own pooler. CF Worker egress IPs aren't a stable
    allow-list, so this is intentionally internet-reachable, gated by TLS + creds.

## Cutover (operator-owned — coordinated flip of BOTH writers, brief downtime)

There are **two** writers, both still pointed at hosted Supabase:
- **CF Worker** (edge app) — secrets via `wrangler`.
- **VPS Bun worker** — Coolify app `gbaerr9a5f86sdqvhbpng1tc`; it is the main
  drift writer (match runs, jobs, llm_usage, song_*).

Hosted has drifted across **15 tables** since the first restore (worker writes);
notably `match_result_ranking` (0 on self-host). So the cutover does a **full
re-sync** (re-run `run-on-vps.sh CONFIRM=yes`, which `--clean --if-exists`
reloads all of `public` in FK order) rather than a hand-rolled per-table delta.

1. **Pause the writer** so hosted stops changing:
   `coolify app stop gbaerr9a5f86sdqvhbpng1tc`.
2. **Final re-sync** (dump current hosted → clean restore into self-host) — the
   prod DSN is in `.runbook.local.md`:
   `ssh root@57.129.63.224 "PROD_DATABASE_URL='…' CONFIRM=yes bash -s" < run-on-vps.sh`
3. **Verify parity**: re-run the per-table count diff (expect zero drift).
4. **Flip the VPS worker** (Coolify app env → the 4 values from
   `print-cutover-env.ts`), then redeploy/start it.
5. **Flip the CF Worker**: put `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` into `.env.cloud` → `bun run deploy:secrets`;
   `wrangler secret put DATABASE_URL` (the pooler DSN); then `bun run deploy`.
   **Keys are Coolify's generated values** (not derived — Kong's key-auth only
   accepts its registered key strings). `DATABASE_URL` is a standalone secret,
   not in `.env.cloud`; `secret bulk` won't touch it.
6. Smoke-test both writers against self-host. Keep hosted as read-only fallback
   for a few days before deleting.

NOTE: the stale `.target.env` from the first pass contains DERIVED keys that Kong
rejects — ignore it; `print-cutover-env.ts` (and the refreshed `.cutover.env`)
are the source of truth.

## CUTOVER DONE (2026-06-29 ~14:50 UTC)

Both writers run on self-host; zero data loss (the cutover-window check found 0
rows written to hosted after the final dump). End-to-end verified: site 200,
edge auth `/api/auth/get-session` 200, self-host REST 200.

### The one non-obvious gotcha: pooler TLS cert
supavisor self-signs its downstream cert (`CN=supabase-pooler`). The CF Worker
(edge) reaches Postgres through the pooler over TLS, and the **Workers runtime
verifies the cert against public CAs** — it rejects the self-signed one, so
`better-auth` 500'd while everything else (PostgREST over HTTPS) was fine. Node
`postgres.js` with `ssl:"require"` skips verification, which is why local tests
passed and masked it.

Fix: install the Let's Encrypt cert Traefik already manages for the pooler domain
into supavisor (`/etc/ssl/server.crt` + `.key`) and restart it. supavisor
regenerates the self-signed cert on container **recreation** and LE rotates every
~60 days, so `scripts/db/migrate/sync-pooler-cert.sh` (installed at
`/usr/local/sbin/` on the VPS, cron every 6h) re-installs + reloads when they
diverge. **After any redeploy of the Supabase stack, run
`sudo /usr/local/sbin/sync-pooler-cert.sh --force`** (or wait up to 6h for cron)
or edge auth will 500 until the real cert is back.

### Operator follow-ups
1. **`.env.cloud`** — the CF secrets were pushed directly via `wrangler secret
   bulk`, but `.env.cloud` still holds the OLD hosted values. Update its
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` to the
   `print-cutover-env.ts` values, else a future `bun run deploy:secrets` reverts
   the Worker to hosted. (`DATABASE_URL` is a standalone secret, not in the file.)
2. **Decommission hosted Supabase** once satisfied (it's the read-only fallback
   for now) — that's the original goal: stop paying the storage overage.

## Fast alternative (not used)

If `BACKUP_ENABLED=true` in prod, the Bun worker already writes a nightly
custom-format dump to `/backups` in its container — restore that into the target
on the same VPS (no fresh dump, no egress).
