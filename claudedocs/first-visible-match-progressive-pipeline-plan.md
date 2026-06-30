# First-visible-match progressive pipeline plan

## Conclusion

The previous “progressive batch matching” direction is right, but **not as a candidate-batch/delta-snapshot refactor first**.

The current code already has a batch-progressive shape:

- `executeWorkerChunk()` detects newly ready candidates with `loadEntitledReadyInBatch()`.
- `enrichment_completed` with `newCandidatesAvailable` advances `matchSnapshotRefresh`.
- `match_snapshot_refresh` publishes atomically.
- active review queues sync after refresh completion.

So the deeper root cause is not “there is no progressive pipeline.” The root cause is that the pipeline is organized around **candidate readiness / raw stored results**, while the product moment is **first visible review card**.

A real first match appears only when at least one `(song_id, playlist_id)` pair:

1. is from an entitled, data-enriched liked song,
2. is matched against an owned target playlist,
3. has `strictnessScore >= 0.5` by default (`balanced`),
4. passes read-time playlist filters,
5. is undecided,
6. becomes an appended review queue item.

Therefore the best root-cause fix is a **first-visible-match progressive pipeline**:

> Use existing atomic full-snapshot refreshes at batch boundaries, but make scheduling, enrichment selection, readiness state, and UI all optimize for “first visible card ready,” not just “candidate ready” or “snapshot has any `match_result`.”

Do **not** start with partial/delta snapshots. They require a larger data-model refactor because the current queue/session model treats the latest `match_snapshot` as complete source-of-truth.

---

## Cymbal verification notes

After indexing and investigating the codebase with `cymbal`, the plan is still valid with one important implementation refinement: the queue domain already has reusable visible-subject derivation helpers, so first-visible readiness does not need a large extraction from `appendSnapshotDelta()`.

Commands used included:

```bash
cymbal index .
cymbal context executeWorkerChunk --callers 10
cymbal context executeEffect --callers 10
cymbal context reconcileLibraryProcessing --callers 20
cymbal context ensureMatchSnapshotRefreshJob --callers 10
cymbal context executeMatchSnapshotRefresh --callers 10
cymbal context appendSnapshotDelta --callers 10
cymbal context deriveFirstMatchReady --callers 10
cymbal context useActiveJobs --callers 10
cymbal context getOrderedUndecidedSubjects --callers 20
cymbal context deriveEligibleSubjects --callers 10
cymbal context getQueueSummary --callers 20
cymbal search --text onboarding_target_selection_confirmed src --limit 80
cymbal search --text select_liked_song_ids_needing_enrichment_work supabase/migrations --limit 50
cymbal search --text pgrst supabase/migrations --limit 30
```

Cymbal-confirmed facts:

- `executeWorkerChunk()` already compares `loadEntitledReadyInBatch()` before/after a chunk and returns `newCandidatesAvailable`.
- `reconcileLibraryProcessing()` advances `matchSnapshotRefresh` on `enrichment_completed` only when `newCandidatesAvailable && hasTargetPlaylists`.
- `executeEffect()` gives enrichment and match refresh the same computed `queuePriority`; for `enrichment_completed`, the next enrichment job is ensured before the match-refresh effect because effect order follows reconciler push order.
- `ensureMatchSnapshotRefreshJob()` overwrites pending `queue_priority` and `available_at` instead of merging max priority / earliest availability.
- `executeMatchSnapshotRefresh()` still loads the full currently entitled data-enriched candidate set via `getEntitledDataEnrichedSongIds(accountId)` and publishes through the normal atomic snapshot writer.
- `appendSnapshotDelta()` is the authoritative queue append path for visible subjects: strictness, decisions, entitlement, playlist ownership, filters, and already-queued exclusion are all applied there.
- `deriveFirstMatchReady()` only checks raw latest-snapshot `match_result` existence.
- `useActiveJobs()` does not expose first-match readiness or match-refresh progress, and Cymbal found callers only in dashboard/liked-songs, not `/match`.
- `getOrderedUndecidedSongIds()` and `getOrderedUndecidedPlaylistIds()` already derive visible subjects from a snapshot using the same eligibility/visibility logic as append. `resolveMatchReviewSummary()` already uses them as the no-active-queue summary fallback.
- `loadTargetPlaylistProfiles()` uses `playlist.match_intent ?? undefined`; target playlist membership is the hard gate, intent text is not.
- `onboarding_target_selection_confirmed` has no production caller; Cymbal found only workflow/tests/helper references.
- Latest enrichment selector SQL still ends with `ORDER BY swf.liked_at DESC`.
- No migration currently sends `NOTIFY pgrst, 'reload schema'`; only `notify pgrst, 'reload config'` exists.

