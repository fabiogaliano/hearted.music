# Prod DB Migrations

Production schema changes are applied by GitHub Actions before app and worker deploys.
The workflow reconciles migration state after every successful push to `main`.

## CI Workflow

File: `.github/workflows/main.yml`

Order: `verify` → `db-security` → `migrate-prod` → `deploy-app` / `deploy-worker`

- `migrate-prod` runs on every successful `push` to `main`; `db push` is idempotent and reconciles remote migration state
- if it fails, both deploy jobs stay blocked
- schema-only changes still migrate even when app/worker deploys are skipped
- joins the production tailnet with a GitHub OIDC identity, then runs `supabase db push --db-url … --yes` against the VPS Tailscale address
- before applying, refuses pending migrations with destructive statements (see [Destructive Migration Gate](#destructive-migration-gate))
- no seed data, no `--include-all`, and no role sync

## GitHub Environment Setup

Create a GitHub Actions environment named `production-db`. No reviewer gate required.

Secret: `PROD_DATABASE_URL` (canonical URL using `supabase.hearted.music`; CI replaces only the host with the VPS Tailscale address)  
Variables: `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`

The Tailscale trust credential must:

- trust GitHub's OIDC issuer
- match subject `repo:fabiogaliano/hearted.music:environment:production-db`
- have writable `auth_keys` scope for `tag:ci`

The tailnet policy must declare `tag:ci`. The workflow receives `id-token: write` only in the `migrate-prod` job.

## Preflight (one-time)

**Migration history baseline:** before the first CI-driven prod migration, confirm local files and remote `supabase_migrations.schema_migrations` agree:

```bash
supabase migration list --db-url "$PROD_DATABASE_URL"
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

For these: run a supervised `supabase db push --db-url "$PROD_DATABASE_URL"` with restore strategy confirmed and a rollback plan ready.

## Destructive Migration Gate

`migrate-prod` enforces the list above for what it can recognise statically. Before `db push`, it runs `supabase db push --dry-run`, then `scripts/db/scan-destructive-migrations.ts` on the migrations the dry run lists. It refuses to apply if any of them contain:

- `DROP TABLE`, `DROP SCHEMA`, or `ALTER TABLE … DROP [COLUMN]`
- `ALTER TABLE … RENAME` (table or column) or `SET SCHEMA`
- `ALTER COLUMN … [SET DATA] TYPE`
- `TRUNCATE`, or `DELETE` without `WHERE`
- `CREATE INDEX CONCURRENTLY` or `DROP INDEX CONCURRENTLY`
- `DROP FUNCTION` or `DROP VIEW` with no `CREATE` of the same name later in the file
- any `DROP … CASCADE`

The scanner ignores comments, string literals, and function bodies. It does not flag plain `DROP INDEX`, `DROP TYPE` without `CASCADE` (it fails and rolls back while anything still uses the type), `DROP POLICY`/`DROP TRIGGER`, or `UPDATE` backfills. Runtime depends on row counts the file doesn't show, so review long backfills yourself. Dynamic SQL inside `DO` blocks is invisible to it.

A refusal fails `migrate-prod`, which blocks both deploys. It shows one error annotation per statement plus a summary.

PRs get the same scan as warnings in `verify`, on migration files the PR adds or changes. A destructive migration shows up in review before it blocks a deploy.

### Applying a refused migration

1. Confirm the restore path (`docs/ops/prod-db-backups.md`) and have a rollback plan.
2. Preview, then apply:

   ```bash
   supabase db push --dry-run --db-url "$PROD_DATABASE_URL"
   supabase db push --db-url "$PROD_DATABASE_URL"
   ```

   This applies every pending migration, including safe ones queued behind the refused one.
3. Re-run the failed jobs of the newest `main` run (an older run would deploy an older commit). `migrate-prod` reads the pending list from remote history, not from the commit's diff. The migration you applied is now recorded there, so nothing is pending, the gate passes, and the blocked deploys go out.

Until the migration is applied, every push to `main` fails `migrate-prod` the same way. That is intended: later safe migrations and deploys queue behind it instead of skipping it.

### Allowing a statement that is safe in context

If a flagged statement is safe here (for example, dropping a table nothing has read since an earlier deploy), annotate it on its own line or on the line directly above:

```sql
DROP TABLE legacy_thing; -- migration-safety: allow no reader since <commit>
```

The reason is required: an annotation without one still blocks. The annotation is a reviewable claim in the diff. `migrate-prod` logs every allowed statement as a notice, and the PR preview shows it too.

The gate also fails closed if `db push --dry-run` errors, if its output isn't recognised, or if a listed file is missing. If the CLI output changes after a version bump, update `parsePendingMigrations` in the scanner.

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
