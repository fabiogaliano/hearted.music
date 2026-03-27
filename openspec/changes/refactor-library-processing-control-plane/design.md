## Context

Library-processing follow-on decisions are currently split across multiple boundaries:

- `src/lib/server/onboarding.functions.ts` saves target playlists and directly calls `requestTargetPlaylistMatchRefresh(...)` and `requestEnrichment(...)`
- `src/routes/api/extension/sync.tsx` classifies several follow-on cases inline and directly calls the same trigger helpers
- `src/lib/workflows/enrichment-pipeline/trigger.ts` still encodes refresh-after-drain policy
- `src/worker/poll.ts`, `src/worker/chain.ts`, and `src/worker/execute.ts` still own enrichment chaining and refresh rerun behavior
- `src/lib/workflows/target-playlist-match-refresh/trigger.ts` and `src/lib/data/jobs.ts` still coalesce refresh work through `rerunRequested` in `job.progress`
- `src/lib/domains/library/accounts/preferences-queries.ts` still stores orchestration pointers in `user_preferences`
- `src/lib/workflows/enrichment-pipeline/batch.ts` still loads all processed song IDs into application memory and builds `.not("song_id", "in", ...)` exclusion lists that can exceed PostgREST URL limits

The architecture docs in `docs/library-processing/implementation-plan.md` and `docs/library-processing/state-and-case-mapping.md` already lock the target direction:

- one control plane for follow-on scheduling
- hard cut with no compatibility layer
- both modeled workflows cut over together
- forward-only migrations
- old trigger helpers and old pointer fields removed in the same cut
- measurement as a second pass after control-plane cutover
- DB-side enrichment selectors included in the same change

This change therefore needs a real design document because it crosses data model, queue behavior, worker settlement, sync/onboarding boundaries, and read-model exposure.

## Goals / Non-Goals

**Goals:**
- Introduce `src/lib/workflows/library-processing/` as the single control plane for `enrichment` and `matchSnapshotRefresh` freshness.
- Add `library_processing_state` plus job-level scheduling metadata (`request marker`, `queue_priority`) needed for durable reconciliation.
- Replace direct follow-on trigger policy in onboarding, sync, enrichment chaining, and refresh reruns with `applyLibraryProcessingChange(...)`.
- Convert refresh execution to single-pass `match_snapshot_refresh` jobs.
- Fix `src/lib/workflows/enrichment-pipeline/batch.ts` by moving both full-pipeline and data-enrichment selection to DB-side selectors/RPCs.
- Preserve current semantic distinctions from the docs: source-shaped sync changes, cache-aware early refresh, full-pipeline vs data-enrichment selector behavior, and bounded failure handling.
- Land minimal durable execution measurement immediately after the control-plane cutover in the same change.

**Non-Goals:**
- Move sync phase tracking into `library_processing_state`.
- Rebuild the enrichment execution engine end to end.
- Rebuild target-playlist refresh scoring, profiling, or publication semantics beyond the control-plane cutover.
- Introduce a compatibility layer that supports both old and new orchestration state simultaneously.
- Add billing, credits charging, or monetization enforcement.
- Add new worker-to-UI SSE transport for `firstMatchReady`.

## Decisions

### Decision: Create a cohesive `library-processing` domain and make it the only scheduling control plane

Create a new domain at `src/lib/workflows/library-processing/` with:

- `types.ts`
- `queries.ts`
- `service.ts`
- `reconciler.ts`
- `queue-priority.ts`
- `changes/onboarding.ts`
- `changes/sync.ts`
- `changes/enrichment.ts`
- `changes/match-snapshot.ts`

`service.ts` will expose `applyLibraryProcessingChange(...)`. That service loads or creates `library_processing_state`, stamps the apply-cycle request marker, applies the typed change, runs `reconcileLibraryProcessing(...)`, persists the updated state, and executes any ensure-job effects.

The alternative was to keep extending `requestEnrichment(...)`, `requestRefreshAfterDrain(...)`, and refresh trigger helpers. That would preserve today's split ownership and keep freshness semantics implicit across multiple modules.

### Decision: Use a state-first hard cut with new schema foundations, then remove old orchestration pointers in the same release

The schema foundation will add:

- `library_processing_state`
- `job.satisfies_requested_at TIMESTAMPTZ NULL`
- a nullable numeric `queue_priority` column on `job`
- new durable `match_snapshot_refresh` enum/helper/RPC naming
- DB-side selector RPCs for enrichment and refresh candidate loading

The same cut will remove old orchestration source-of-truth fields and helpers:

- `user_preferences.enrichment_job_id`
- `user_preferences.target_playlist_match_refresh_job_id`
- refresh rerun orchestration in `job.progress`
- worker chain/rerun helpers that encode old policy

Migrations should be created with Supabase CLI commands such as `supabase migration new create_library_processing_state` and `supabase migration new add_library_processing_job_metadata`, not by hand-rolled filenames.