---

## Non-goals for the first implementation

- No per-song streaming.
- No candidate-batch-only snapshot as the normal latest snapshot.
- No separate enrichment workflow/job type that conflicts with one-active-enrichment-job-per-account.
- No weakening of the default visible threshold from `balanced = 0.5`.
- No replacing the existing atomic snapshot publication path.

---

## Root causes in current code

### 1. Readiness is too weak

File: `src/lib/server/jobs.functions.ts`

Current `firstMatchReady` checks whether the latest snapshot has any `match_result` row.

That is not equivalent to first visible match because write-time matching stores rows down to `0.35`, while the default visible threshold is `0.5`.

Relevant files:

- `src/lib/domains/taste/song-matching/config.ts`
  - `DEFAULT_MATCHING_CONFIG.minScoreThreshold = 0.35`
- `src/lib/domains/taste/song-matching/strictness.ts`
  - `STRICTNESS_MIN_SCORE.balanced = 0.5`
- `src/lib/domains/taste/match-review-queue/review-subject-selector.ts`
  - queue subjects require at least one pair passing `passesVisibilityPolicyForPair()`
- `src/lib/domains/taste/match-review-queue/service.ts`
  - `appendSnapshotDelta()` applies entitlement, ownership, strictness, decisions, filters, and already-queued exclusion

### 2. Existing progressive refreshes can be scheduled behind enrichment

Files:

- `src/lib/workflows/library-processing/reconciler.ts`
- `src/lib/workflows/library-processing/scheduler.ts`
- `src/lib/platform/jobs/library-processing-queue.ts`
- `src/lib/platform/jobs/match-refresh-merge.ts`

When enrichment completes and there is still enrichment work, the reconciler can ensure both:

1. next enrichment job,
2. match snapshot refresh job.

Today both can have the same queue priority, and `executeEffect()` creates enrichment first. With one worker slot, the next enrichment chunk can run before the refresh that would surface newly found matches.

### 3. Pending refresh coalescing can demote or delay urgent work

File: `src/lib/platform/jobs/library-processing-queue.ts`

Pending refresh merge currently overwrites:

- `queue_priority`
- `available_at`

This can let a later, lower-priority/debounced trigger delay an already urgent first-match refresh.

### 4. Enrichment selector is not first-match-aware

Current RPC path:

- `src/lib/workflows/enrichment-pipeline/batch.ts`
  - `selectEnrichmentWorkPlan()`
- Supabase RPC:
  - `select_liked_song_ids_needing_enrichment_work`

Current ordering ultimately prioritizes `liked_at DESC`. That can spend early batches on recent-but-expensive songs while older near-ready songs could have produced a visible match sooner.

### 5. `/match` UI cannot tell “building first matches” from “truly empty”

Files:

- `src/lib/hooks/useActiveJobs.ts`
- `src/routes/_authenticated/match.tsx`
- `src/features/matching/components/MatchingEmptyState.tsx`

`getActiveJobs()` returns `firstMatchReady`, but `useActiveJobs()` does not expose it. Also, that flag is currently raw-result-based rather than visible-card-based.

---

## Desired architecture

