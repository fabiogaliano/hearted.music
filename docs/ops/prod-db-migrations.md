# Prod DB Migrations

Production schema changes are applied by GitHub Actions before app and worker deploys.
The workflow only auto-runs for commits to `main` that change `supabase/migrations/**`.

## CI Workflow

File: `.github/workflows/main.yml`

Order: `verify` → `db-security` → `migrate-prod` → `deploy-app` / `deploy-worker`

- `migrate-prod` runs only on `push` to `main`, only when `supabase/migrations/**` changed
- if it fails, both deploy jobs stay blocked
- schema-only changes still migrate even when app/worker deploys are skipped
- runs `supabase db push --linked --yes` — no seed data, no `--include-all`, no role sync

## GitHub Environment Setup

Create a GitHub Actions environment named `production-db`. No reviewer gate required.

Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`  
Variable: `SUPABASE_PROJECT_REF`

## Preflight (one-time)

**Migration history baseline:** before the first CI-driven prod migration, confirm local files and remote `supabase_migrations.schema_migrations` agree:

```bash
supabase migration list --linked
```

If they don't match, reconcile manually before enabling auto-migrate.

**Restore coverage:** confirm the backup strategy in `docs/ops/prod-db-backups.md` is in place and at least one person has verified restore access.

## Safe for Auto-Apply

- create table
- add nullable column or column with safe default
- add index (when lock/runtime risk is low)
- add function, RPC, RLS policy
- add backward-compatible constraint (staged)

Use expand-contract when app code also changes: expand → deploy code handling both shapes → backfill → contract.

## Manual-Only Changes

Do not rely on the auto job as the only safeguard for:

- dropping columns or tables
- column renames without a compatibility phase
- type changes that rewrite large tables
- long-running data backfills
- lock-heavy DDL or `CREATE INDEX CONCURRENTLY`
- anything needing a maintenance window

For these: run a supervised `supabase db push --linked` with restore strategy confirmed and a rollback plan ready.

## Rollback Policy

Default is a forward fix, not a down migration.

1. Stop further deploys
2. Assess whether the issue is app-only or schema/data
3. Prefer a follow-up additive fix migration
4. Use the documented restore path (PITR or logical backup) only for true recovery scenarios

## Local Workflow

```bash
bunx supabase db push
bun run gen:types
```

Local success does not make a migration safe for auto-apply. Review production lock/runtime risk separately.
