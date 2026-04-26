# Runbook: Drop legacy `analysis_inputs_unconfirmed_*` rows from `job_failure`

**Status:** preprod-only manual operation
**Script:** `scripts/sql/preprod/20260426190000_drop_legacy_analysis_unconfirmed_codes.sql`
**Audience:** developers cleaning a preprod database after the failure-lifecycle change set

## Why this is not a migration

The script is destructive (`DELETE FROM job_failure ...`). Keeping it in `supabase/migrations` would expose production to accidental execution by `supabase migration up` or any CI/CD migrate chain. Putting it under `scripts/sql/preprod/` makes it impossible to apply by mistake — it requires a deliberate manual invocation against an explicit connection.

## When to run

Run **only** if all of the following are true:

1. The target database is a **preprod / local / scratch** environment. Never production.
2. The lifecycle change set (`20260426180000_job_failure_lifecycle.sql`) has already been applied. The selector is failure_code-agnostic so the rows are already harmless — this script is purely cosmetic / analytics-hygiene.
3. You want analytics buckets / dashboards grouped by `failure_code` to stop carrying forward the three dead categories (`analysis_inputs_unconfirmed_lyrics`, `_audio`, `_both`).

Skip the script otherwise — leaving the rows in place has no behavioral impact.

## How to run

### Local Supabase

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -f scripts/sql/preprod/20260426190000_drop_legacy_analysis_unconfirmed_codes.sql
```

### Remote preprod

Use the Supabase Studio SQL editor against the preprod project, or:

```bash
psql "$PREPROD_DATABASE_URL" \
  -f scripts/sql/preprod/20260426190000_drop_legacy_analysis_unconfirmed_codes.sql
```

Confirm the connection string points to preprod before running.

## Verification

After running, expect zero rows for the three legacy codes:

```sql
SELECT failure_code, COUNT(*)
FROM job_failure
WHERE failure_code IN (
  'analysis_inputs_unconfirmed_lyrics',
  'analysis_inputs_unconfirmed_audio',
  'analysis_inputs_unconfirmed_both'
)
GROUP BY failure_code;
-- expected: 0 rows
```

If new rows ever reappear with these codes, a code path is still writing the old constants and the policy module / stage handlers need to be re-checked.

## Reversibility

None — this is a hard delete. Recover from a backup if needed; no recovery is possible from the script alone.
