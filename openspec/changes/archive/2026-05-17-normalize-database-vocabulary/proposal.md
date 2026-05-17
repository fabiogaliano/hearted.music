## Why

The app is still pre-production, so this is the right time to fix database vocabulary that has drifted from the current domain model. A few table/RPC names are now actively misleading:

- `job_failure` stores per-item failures within a job, not failure of the job row itself.
- `item_status` no longer stores broad item status or user actions; action columns were removed and matching decisions now live in `match_decision`. The table is account-scoped item newness/view state.
- `api_token` is used only for Chrome extension bearer authentication, not as a general public API token system.

Leaving these names in the database would keep leaking old mental models into generated Supabase types, SQL functions, query modules, and future work.

## What Changes

- Rename `job_failure` to `job_item_failure`.
- Rename job item failure RPCs:
  - `resolve_stage_failures` -> `resolve_job_item_stage_failures`;
  - `count_unresolved_failures` -> `count_unresolved_job_item_failures`.
- Rename `item_status` to `account_item_newness`.
- Rename `api_token` to `extension_api_token`.
- Rename related indexes, constraints, triggers, and generated TypeScript references where practical so operational names match the new vocabulary.
- Update SQL functions that reference the renamed tables/RPCs.
- Regenerate `src/lib/data/database.types.ts` after the schema migration.
- Update app code, tests, mocks, and OpenSpec references to use the new DB names.

## Capabilities

### Modified Capabilities

- `background-enrichment-worker`: per-song failure rows are stored in `job_item_failure`.
- `extension-data-pipeline`: extension bearer tokens are persisted in `extension_api_token`.
- `newness`: account-scoped item newness is persisted in `account_item_newness`.
- `matching-pipeline`, `match-decisions`, and `data-flow`: matching/newness references use `account_item_newness` instead of `item_status`.
- `migration-v2`: schema naming requirements reflect the final pre-prod vocabulary.

## Affected specs

- `openspec/specs/background-enrichment-worker/spec.md`
- `openspec/specs/extension-data-pipeline/spec.md`
- `openspec/specs/newness/spec.md`
- `openspec/specs/matching-pipeline/spec.md`
- `openspec/specs/match-decisions/spec.md`
- `openspec/specs/data-flow/spec.md`
- `openspec/specs/migration-v2/spec.md`

## Impact

- **Runtime behavior:** No intended behavior change. This is schema vocabulary alignment plus code/reference updates.
- **Data/schema:** Yes. Adds a forward Supabase migration that renames pre-prod tables/RPCs and dependent database objects.
- **Generated types:** `src/lib/data/database.types.ts` must be regenerated after applying the migration.
- **Files likely touched:**
  - `supabase/migrations/*_normalize_database_vocabulary.sql`
  - `src/lib/data/database.types.ts`
  - DB access modules that read/write extension tokens, job item failures, and account item newness
  - SQL RPC callers under enrichment, matching, dashboard/newness, extension routes, and tests
  - OpenSpec files and architecture docs that mention old DB names
- **Non-goals:**
  - Renaming clear tables such as `job`, `job_execution_measurement`, `match_snapshot`, `match_result`, `match_decision`, or `library_processing_state`.
  - Reworking database behavior, constraints, or RLS policy semantics beyond names.
  - Rewriting historical migrations. Use a forward migration unless the team explicitly decides to squash/reset migrations separately.