```text
first valid matching setup
  ↓
if firstVisibleMatchReady is false:
  queue immediate interactive match refresh
  use all globally ready entitled candidates now
  ↓
if no visible cards yet:
  continue enrichment in first-match-bootstrap selection mode
  after every chunk that creates new ready candidates:
    queue immediate interactive match refresh
    publish complete atomic snapshot
    sync active queues
  ↓
once a visible review card exists:
  downgrade to normal background enrichment + refresh behavior
```

This keeps matches flowing at snapshot boundaries while enrichment continues, without introducing partial latest snapshots.

---

## Implementation plan

## Phase 0 — Add tests around current behavior before changing it

Use `bun run test`.

Add coverage for:

- `firstMatchReady` false positive: latest snapshot has `match_result` below `0.5`, but no visible queue item.
- enrichment completion schedules refresh when `newCandidatesAvailable = true`.
- pending refresh merge behavior, currently expected to fail until fixed.
- active jobs hook does not expose first-match readiness yet.

Likely files:

- `src/lib/server/__tests__/jobs.functions.test.ts`
- `src/lib/workflows/library-processing/__tests__/scheduler.test.ts`
- add or extend tests near `src/lib/platform/jobs/match-refresh-merge.ts`
- add queue visibility tests around `appendSnapshotDelta()` / selector behavior

---

## Phase 1 — Fix queue urgency primitives

### 1. Add an interactive priority band

File: `src/lib/workflows/library-processing/queue-priority.ts`

Change:

```ts
type QueueBand = "low" | "standard" | "priority";
```

to:

```ts
type QueueBand = "low" | "standard" | "priority" | "interactive";
```

Add:

```ts
interactive: 200,
```

Keep billing-derived priority unchanged for normal background work.

### 2. Fix pending match-refresh merge semantics

Files:

- `src/lib/platform/jobs/match-refresh-merge.ts`
- `src/lib/platform/jobs/library-processing-queue.ts`

Add helpers:

```ts
export function maxQueuePriority(existing: number | null, incoming: number): number
export function earliestAvailableAt(existing: string, incoming: string): string
```

Update pending refresh merge to use:

```ts
queue_priority: maxQueuePriority(existing.value.queue_priority, opts.queuePriority),
available_at: earliestAvailableAt(existing.value.available_at, opts.availableAt),
```

Keep `satisfies_requested_at` as latest request marker.

Keep progress merge as OR for `needsTargetSongEnrichment`.

### Acceptance criteria

- A lower-priority later request cannot demote an interactive pending refresh.
- A debounced later request cannot push back an immediate pending refresh.
- A later higher-priority request can promote/pull forward an existing pending refresh.

---

## Phase 2 — Define first-visible-match readiness

### Add a server-side helper

Best location:

- `src/lib/domains/taste/match-review-queue/service.ts`

Add a read-only helper that uses existing visible-subject derivation. Cymbal showed that much of this already exists:

- `getOrderedUndecidedSongIds(snapshotId, accountId, minScoreOverride?)`
- `getOrderedUndecidedPlaylistIds(snapshotId, accountId, minScoreOverride?)`
- `resolveMatchReviewSummary(accountId, orientation)` already uses those helpers for the no-active-queue fallback.

Suggested shape:

```ts
export async function hasFirstVisibleReviewSubject(
  accountId: string,
): Promise<Result<boolean, DbError>>
```

It should answer:

> Would the latest snapshot or an active queue produce at least one visible unresolved review subject in either orientation under current visibility policy?

Implementation guidance:

1. First check active queue summaries for both orientations with `getQueueSummary(accountId, orientation)`.
   - If either active queue has `pendingCount > 0`, return `true`.
2. Load the latest snapshot.
   - If no snapshot, return `false`.
3. For each orientation without a pending active queue:
   - call `getOrderedUndecidedSongIds(snapshotId, accountId)` for song mode;
   - call `getOrderedUndecidedPlaylistIds(snapshotId, accountId)` for playlist mode.
4. Return `true` if either helper returns at least one ID.

