## 1. Schema foundation

- [x] 1.1 Create a Supabase CLI migration (`supabase migration new create_library_processing_state`) for `library_processing_state` with flattened workflow columns, `created_at` / `updated_at`, and `activeJobId` foreign keys to `job(id)` with `ON DELETE SET NULL`.
- [x] 1.2 Create a Supabase CLI migration (`supabase migration new add_library_processing_job_metadata`) that adds `job.satisfies_requested_at`, numeric `queue_priority`, durable `match_snapshot_refresh` job naming/helpers, and a mixed-workflow DB claim path that claims either `enrichment` or `match_snapshot_refresh` by `queue_priority DESC, created_at ASC` in `supabase/migrations/*.sql`.
- [x] 1.3 Create a Supabase CLI migration (`supabase migration new add_library_processing_selectors`) for `select_liked_song_ids_needing_pipeline_processing(p_account_id uuid, p_limit integer)` and `select_data_enriched_liked_song_ids(p_account_id uuid)`, with terminal-failure filtering folded into the full-pipeline selector only.
- [x] 1.4 Regenerate `src/lib/data/database.types.ts` and update typed DB surfaces in `src/lib/data/jobs.ts`, `src/lib/data/job-failures.ts`, and `src/lib/platform/jobs/progress/types.ts` for the new columns, job type, and RPCs.

## 2. Library-processing domain

- [x] 2.1 Create `src/lib/workflows/library-processing/types.ts` and `src/lib/workflows/library-processing/changes/{onboarding,sync,enrichment,match-snapshot}.ts` for `LibraryProcessingState`, `LibraryProcessingChange`, and typed change constructors.
- [x] 2.2 Create `src/lib/workflows/library-processing/queries.ts` for loading, lazily creating, and persisting `library_processing_state` rows.
- [x] 2.3 Create `src/lib/workflows/library-processing/reconciler.ts` for freshness rules, request-marker settlement, active-job transitions, and `LibraryProcessingEffects` generation.
- [x] 2.4 Create `src/lib/workflows/library-processing/queue-priority.ts` for free/credits/supporter -> low/standard/priority resolution behind a thin entitlement boundary, defaulting accounts without entitlement data to the free/baseline `low` band without leaking pricing copy into the pure reconciler.
- [x] 2.5 Create `src/lib/workflows/library-processing/service.ts` with `applyLibraryProcessingChange(...)` to load state, stamp request markers, reconcile, persist, and execute effects.

## 3. Lower-level ensure/create job helpers

- [x] 3.1 Refactor `src/lib/data/jobs.ts` to add lower-level ensure/create helpers for `enrichment` jobs that accept `satisfies_requested_at` and `queue_priority` metadata needed by library-processing.
- [x] 3.2 Refactor `src/lib/data/jobs.ts` and `src/lib/workflows/match-snapshot-refresh/types.ts` for lower-level `match_snapshot_refresh` ensure/create helpers using the new durable naming instead of `target_playlist_match_refresh` orchestration.
- [x] 3.3 Add the ensure-time `needsTargetSongEnrichment` derivation path in `src/lib/data/jobs.ts` and `src/lib/workflows/match-snapshot-refresh/*` so refresh execution hints come from current DB state rather than persisted rerun plans.
- [x] 3.4 Wire `src/lib/workflows/library-processing/service.ts` effect execution to the new ensure/create helpers and persist workflow `activeJobId` refs in `library_processing_state`.

## 4. Worker cutover

- [x] 4.1 Replace the app-side exclusion-list logic in `src/lib/workflows/enrichment-pipeline/batch.ts` with `select_liked_song_ids_needing_pipeline_processing(...)` for chunk selection and `hasMoreSongs` probing.
- [x] 4.2 Switch `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` to `select_data_enriched_liked_song_ids(...)` and the ensure-time `needsTargetSongEnrichment` hint.
- [x] 4.3 Update `src/lib/workflows/enrichment-pipeline/orchestrator.ts` and `src/worker/execute.ts` to produce explicit enrichment outcomes (`requestSatisfied`, `newCandidatesAvailable`, `local_limit`, `error`) and settle them through `applyLibraryProcessingChange(...)`.
- [x] 4.4 Update `src/worker/poll.ts`, `src/worker/execute.ts`, and the queue-claim helpers in `src/lib/data/jobs.ts` to replace the current enrichment-first two-step poll path with single-pass `match_snapshot_refresh` execution and one DB-enforced mixed-workflow claim path ordered by `queue_priority DESC, created_at ASC`.
- [x] 4.5 Remove worker-owned follow-on orchestration from `src/worker/chain.ts` and the refresh-after-drain path in `src/lib/workflows/enrichment-pipeline/trigger.ts` so workers no longer decide whether another job should exist.

