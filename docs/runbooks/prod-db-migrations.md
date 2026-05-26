# Prod Supabase Migrations

## Purpose

Production schema changes are applied by GitHub Actions before app and worker deploys.
The workflow only auto-runs for commits to `main` that change `supabase/migrations/**`.

## Workflow Summary

File: `.github/workflows/main.yml`

Order:

1. `verify`
2. `db-security`
3. `migrate-prod`
4. `deploy-app` / `deploy-worker`

Rules:

- `migrate-prod` runs only on `push` to `main`
- it runs only when `supabase/migrations/**` changed
- if it fails, both deploy jobs stay blocked
- schema-only changes still migrate even when app and worker deploys are skipped
- the job runs `supabase db push --linked --yes`
- no seed data, no `--include-all`, no role sync

## GitHub Environment Setup

Create a dedicated GitHub Actions environment named `production-db`.
No reviewer gate is required for this repo's current mostly-solo workflow.

Add:

- secret: `SUPABASE_ACCESS_TOKEN`
- secret: `SUPABASE_DB_PASSWORD`
- variable: `SUPABASE_PROJECT_REF`

The workflow fails fast with a clear error if any of these are missing.

## Preflight Prerequisites

Before relying on auto-migrate, do two one-time checks: confirm migration history is in sync,
and confirm Supabase Point-in-Time Recovery is enabled for prod.

### Migration History Baseline Check

Before the first real CI-driven prod migration, confirm local migration files and the remote
`supabase_migrations.schema_migrations` history table agree.

Run:

```bash
supabase migration list --linked
```

Healthy result:

- local and remote migration versions line up
- there are no unexpected missing or already-applied entries

If they do not match, reconcile that manually before enabling auto-migrate. Otherwise the first
`supabase db push` can fail on already-existing objects or skip migrations that prod still needs.

### PITR Prerequisite

Confirm Supabase Point-in-Time Recovery is enabled for prod.
Record the answer outside the workflow before the first real migration lands.

Minimum checklist:

- PITR enabled in Supabase project settings
- at least one person with restore access verified
- restore target project/process documented
- rough expectations written down for:
  - RPO: how much data loss is acceptable
  - RTO: how long restore can take

This repo cannot verify PITR from CI; the owner must confirm it in the Supabase dashboard.

## Safe for Auto-Apply

These are appropriate for the `migrate-prod` job:

- create table
- add nullable column
- add column with a safe default
- add index when lock/runtime risk is low
- add function or RPC
- add RLS policy
- add backward-compatible constraint in a safe staged way

Use expand-contract when app code also changes:

1. expand schema without breaking old code
2. deploy code that can handle both shapes
3. backfill if needed
4. contract old shape later

## Manual-Only Changes

Do not merge these expecting the auto job to be the only safeguard:

- dropping columns or tables
- column renames without a compatibility phase
- type changes that rewrite large tables
- long-running data backfills
- lock-heavy DDL
- anything needing `CREATE INDEX CONCURRENTLY`
- anything that needs a maintenance window or operator observation

For those cases, run a supervised manual `supabase db push --linked` with PITR confirmed and a rollback/forward-fix plan ready.

## Rollback Policy

Default rollback is a forward fix, not a down migration.

If a bad migration reaches prod:

1. stop further deploys
2. assess whether the issue is app-only or schema/data
3. prefer a follow-up additive fix migration
4. use Supabase restore/PITR only for true recovery scenarios

## Local Developer Workflow

For local work:

```bash
bunx supabase db push
bun run gen:types
```

Local success does not make a migration safe for auto-apply in prod. Review production lock/runtime risk separately.