This reuses the existing strictness/filter/entitlement/ownership/decision logic instead of duplicating `appendSnapshotDelta()` internals. A later refinement can pass active-session `strictnessMinScore` as `minScoreOverride` when needed, but for first-match readiness the common case is no active queue yet, so live strictness is acceptable and matches the existing dashboard fallback behavior.

### Replace weak `firstMatchReady`

File: `src/lib/server/jobs.functions.ts`

Replace or supplement:

```ts
firstMatchReady: boolean
```

with:

```ts
firstVisibleMatchReady: boolean
```

For backward compatibility during migration, temporarily return both:

```ts
firstMatchReady: firstVisibleMatchReady,
firstVisibleMatchReady,
```

### Acceptance criteria

- A snapshot with only `fused_score = 0.49` under balanced strictness is not ready.
- A snapshot with a visible undecided pair at `0.50` is ready.
- A decided pair does not count.
- A pair hidden by playlist filters does not count.
- A non-entitled song does not count.

---

## Phase 3 — Use first-visible readiness in scheduling

Files:

- `src/lib/workflows/library-processing/scheduler.ts`
- possibly `src/lib/workflows/library-processing/types.ts`

### Scheduler policy

When scheduling `ensure_match_snapshot_refresh_job`, compute:

```ts
const firstVisibleReady = await hasFirstVisibleReviewSubject(effect.accountId);
const isFirstVisibleBootstrap = !firstVisibleReady;
```

Then:

```ts
const refreshBand = isFirstVisibleBootstrap ? "interactive" : billingBand;
```

Use interactive priority only for refreshes needed before the first visible card exists.

### Prevent refresh from sitting behind the next enrichment chunk

When `change.kind === "enrichment_completed"` and new candidates are available:

- match refresh should be interactive if first visible card is not ready;
- the next enrichment job should remain normal billing priority.

That way, with one worker slot, the next claimed job is the match refresh, not another enrichment chunk.

### Acceptance criteria

- With `WORKER_CONCURRENCY=1`, after an enrichment chunk creates new candidates and no first visible card exists, the next claimed job is `match_snapshot_refresh`.
- With `WORKER_CONCURRENCY=2`, enrichment can continue while refresh runs.
- Once first visible card exists, normal billing priority applies again.

---

## Phase 4 — Emit concrete candidate batch IDs from enrichment

Files:

- `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
- `src/lib/workflows/library-processing/types.ts`
- `src/lib/workflows/library-processing/changes/enrichment.ts`
- `src/lib/workflows/library-processing/runner.ts`

Current chunk result:

```ts
newCandidatesAvailable: boolean
```

Add:

```ts
newCandidateSongIds: string[]
```

Inside `executeWorkerChunk()`:

```ts
const newCandidateSongIds = [...enrichedAfter].filter(
  (songId) => !enrichedBefore.has(songId),
);
```

Then propagate through `EnrichmentChanges.completed()`.

MVP use:

- scheduling and observability only.

Do **not** use these IDs to publish partial snapshots in the first version.

### Acceptance criteria

- `newCandidatesAvailable === newCandidateSongIds.length > 0` when readiness probe succeeds.
- Logs/measurements can show how many candidate songs each chunk contributed.

---

## Phase 5 — Add first-match-bootstrap enrichment selection

This is the main root-cause refactor.

Files:

- `src/lib/workflows/enrichment-pipeline/batch.ts`
- `src/lib/workflows/enrichment-pipeline/progress.ts`
- `src/lib/platform/jobs/progress/enrichment.ts`
- `src/lib/workflows/library-processing/scheduler.ts`
- Supabase migration defining selector behavior

### Add selection mode

Use the existing enrichment workflow/job type.

Add a mode:

```ts
type EnrichmentSelectionMode = "normal" | "first_match_bootstrap";
```

Store it in enrichment job progress or job plan-like progress field.

Do not add a second enrichment workflow.

### Selector behavior

Current selector is effectively recency-first.

Bootstrap selector should prioritize songs most likely to become visible soon:

1. already entitled + data-enriched but not yet activated/visible where applicable,
2. missing only embedding,
3. missing only genres,
4. has analysis but missing genres and embedding,
5. needs full analysis,
6. recency as tie-breaker, not primary ordering.

Exact DB ordering can be implemented as a readiness rank.

Example conceptual ordering:

```sql
ORDER BY
  readiness_rank ASC,
  swf.liked_at DESC