## 5. Source cutover

- [x] 5.1 Update `src/lib/server/onboarding.functions.ts` to emit `OnboardingChanges.targetSelectionConfirmed(...)` into `applyLibraryProcessingChange(...)` and remove direct `requestEnrichment(...)` / `requestTargetPlaylistMatchRefresh(...)` calls.
- [x] 5.2 Update `src/routes/api/extension/sync.tsx` to compute one aggregated `SyncChanges.librarySynced(...)` payload per request and call `applyLibraryProcessingChange(...)` exactly once after persistence completes.
- [x] 5.3 Keep sync-side classification exact by updating `src/lib/workflows/spotify-sync/playlist-sync.ts` and the related helper paths touched by `src/routes/api/extension/sync.tsx` so `likedSongs` and `targetPlaylists` booleans stay source-shaped and required, including `profileTextChanged` vs image/song-count-only updates and target-removal facts captured before deletes.
- [x] 5.4 Update loader-facing read models and server functions such as `src/lib/server/jobs.functions.ts` to resolve active jobs and derived `firstMatchReady` from library-processing-backed state instead of `user_preferences` orchestration pointers.

## 6. Cleanup and cutover verification

- [x] 6.1 Remove obsolete policy-shaped orchestration helpers and rerun plumbing in `src/lib/workflows/enrichment-pipeline/trigger.ts`, `src/lib/workflows/match-snapshot-refresh/trigger.ts`, `src/lib/workflows/match-snapshot-refresh/planner.ts`, and `src/worker/chain.ts` once all callers use library-processing.
- [x] 6.2 Create a Supabase CLI cleanup migration (`supabase migration new remove_legacy_library_processing_pointers`) to drop old `user_preferences` orchestration pointer fields plus obsolete `target_playlist_match_refresh`, `rematch`, and `playlist_lightweight_enrichment` helper functions/indexes that the hard cut no longer uses, leaving old enum values inert only if PostgreSQL makes deletion risky.
- [x] 6.3 Remove old pointer reads/writes from `src/lib/domains/library/accounts/preferences-queries.ts`, `src/lib/data/jobs.ts`, and any remaining callers so `library_processing_state` is the only orchestration source of truth.
- [x] 6.4 Add or update behavioral tests in `src/lib/workflows/library-processing/__tests__/`, `src/lib/workflows/enrichment-pipeline/__tests__/`, `src/lib/workflows/match-snapshot-refresh/__tests__/`, and any affected onboarding/sync test files for request-marker settlement, sync aggregation, single-pass refresh, target-selection cutover, and DB-side selector semantics.

## 7. Measurement second pass

- [x] 7.1 Create a Supabase CLI migration (`supabase migration new add_library_processing_execution_measurements`) for durable per-attempt execution measurement storage in `job_execution_measurement` with no automatic pruning in v1.
- [x] 7.2 Add measurement data access and write paths in the worker/job plumbing touched by `src/lib/data/jobs.ts`, `src/worker/poll.ts`, and `src/worker/execute.ts` so each claimed `enrichment` and `match_snapshot_refresh` attempt records one row.
- [x] 7.3 Populate enrichment measurement details from `src/lib/workflows/enrichment-pipeline/orchestrator.ts` and related progress types with per-stage `readyCount`, `doneCount`, `succeededCount`, and `failedCount` summaries.
- [x] 7.4 Populate `match_snapshot_refresh` measurement details from `src/lib/workflows/match-snapshot-refresh/orchestrator.ts` with `published` and `isEmpty` outcomes.
- [x] 7.5 Extend the new/updated test coverage for measurement persistence and run `bun run test` to verify the full hard-cut refactor, including the DB-side selector fix, library-processing settlement, and measurement writes.
