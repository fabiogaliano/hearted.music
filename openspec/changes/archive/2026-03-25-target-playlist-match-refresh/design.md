## Context

The current suggestion-refresh flow is split across multiple owners. `src/lib/workflows/enrichment-pipeline/trigger.ts` decides whether to queue `checkAndRematch`, `src/lib/workflows/playlist-sync/trigger-lightweight-enrichment.ts` queues a separate `playlist_lightweight_enrichment` job, `src/worker/execute.ts` calls `requestRematch()` inline after lightweight enrichment, and `src/lib/workflows/enrichment-pipeline/stages/matching.ts` also writes `match_context` and `match_result` from chunk execution.

That split breaks the desired snapshot invariant: the latest `match_context` should always represent the full current published suggestion set. Today a partial enrichment chunk can become the latest context, playlist-side changes can trigger duplicate refreshes, and removal-only cases rely on behavior spread across unrelated modules. The implementation plan in `claudedocs/target-playlist-match-refresh-implementation-plan.md` already defines the desired ownership model and naming.

The change touches job orchestration, sync planning, onboarding follow-on work, database naming, and snapshot publication. It needs a design because it crosses `src/lib/workflows/enrichment-pipeline/*`, `src/lib/workflows/playlist-sync/*`, `src/lib/workflows/spotify-sync/playlist-sync.ts`, `src/routes/api/extension/sync.tsx`, `src/lib/server/onboarding.functions.ts`, `src/lib/data/jobs.ts`, `src/lib/domains/library/accounts/preferences-queries.ts`, and `src/worker/*`.

## Goals / Non-Goals

**Goals:**
- Make `target_playlist_match_refresh` the only workflow allowed to publish `match_context` and `match_result`.
- Publish full snapshots atomically, including explicit empty snapshots when no target playlists remain.
- Keep liked-song enrichment chunked and candidate-side only, with refresh requested after drain rather than per chunk.
- Coalesce concurrent refresh requests through one active job plus `rerunRequested` state in `job.progress`.
- Rename destination/rematch terminology in code and database to target-playlist terminology.

**Non-Goals:**
- Change the underlying scoring model, reranking behavior, or playlist profiling heuristics.
- Fold candidate-side liked-song enrichment into the target-playlist refresh workflow.
- Redesign onboarding UI, sync transport, or extension authentication.
- Store exhaustive per-playlist historical scores to avoid recomputing snapshots after target-set removals.

## Decisions

### Decision: Add one target-playlist refresh workflow as the profile-side owner

Create `src/lib/workflows/target-playlist-match-refresh/` with `trigger.ts`, `orchestrator.ts`, `planner.ts`, `profiles.ts`, `types.ts`, and `write-match-snapshot.ts`. `trigger.ts` owns idempotent job creation and coalescing, `planner.ts` converts sync/settings facts into `TargetPlaylistRefreshPlan`, `orchestrator.ts` executes refresh branches, `profiles.ts` reuses playlist profiling cache rules, and `write-match-snapshot.ts` becomes the only publish entry point.

This replaces the split between `checkAndRematch`, `triggerLightweightEnrichment`, and `requestRematch`. The alternative was to keep separate rematch and lightweight job types and add more gating, but that would preserve duplicate ownership and partial-snapshot risks.

### Decision: Snapshot publication becomes atomic and refresh-owned

Extract shared read/build helpers from `src/lib/workflows/enrichment-pipeline/stages/matching.ts` and `src/lib/workflows/enrichment-pipeline/rematch.ts`, but move the final write behind `writeMatchSnapshot`. That wrapper should call one transactional database function or RPC that writes `match_context` and `match_result` together, or writes an explicit empty snapshot when the current target set is empty.

The refresh workflow will compute the full current candidate set from current data-enriched liked songs and the full current target playlist set before publishing. Enrichment code may reuse read/build helpers, but it must not call the final publish helper. The alternative was to let chunk execution keep writing match contexts and rely on dedupe, but that leaves `getLatestMatchContext()` vulnerable to partial-state publication.

### Decision: Keep liked-song enrichment focused on candidate readiness

`src/lib/workflows/enrichment-pipeline/orchestrator.ts` stays responsible for chunk selection, shared enrichment stages, and `markPipelineProcessed`, but stops owning snapshot publication. `src/lib/workflows/enrichment-pipeline/stages/matching.ts` should be reduced to shared readiness or input-building helpers, and any `match_context`, `match_result`, and `is_new` writes move out of the chunk flow.

When the final chunk completes with `hasMoreSongs = false`, the pipeline requests `requestTargetPlaylistMatchRefresh({ source: "enrichment_drain" })`. The alternative was to fold matching back into every chunk and publish progressively, but that conflicts with the full-snapshot invariant.

### Decision: Use one coalesced refresh job type with persisted plan hints