```

Where lower `readiness_rank` means fewer expensive stages remain before match candidacy.

### RPC strategy

Avoid unnecessary breaking RPC signature changes if possible.

Options:

1. Add a new RPC for bootstrap selection, e.g.
   - `select_liked_song_ids_needing_first_match_enrichment_work`
2. Or add an optional parameter to existing RPC:
   - `p_selection_mode TEXT DEFAULT 'normal'`

If changing RPC signature, include:

```sql
NOTIFY pgrst, 'reload schema';
```

because stale PostgREST schema cache has already caused production-class failures.

### Acceptance criteria

- Before first visible card exists, enrichment batches are near-ready-first.
- After first visible card exists, normal selector behavior resumes.
- No second active enrichment job type exists.

---

## Phase 6 — Keep snapshot publication complete and atomic

File: `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`

For MVP, keep:

```ts
const songIds = await getEntitledDataEnrichedSongIds(accountId);
```

This ensures every published snapshot is a complete current view of all entitled/data-enriched candidates.

Do not switch to:

```ts
getEntitledDataEnrichedSongIds(accountId, newCandidateSongIds)
```

for snapshot publication yet.

Reason: current queue/session code applies the latest snapshot as the source of truth. A candidate-batch-only latest snapshot would make new sessions miss older matches unless the data model learns how to union multiple scoped snapshots.

### Acceptance criteria

- Every latest snapshot remains safe for `createOrResumeQueue()`.
- `appendLatestSnapshot()` remains correct.
- Dashboard and `/match` do not need to union multiple snapshot scopes.

---

## Phase 7 — Make setup trigger immediate enough for first match

Files to inspect/change:

- `src/lib/server/playlists.functions.ts`
- `src/features/playlists/hooks/usePlaylistSession.ts`
- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/lib/workflows/library-processing/reconciler.ts`
- `src/lib/workflows/library-processing/changes/onboarding.ts`

Current concern:

- `onboarding_target_selection_confirmed` exists and queues enrichment + refresh, but appears not wired to the real setup flow.
- Real playlist management flush is deferred and queues refresh only.

Recommended behavior:

When an account first crosses into valid matching setup:

```text
has at least one target playlist
AND has matching config/intent sufficient for matching UX
AND firstVisibleMatchReady is false
```

immediately apply a first-match setup change that causes:

- interactive match refresh now,
- first-match-bootstrap enrichment if no visible card exists.

Implementation options:

1. Wire existing `onboarding_target_selection_confirmed` if its name still matches the product event.
2. Prefer adding a clearer change kind, e.g. `first_match_setup_completed`, if the trigger is no longer onboarding-specific.

Do not rely only on pagehide/unmount flush for first setup.

### Acceptance criteria

- Selecting/saving the first target playlist and intent queues immediate first-match work.
- User does not need to leave the playlist page for first-match processing to begin.

---

## Phase 8 — Update `/match` UX around building state

Files:

- `src/lib/hooks/useActiveJobs.ts`
- `src/routes/_authenticated/match.tsx`
- `src/features/matching/components/MatchingEmptyState.tsx`

Expose from `useActiveJobs()`:

```ts
isEnrichmentRunning
isMatchSnapshotRefreshRunning
enrichmentProgress
matchSnapshotRefreshProgress
firstVisibleMatchReady
```

Use states:

1. No queue items + first visible not ready + jobs active:

```text
Finding your first matches…
```

2. Queue has items + jobs active:

```text
More matches are still being found.
```

