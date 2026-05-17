## 1. Database Migration

- [x] 1.1 Create a new forward Supabase migration named like `supabase/migrations/<timestamp>_normalize_database_vocabulary.sql`.
- [x] 1.2 Rename `api_token` to `extension_api_token` with `ALTER TABLE ... RENAME TO ...`.
- [x] 1.3 Rename `item_status` to `account_item_newness` with `ALTER TABLE ... RENAME TO ...`.
- [x] 1.4 Rename `job_failure` to `job_item_failure` with `ALTER TABLE ... RENAME TO ...`.
- [x] 1.5 Rename dependent indexes, triggers, and constraints where practical to use `extension_api_token`, `account_item_newness`, and `job_item_failure` prefixes.
- [x] 1.6 Replace `resolve_stage_failures(...)` with `resolve_job_item_stage_failures(...)`.
- [x] 1.7 Replace `count_unresolved_failures(...)` with `count_unresolved_job_item_failures(...)`.
- [x] 1.8 Recreate SQL functions whose bodies reference renamed tables/RPCs, including liked-songs page/stats functions, enrichment selector functions, and any matching/newness helper functions.
- [x] 1.9 Do not leave old table views, old RPC wrappers, or final compatibility aliases unless a deployment constraint is documented and a removal task is added.

## 2. Regenerate Database Types

- [x] 2.1 Apply the migration locally.
- [x] 2.2 Run `bun run gen:types` to regenerate `src/lib/data/database.types.ts`.
- [x] 2.3 Verify generated types include `extension_api_token`, `account_item_newness`, and `job_item_failure`.
- [x] 2.4 Verify generated types no longer expose `api_token`, `item_status`, `job_failure`, `resolve_stage_failures`, or `count_unresolved_failures`.

## 3. Update Extension Token Code

- [x] 3.1 Update the extension API token module to read/write `extension_api_token`.
- [x] 3.2 Update all extension route imports/tests/mocks that validate, create, or revoke extension bearer tokens.
- [x] 3.3 Grep `src` for `api_token` and verify no production code references the old table name.

## 4. Update Account Item Newness Code

- [x] 4.1 Update `src/lib/domains/library/liked-songs/status-queries.ts` to read/write `account_item_newness`.
- [x] 4.2 Update matching status derivation, dashboard stats, liked-songs page/stats callers, and tests that refer to `item_status` semantics.
- [x] 4.3 Update SQL/RPC callers and mocks affected by the renamed table.
- [x] 4.4 Grep `src` for `item_status` and verify no production code references the old table name.

## 5. Update Job Item Failure Code

- [x] 5.1 Update the job item failure persistence module to read/write `job_item_failure`.
- [x] 5.2 Update enrichment stage accounting to call `resolve_job_item_stage_failures` and `count_unresolved_job_item_failures`.
- [x] 5.3 Update selector/RPC tests and mocks that previously referenced `job_failure`, `resolve_stage_failures`, or `count_unresolved_failures`.
- [x] 5.4 Grep `src` for `job_failure`, `resolve_stage_failures`, and `count_unresolved_failures`; verify no production code references the old names.

## 6. Update Specs and Docs

- [x] 6.1 Update active OpenSpec references to use `extension_api_token`, `account_item_newness`, and `job_item_failure`.
- [x] 6.2 Update any repo docs that mention the old active names.
- [x] 6.3 If historical migration docs retain old names for history, label them clearly as historical.

## 7. Verification

- [x] 7.1 Run `rg "job_failure|item_status|api_token|resolve_stage_failures|count_unresolved_failures" src openspec/specs docs` and verify no active production/spec references remain to old names.
- [x] 7.2 Run focused tests: `bun run test src/lib/workflows/enrichment-pipeline src/lib/workflows/library-processing src/lib/domains/library/liked-songs src/lib/server src/routes/api/extension`.
- [x] 7.3 Run `bun run typecheck`.
- [x] 7.4 Run `openspec validate normalize-database-vocabulary --strict --no-interactive`.
- [x] 7.5 Document any pre-existing unrelated test/typecheck failures with exact suite or file names before marking validation tasks complete.

### Pre-existing diagnostics surfaced during this change (unrelated to the rename)

- `src/lib/workflows/library-processing/__tests__/song-batch-analysis.test.ts:285` — `Cannot find module '@/lib/data/jobs'` (predates this change; module reorganized in earlier commit).
- `src/lib/workflows/library-processing/service.ts:109` — `LibraryProcessingApplyError` not assignable to `LibraryProcessingApplyCause` (missing `message` on `{ kind: "load_state"; cause: DbError }`); pre-existing type-narrowing issue in the apply-outcome union.
- `src/lib/server/matching.functions.ts:410-411` — `rank` / `factors` not on `MatchResult` (these come from the upstream query result type; mismatch predates the rename).
- `src/lib/integrations/scripts/seed-landing-songs.ts:33` — unused import `getApiKeyForProvider`.
- `src/features/onboarding/PickDemoSongStep.tsx:7,238` — `lucide-react` `ArrowRight` deprecation warning.