The alternative was a staged dual-write or compatibility layer between `user_preferences` pointers and `library_processing_state`. The docs explicitly reject that, and it would increase mixed-architecture risk without much operational benefit for this repo.

### Decision: Keep source boundaries semantic and stamp request markers only inside `applyLibraryProcessingChange(...)`

Source boundaries will emit typed, source-shaped changes only:

- onboarding -> `onboarding_target_selection_confirmed`
- sync -> one aggregated `library_synced`
- enrichment worker -> `enrichment_completed` / `enrichment_stopped`
- refresh worker -> `match_snapshot_published` / `match_snapshot_failed`

`src/lib/server/onboarding.functions.ts` and `src/routes/api/extension/sync.tsx` will stop calling policy-shaped trigger helpers directly. They will instead construct valid changes and call `applyLibraryProcessingChange(...)` once per source event.

The alternative was to let each boundary continue inventing follow-on timestamps or request metadata. That would make settlement correctness depend on caller behavior and reintroduce stale-state bugs when new changes arrive during job execution.

### Decision: Use lower-level ensure/create job helpers and derive execution hints at ensure time

`src/lib/data/jobs.ts` should grow lower-level helpers for the two modeled workflows, with explicit scheduling metadata on the job row:

- enrichment ensure/create helper
- `match_snapshot_refresh` ensure/create helper

Those helpers will set the job request marker and queue priority, and the refresh ensure path will derive `needsTargetSongEnrichment` from current DB state at ensure time.

That removes policy ownership from:

- `src/lib/workflows/enrichment-pipeline/trigger.ts`
- `src/lib/workflows/target-playlist-match-refresh/trigger.ts`
- any refresh-after-drain or rerun-coalescing helper logic

The alternative was to keep policy-shaped trigger helpers and try to route them through the new state. That would blur the control-plane boundary and make it harder to reason about why a job exists.

### Decision: Refresh becomes single-pass; repeated passes are scheduler-owned, not worker-owned

`src/lib/workflows/target-playlist-match-refresh/orchestrator.ts` should keep owning snapshot publication, but each claimed `match_snapshot_refresh` job should execute exactly one pass. `src/worker/execute.ts` should stop looping on `rerunRequested`, and `src/lib/data/jobs.ts` should stop persisting rerun orchestration in `job.progress`.

If a new change arrives while refresh is running, the control plane will leave `matchSnapshotRefresh` stale and ensure another job after the current job settles. That keeps all follow-on scheduling in one place.

The alternative was to keep the current rerun loop. That keeps policy in worker execution, duplicates reconciliation logic, and makes active job ownership harder to reason about.

### Decision: Enrichment worker reports explicit outcomes instead of chaining inline

`src/worker/chain.ts` exists today because the worker decides whether to enqueue another chunk immediately. Under the new model, the worker should report explicit outcomes to `applyLibraryProcessingChange(...)`:

- `requestSatisfied`
- `newCandidatesAvailable`
- `local_limit`
- `error`

The control plane will decide whether another enrichment job should exist. Chunk-size progression (`1 -> 5 -> 10 -> 25 -> 50`) remains enrichment-local execution strategy, but job ensuring becomes scheduler-owned.

The alternative was to keep inline worker chaining and merely persist more metadata. That still leaves the worker deciding queue existence, which is the control-plane responsibility this refactor is trying to centralize.

### Decision: Replace `batch.ts` app-side exclusion lists with two DB-side selectors/RPCs

`src/lib/workflows/enrichment-pipeline/batch.ts` and `src/lib/workflows/target-playlist-match-refresh/orchestrator.ts` currently depend on application-side exclusion and large ID lists.

The refactor should add two DB-native selectors:

1. `select_liked_song_ids_needing_pipeline_processing(p_account_id uuid, p_limit integer)` for enrichment chunk selection
2. `select_data_enriched_liked_song_ids(p_account_id uuid)` for refresh candidate loading

The full-pipeline selector must preserve current semantics:

- include songs missing any shared artifact
- include songs with all shared artifacts but missing account-scoped `item_status`
- exclude songs already fully pipeline-processed for the account
- exclude terminal failures through DB-side filtering in the first pass

The data-enrichment selector must preserve current refresh semantics:

- require the same shared artifacts
- omit the account-scoped `item_status` requirement
- avoid folding terminal failure filtering into refresh-candidate eligibility

The alternative was to keep the current `.not("song_id", "in", ...)` approach and only change the control plane. The docs explicitly reject that because the scalability/correctness bug is in scope for this change.

### Decision: Queue priority is an end-to-end input but the scheduler stays neutral about pricing plans

Add `src/lib/workflows/library-processing/queue-priority.ts` to resolve neutral queue bands:

- `low`
- `standard`
- `priority`

Current monetization mapping stays outside the pure scheduler:

- free -> `low`
- credits -> `standard`
- supporter -> `priority`