3. No queue items + jobs inactive + hidden count > 0:

```text
Loosen strictness to see more matches.
```

4. No queue items + jobs inactive + no hidden count:

```text
True empty/setup guidance.
```

### Acceptance criteria

- `/match` never shows a final empty/caught-up state while first-visible work is actively running.
- Active refresh completion still invalidates review queries and syncs queues.

---

## Phase 9 — Observability and metrics

Track product and worker events around the real user-visible outcome.

Add/extend events:

1. `matching_setup_completed`
2. `first_match_refresh_queued`
   - priority
   - available_at
   - firstVisibleMatchReady before queue
3. `enrichment_candidate_batch_ready`
   - `newCandidateSongIds.length`
   - batch sequence
   - selection mode
4. `match_snapshot_published`
   - candidate count
   - stored matched song count
   - snapshot id
5. `review_queue_appended`
   - orientation
   - appended count
6. `first_visible_match_ready`

North-star metric:

```text
first_visible_match_ready_at - matching_setup_completed_at
```

Supporting metrics:

- time to first candidate batch,
- time from candidate batch to snapshot publish,
- time from snapshot publish to queue append,
- count of snapshots with stored pairs but zero visible queue subjects.

---

## Phase 10 — Optional later: scoped/delta snapshots

Only consider this if measurements show full-snapshot refresh is too slow after the above fixes.

Do not make a batch-only snapshot look like the normal latest full snapshot.

A safe scoped design would require:

- snapshot scope column, e.g. `scope: 'full' | 'candidate_batch'`,
- monotonic sequence or created_at rules per account,
- queue sync that applies all unapplied snapshots since session start,
- dashboard/readiness code that can union full + batch snapshots,
- clear compaction/full-refresh behavior.

This is a larger data-model refactor and should not be first.

---

## Test plan

Run with:

```bash
bun run test
```

Add/adjust tests for:

### Queue priority and coalescing

- interactive priority value is 200.
- pending refresh priority uses max(existing, incoming).
- pending refresh `available_at` uses earliest(existing, incoming).
- `needsTargetSongEnrichment` remains OR-merged.

### First-visible readiness

- raw `match_result` below `0.5` does not count.
- raw `match_result` at/above `0.5` counts only if visible.
- decided pairs do not count.
- hidden-by-filter pairs do not count.
- non-entitled songs do not count.
- playlist orientation works.

### Reconciler/scheduler

- first visible not ready + `enrichment_completed` with new candidates queues interactive refresh.
- first visible ready uses billing priority.
- refresh is not delayed by playlist-management debounce when an immediate first-match trigger exists.

### Enrichment selector

- `first_match_bootstrap` picks near-ready songs before recent expensive songs.
- `normal` keeps existing behavior.
- mode persists through job progress and is parsed safely.

### UI/hooks

- `useActiveJobs()` exposes `firstVisibleMatchReady` and match refresh progress.
- `/match` shows building state while jobs are active and no visible card exists.

---

## Rollout order

1. Fix refresh merge semantics.
2. Add `interactive: 200`.
3. Add first-visible readiness helper and expose it from `getActiveJobs()`.
4. Use first-visible readiness to prioritize refresh scheduling.
5. Emit `newCandidateSongIds` for observability/scheduling detail.
6. Add first-match-bootstrap enrichment selection mode.
7. Wire immediate first setup trigger.
8. Update `/match` states.
9. Add metrics.
10. Re-evaluate whether scoped/delta snapshots are necessary.

---

## Success criteria

- Existing globally enriched candidates are matched immediately after first valid setup.
- If no visible card exists, enrichment prioritizes near-ready songs over purely recent songs.
- When a chunk creates new matchable candidates, match refresh runs before another enrichment chunk on single-worker deployments.
- With multiple worker slots, enrichment and refresh can run concurrently.
- `/match` communicates “finding matches” instead of false empty/caught-up states.
- First-match readiness means visible queue card readiness, not raw `match_result` existence.