Add `target_playlist_match_refresh` job helpers in `src/lib/data/jobs.ts`, rename the account pointer helpers in `src/lib/domains/library/accounts/preferences-queries.ts`, and store `TargetPlaylistRefreshPlan` plus `rerunRequested` in `job.progress`. `src/worker/poll.ts` should claim enrichment jobs first, then target-playlist refresh jobs. `src/worker/execute.ts` should execute a dedicated `executeTargetPlaylistMatchRefreshJob()` path and rerun once when `rerunRequested` was set mid-flight.

The alternative was to keep separate `rematch` and `playlist_lightweight_enrichment` jobs. That keeps mental overhead high, duplicates claim/sweep plumbing, and still requires inline chaining inside the worker.

### Decision: Sync and onboarding classify change sources before queuing follow-on work

`src/routes/api/extension/sync.tsx` and `src/lib/workflows/spotify-sync/playlist-sync.ts` should separate liked-song-side changes from target-playlist-side changes before follow-on jobs are requested. That means capturing target-playlist removals before rows are deleted, surfacing whether changed playlist tracks intersect the current target set, and only queueing `requestEnrichment()` or `requestTargetPlaylistMatchRefresh()` when their owning side actually changed.

`src/lib/server/onboarding.functions.ts` should save `is_target`, queue `requestTargetPlaylistMatchRefresh()`, and only queue `requestEnrichment()` when liked-song candidate-side work is still needed. The alternative was to infer everything from the latest snapshot hash after sync, but that misses removal semantics and first-target-selection behavior.

### Decision: Initial no-target syncs do not need drain-triggered refresh

The implementation plan's snapshot invariant requires an explicit empty snapshot when a previously published target set becomes empty, but it does not require brand-new accounts with zero selected target playlists to create an initial empty snapshot just because enrichment drained. For accounts that have never selected target playlists, enrichment drain may stop after candidate-side processing without queuing `target_playlist_match_refresh`.

The first refresh becomes required when target playlists are first selected, when target-playlist-side changes occur, or when a previously non-empty target set must be cleared to an explicit empty snapshot. The alternative was to enqueue refresh after every enrichment drain regardless of target state, but that adds unnecessary empty-snapshot churn during initial onboarding while no published target-driven suggestion state exists yet.

### Decision: Ship schema renames and workflow cutover together

The database rename from `playlist.is_destination` to `playlist.is_target` and from `user_preferences.rematch_job_id` to `user_preferences.target_playlist_match_refresh_job_id` should ship in the same release as the code cutover. The migration also adds `target_playlist_match_refresh` job support, unique active-job enforcement, and claim/sweep/dead-letter helpers while retiring old enum values without deleting them.

The alternative was a compatibility layer that supports both destination/rematch names for multiple releases. For this single-developer app that adds more code noise than safety, while still requiring one coordinated cutover for generated types and SQL helpers.

## Risks / Trade-offs

- [Breaking database rename] -> Ship migrations and app code together, regenerate types immediately, and avoid mixed-version deploys.
- [Refresh may run before enrichment drain finishes] -> Allow the early refresh, but require enrichment drain to request one more refresh so newly enriched candidates become visible.
- [Extra refresh work during bursts of change] -> Reuse one active refresh job and collapse concurrent triggers into one follow-up pass via `rerunRequested`.
- [Atomic publish adds SQL complexity] -> Implement the publish RPC first, keep the TypeScript wrapper thin, and cover failure/no-op/empty-snapshot cases with tests.
- [Planner can make incorrect assumptions from partial sync data] -> Treat `TargetPlaylistRefreshPlan` as a hint only and re-read current target playlists and candidates during execution.

## Migration Plan

1. Add the atomic snapshot publish database function, rename columns to target-playlist terminology, add the new job enum/RPC helpers, and retire old enum values.
2. Scaffold `src/lib/workflows/target-playlist-match-refresh/` and extract shared read/build/profile helpers.
3. Rename and refactor `src/lib/workflows/playlist-sync/lightweight-enrichment.ts` into refresh-owned target-playlist-song enrichment, including the `deleted_at` -> `unliked_at` fix.
4. Remove snapshot publication from the enrichment pipeline and request refresh only after queue drain.
5. Switch `src/routes/api/extension/sync.tsx`, `src/lib/workflows/spotify-sync/playlist-sync.ts`, `src/lib/server/onboarding.functions.ts`, `src/worker/execute.ts`, and `src/worker/poll.ts` to the new job type and ownership model.
6. Delete obsolete rematch/lightweight helpers after tests confirm the single-publisher flow.
7. Rollback strategy: before the rename migration lands, a code rollback is straightforward; after the rename lands, rollback requires a compatibility migration, so the schema rename and code cutover should be treated as one release window.

## Non-Blocking Follow-Ups

- Sync responses may continue using the persisted account-level refresh job pointer; exposing `targetPlaylistMatchRefreshJobId` directly is optional and not required for this change.
- The `re-matching` spec only needs to stay in the change long enough to archive the removal cleanly; no extra compatibility artifact is required before implementation.
