# MSR-09 — Refresh debounce and pending-job available_at handling

## Goal

Delay and coalesce pending match refresh jobs so rapid config saves do not immediately trigger expensive work.

## Depends on / blocks

Depends on:

- MSR-08

Blocks:

- MSR-10
- MSR-35

## Scope and out of scope

In scope:

- Update claim RPC to require `available_at <= now()`.
- Add `MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE` and `resolveMatchRefreshAvailableAt`.
- Update scheduler to pass absolute `availableAt` into `ensureMatchSnapshotRefreshJob`.
- Update pending-job ensure behavior to merge `satisfies_requested_at`, `queue_priority`, `available_at`, and OR `needsTargetSongEnrichment`.
- Add tests for debounce, pull-forward, and plan merge behavior.

Out of scope:

- Running-job cancellation.
- Read-time filter change fact split.
- Ranking checkpoints.

## Likely touchpoints

- `supabase/migrations/**claim_pending_library_processing_job**`
- `src/lib/platform/jobs/library-processing-queue.ts`
- `src/lib/workflows/library-processing/scheduler.ts`
- `src/lib/workflows/library-processing/types.ts`
- Related tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E16, C16.
- Playlist editor save debounce is 8 seconds for specified config-save change kinds.
- Running existing jobs are returned unchanged; pending jobs are updated.

## Acceptance criteria

- Pending match refresh jobs before `available_at` are not claimed.
- Repeated playlist config saves update one pending job.
- Immediate triggers can pull a debounced pending job forward to now.
- `needsTargetSongEnrichment` remains true if any coalesced trigger needs it.

## Notes on risks or ambiguity

- Do not delay onboarding/library triggers that the plan marks as zero debounce.
- Timestamp comparison and storage should remain ISO/DB-compatible.