The numeric `job.queue_priority` column is the storage/claiming representation. Because `src/worker/poll.ts` currently hardcodes an enrichment-first two-step claim path, the cutover should replace that with one mixed-workflow DB claim path that chooses between `enrichment` and `match_snapshot_refresh` by `queue_priority DESC, created_at ASC`.

This repo does not yet have a monetization entitlement table, so `queue-priority.ts` should hide entitlement lookup behind a thin boundary and default accounts without entitlement data to the free/baseline `low` band until billing data exists.

The alternative was to hardcode pricing-tier names into reconciliation or keep first-in-first-out ordering only. That would either couple architecture to product copy or fail to make queue preference real in the cutover.

### Decision: Keep `firstMatchReady` derived and expose it through existing read-model paths

`firstMatchReady` should stay out of `library_processing_state`. The derived signal belongs in the existing read-model/server-function path that already feeds onboarding and dashboard state, alongside active background job information.

This likely touches `src/lib/server/jobs.functions.ts` or adjacent loader-facing server functions rather than the core reconciler.

The alternative was to add milestone-style fields to `library_processing_state`. The docs explicitly reject that because the control plane should model freshness, not one-off UX milestones.

### Decision: Durable execution measurement lands as a second pass inside the same change

After the control-plane cutover is in place, add a minimal per-attempt measurement store in `job_execution_measurement` for claimed `enrichment` and `match_snapshot_refresh` jobs. The measurement write path should live close to worker claim/settlement plumbing, not inside billing or scheduler logic. The first cut should keep all measurement rows with no automatic pruning in v1.

The first pass establishes:

- schema shape
- queue priority inputs
- explicit outcomes
- request-marker settlement

The second pass adds durable writes with workflow-specific `details` JSON. This preserves the docs' ordering: measurement is in scope, but follows the control-plane cutover instead of blocking it.

The alternative was to defer measurement to a separate future change. The docs explicitly keep it in scope here so the new control plane is monetization-ready.

## Risks / Trade-offs

- [Forward-only hard cut can leave little rollback room] -> Treat schema + code as one coordinated release window and avoid mixed old/new deployments after the new migrations land.
- [State drift between `library_processing_state` and `job`] -> Keep all active job pointer updates inside one apply/persist path and stop writing orchestration pointers anywhere else.
- [Request-marker settlement bugs can hide newer work] -> Require jobs to carry the satisfied request marker and settle from that stored value, never from completion time.
- [Selector SQL can become too clever] -> Keep selector scope narrow: one full-pipeline selector, one data-enrichment selector, and fold terminal-failure filtering only into the full-pipeline selector.
- [Queue-priority mapping may leak pricing copy into scheduler state] -> Resolve neutral bands in `queue-priority.ts` outside the pure reconciler and store only numeric queue values on `job`.
- [Single-pass refresh may increase queued refresh jobs during bursts] -> Accept more but simpler jobs, and rely on request-marker freshness plus active-job uniqueness to keep behavior correct.
- [Measurement second pass could get skipped after control-plane work lands] -> Keep measurement tasks in the same change and place them after cutover in the concrete task order.

## Migration Plan

1. Create Supabase migrations via CLI for the schema foundation: `library_processing_state`, `job.satisfies_requested_at`, `job.queue_priority`, `match_snapshot_refresh` naming/helpers, the mixed-workflow queue claim path, `select_liked_song_ids_needing_pipeline_processing(...)`, and `select_data_enriched_liked_song_ids(...)`.
2. Regenerate database types and add `src/lib/workflows/library-processing/` with typed state, queries, change helpers, queue-priority resolution, `applyLibraryProcessingChange(...)`, and `reconcileLibraryProcessing(...)`.
3. Add lower-level ensure/create job helpers in `src/lib/data/jobs.ts` and stop routing scheduling through policy-shaped trigger helpers.
4. Cut worker execution over: explicit enrichment outcomes, single-pass refresh execution, scheduler-owned settlement, DB-side selectors for enrichment and refresh candidates, and removal of `src/worker/chain.ts` / rerun orchestration.
5. Cut source boundaries over: onboarding emits onboarding changes, sync emits one aggregated `library_synced` change, and direct trigger calls are removed.
6. Apply the cleanup migration, then remove obsolete helpers, old `user_preferences` orchestration fields, and old naming/plumbing that the hard cut no longer needs.
7. Add durable execution measurement as the second pass after control-plane cutover, then run validation and the smallest relevant checks.

Rollback strategy is intentionally limited. Before the forward-only migrations land, code rollback is easy. After they land, the expectation is to finish the cutover rather than reintroduce legacy orchestration.

## Open Questions

- No remaining design-blocking open questions for the OpenSpec artifacts.
- Implementation can proceed with the locked decisions: `job.satisfies_requested_at`, `job_execution_measurement` with no automatic pruning in v1, `select_liked_song_ids_needing_pipeline_processing(...)`, `select_data_enriched_liked_song_ids(...)`, and terminal-failure filtering folded into the full-pipeline selector only.
