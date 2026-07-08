# Progressive Batch Matching Future Architecture Plan

## Status

This plan is **patched and reclassified** after the Cymbal codebase review.

Use the first-visible full-snapshot plan as the primary root-cause plan.

The progressive match-feed design below is still a plausible future architecture, but it is **not the best first root-cause fix** for the current codebase. It should only be pursued after the first-visible full-snapshot plan proves that full refresh latency remains the bottleneck.

Why this changed:

- The current code already supports chunk-boundary progressive refreshes.
- `getOrderedUndecidedSongIds()` and `getOrderedUndecidedPlaylistIds()` already provide visible-subject derivation using the same strictness/filter/entitlement logic as queue append.
- The actual immediate root cause is weaker: scheduling/readiness/selection optimize for candidate/raw-result readiness, not **first visible review card**.
- Candidate-batch-only snapshots would force a broader queue/read-model migration because current sessions consume latest snapshots as complete state.

So this document is now a **future incremental-feed option**, not the recommended immediate implementation.

## Current code facts this plan depends on

- `match_snapshot_refresh` currently loads all candidates with `getEntitledDataEnrichedSongIds(accountId)` in `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`.
- `publish_match_snapshot` writes an immutable `match_snapshot` plus `match_result` rows atomically.
- Queue cards are derived by `appendSnapshotDelta()` in `src/lib/domains/taste/match-review-queue/service.ts`.
- `appendSnapshotDelta()` only queues subjects with at least one visible pair under the session visibility policy.
- Default read-time threshold is `STRICTNESS_MIN_SCORE.balanced = 0.5` in `src/lib/domains/taste/song-matching/strictness.ts`.
- Write-time match storage threshold is `DEFAULT_MATCHING_CONFIG.minScoreThreshold = 0.35` in `src/lib/domains/taste/song-matching/config.ts`.
- Active queue sync currently appends only the latest snapshot via `appendLatestSnapshot()`.
- Queue items already carry `source_snapshot_id`, so a card can point at the exact immutable scored result set that produced it.
- `match_review_session_snapshot` already tracks applied snapshots and has a visibility hash, so idempotent multi-snapshot queue append is structurally close.
- There is one active `match_snapshot_refresh` job per account via `idx_unique_active_match_snapshot_refresh_per_account`.
- Pending refresh coalescing currently merges progress but overwrites `queue_priority` and `available_at`.

## Why this future architecture might still become necessary

The primary plan is:

```txt
enrichment chunk completes
→ queue immediate match_snapshot_refresh
→ refresh recomputes all currently-ready candidates
→ publish complete latest snapshot
→ sync queue
```

That is compatible with current code and should be implemented first. However, after measurement, it may still have three scalability limitations:

1. **It repeatedly scores the full candidate set.**
   - As the candidate set grows, every progressive refresh gets slower.
   - The next visible match can wait behind work unrelated to that newly-ready batch.

2. **It still treats latest snapshot publication as the feed boundary.**
   - The review queue cannot consume “new batch results” directly.
   - It can only consume the latest complete snapshot.

3. **Batch intent can be lost while a refresh is already running.**
   - `ensureMatchSnapshotRefreshJob()` returns the running job and does not persist incoming candidate IDs into a durable request accumulator.
   - Full refresh avoids this because it does not need candidate IDs, but true progressive batch matching does.

So full-snapshot progressive refresh is the best current root-cause fix, but the incremental feed below is the next architecture to consider if complete refreshes remain too slow after first-visible scheduling, selector, and UX fixes land.

## Future target architecture

Introduce a **progressive match feed**:

```txt
candidate becomes ready
→ candidate enters current match-feed generation
→ matcher claims a small candidate batch
→ scores only that batch against current target playlists
→ publishes an immutable incremental serving snapshot
→ active review queues append visible subjects from all unapplied serving snapshots
→ full snapshot runs later for complete/background correctness
```

The key distinction:

- **Incremental serving snapshots** are for fast user-visible feed append.
- **Full snapshots** are for complete current state, dashboard/detail fallbacks, and eventual consistency.

## Data model changes

### 1. Add match-feed generation

Create a table such as:

```sql
CREATE TABLE match_feed_generation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  config_hash TEXT NOT NULL,
  playlist_set_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
```

Purpose:

- Defines the current matching context.
- Prevents stale incremental batches from old playlist intent/config from being consumed by new sessions.
- New target playlist/scoring config change closes the old generation and opens a new one.

### 2. Add snapshot scope

Extend `match_snapshot`:

```sql
ALTER TABLE match_snapshot
ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'incremental')),
ADD COLUMN generation_id UUID REFERENCES match_feed_generation(id),
ADD COLUMN base_full_snapshot_id UUID REFERENCES match_snapshot(id);
```

Rules:

- `scope = 'full'`: complete candidate-set snapshot.
- `scope = 'incremental'`: immutable scored result set for one candidate batch.
- Every queue item can continue to point at `source_snapshot_id`.

Update `publish_match_snapshot` or add a new `publish_match_snapshot_v2` so scope/generation are written atomically with results.

Include `NOTIFY pgrst, 'reload schema';` in RPC signature-changing migrations.

### 3. Add candidate feed state

Create a table such as:

```sql
CREATE TABLE match_feed_candidate (
  generation_id UUID NOT NULL REFERENCES match_feed_generation(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'scored', 'stale')),
  first_ready_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scored_snapshot_id UUID REFERENCES match_snapshot(id),
  max_fused_score DOUBLE PRECISION,
  visible_at_default_strictness BOOLEAN,
  PRIMARY KEY (generation_id, song_id)
);
```

Purpose:

- Durable accumulator for newly ready candidates.
- Avoids losing candidate IDs when a match refresh is already running.
- Lets the matcher select pending work from DB instead of relying on transient change payloads.

## Pipeline behavior

### 1. Enrichment completion

When an enrichment chunk finishes, compute the newly entitled/data-enriched songs as today, but persist them:

```txt
new ready song IDs
→ upsert into match_feed_candidate(status = 'pending') for active generation
→ request match refresh
```

Also periodically seed pending candidates from globally enriched liked songs:

```txt
select_entitled_data_enriched_liked_song_ids(accountId)
minus current-generation match_feed_candidate rows
→ pending
```

This is what ensures globally enriched songs can be used immediately.

### 2. Match refresh modes

Extend `MatchSnapshotRefreshPlan`:

```ts
type MatchSnapshotRefreshPlan =
  | {
      mode: "incremental";
      generationId: string;
      batchSize: number;
      needsTargetSongEnrichment: boolean;
    }
  | {
      mode: "full";
      generationId: string;
      needsTargetSongEnrichment: boolean;
    };
```

#### Incremental mode

```txt
claim N pending match_feed_candidate rows
load only those songs
load current target profiles
score batch against target playlists
retain stored pairs
publish scope='incremental' snapshot
mark candidate rows scored
append active queues from this snapshot
if pending candidates remain, request another incremental job
```

#### Full mode

```txt
load all entitled/data-enriched candidates
score complete set
publish scope='full' snapshot
mark generation full-refreshed
schedule background cleanup/stale handling
```

### 3. Scheduling policy

Use the existing `match_snapshot_refresh` workflow/job type. Do not add a separate workflow.

Priority policy:

```txt
first visible match not ready → incremental, interactive: 200, immediate
visible queue already exists → incremental, priority/billing priority, immediate or short debounce
full refresh → standard/billing priority, debounced/background
```

Add priority band:

```ts
low: 0
standard: 50
priority: 100
interactive: 200
```

Fix pending merge semantics:

```ts
queue_priority = max(existing, incoming)
available_at = min(existing, incoming)
```

### 4. Running-job supersession

Because only one `match_snapshot_refresh` job can be active per account:

- If a long full refresh is running and an interactive incremental request arrives, state should advance so the full job sees `isMatchRefreshJobSuperseded()` and exits at the next check.
- The pending candidate rows remain durable in `match_feed_candidate`.
- After the superseded job settles, the scheduler creates the next incremental job from DB state.

This avoids losing batch work while preserving one-active-job constraints.

## Queue changes

Current queue sync only applies the latest snapshot. Change it to apply all unapplied serving snapshots for the active generation.

### Replace latest-only append

Current:

```txt
appendLatestSnapshot(session, accountId)
```

Target:

```txt
appendUnappliedServingSnapshots(session, accountId, generationId)
```

Behavior:

1. Find current active generation.
2. For a new session:
   - apply latest full snapshot for the generation if it exists;
   - then apply incremental snapshots created after that full snapshot;
   - if no full snapshot exists, apply current-generation incremental snapshots in `created_at ASC` order.
3. For an existing session:
   - apply any full/incremental snapshots not present in `match_review_session_snapshot` for that visibility hash.
4. Reuse `appendSnapshotDelta()` for each snapshot.

This preserves:

- existing visibility policy logic;
- default 50% threshold behavior;
- entitlement checks;
- playlist filter checks;
- decision checks;
- `source_snapshot_id` provenance.

## Read path changes

### Latest full snapshot

Change broad read helpers to avoid accidental incremental latest snapshots:

```ts
getLatestFullMatchSnapshot(accountId)
```

Use this for:

- dashboard summaries/previews that expect complete state;
- liked-song suggestion fallback paths;
- hidden count calculations that currently call `getLatestMatchSnapshot()`.

### Queue/feed snapshots

Add separate helpers:

```ts
listUnappliedServingSnapshots(accountId, sessionId, generationId, visibilityHash)
getLatestServingSnapshot(accountId, generationId)
```

Do not let incremental snapshots silently replace full snapshot semantics.

## First-visible readiness

Replace current weak `firstMatchReady` meaning.

Current weak version:

```txt
latest snapshot has at least one match_result
```

Target:

```txt
there is at least one unresolved queue item whose visible suggestion list is non-empty under current/session visibility policy
```

Expose this from `getActiveJobs()` / `useActiveJobs()` as:

```ts
firstVisibleMatchReady: boolean
```

Use it for:

- interactive priority decisions;
- `/match` empty/loading states;
- funnel measurement.

## `/match` UX states

Update `/match` to distinguish:

1. No cards + active incremental/enrichment work:
   - “Finding your first matches…”
2. Cards visible + active work:
   - “More matches are still being found.”
3. No cards + no active work + hidden count > 0:
   - “Try loosening match strictness.”
4. No cards + no active work + no hidden count:
   - true empty / configure playlists.

## Measurement gate: when this refactor is worth it

Measure after the primary first-visible full-snapshot fixes land. The feed refactor is worth doing only if the remaining delay is dominated by complete refresh execution/rescoring, not by enrichment, queue scheduling, or match quality.

### Events to emit

Track these events with a shared `account_id`, `request_id` / job id, candidate counts, target playlist count, and worker metadata:

- `matching_setup_completed`
- `first_visible_readiness_checked`
  - `first_visible_match_ready`
  - `pending_song_queue_count`
  - `pending_playlist_queue_count`
- `candidate_batch_ready`
  - `new_candidate_count`
  - `enrichment_batch_sequence`
  - `enrichment_selection_mode`
- `match_refresh_requested`
  - `reason`
  - `priority`
  - `available_at`
  - `first_visible_match_ready_before_request`
- `match_refresh_started`
  - `queue_wait_ms`
  - `candidate_count`
  - `target_playlist_count`
- `match_refresh_stage_completed`
  - `stage`: `target_song_enrichment`, `playlist_profiling`, `candidate_loading`, `matching`, `publishing`
  - `duration_ms`
- `full_match_snapshot_published`
  - `candidate_count`
  - `stored_matched_song_count`
  - `stored_pair_count`
  - `snapshot_id`
- `review_queue_appended`
  - `orientation`
  - `appended_count`
  - `hidden_review_item_count`
  - `source_snapshot_id`
- `first_visible_match_ready`

If this future feed is later implemented, add:

- `match_feed_generation_started`
- `incremental_match_snapshot_published`

### Derived metrics

Primary north star:

```txt
first_visible_match_ready_at - matching_setup_completed_at
```

Break it down into:

```txt
setup_to_candidate_ready_ms
candidate_ready_to_refresh_start_ms
refresh_execution_ms
publish_to_queue_append_ms
queue_append_to_first_visible_ready_ms
```

Also compute:

```txt
refresh_ms_per_candidate = refresh_execution_ms / candidate_count
new_candidate_ratio = new_candidate_count / candidate_count
wasted_rescore_ratio = 1 - new_candidate_ratio
visible_yield = appended_count / candidate_count
```

Segment all metrics by:

- candidate count buckets: `1-50`, `51-250`, `251-1000`, `1001+`
- target playlist count
- billing/priority band
- worker concurrency
- first-match vs already-active-review state
- whether the account had globally ready candidates at setup time

### Do this refactor if

After the primary plan ships, pursue this progressive feed if most of these are true:

1. `candidate_ready_to_refresh_start_ms` is low, but `refresh_execution_ms` is still high.
   - This means priority/scheduling is fixed and the full refresh itself is the bottleneck.
2. P75 `candidate_ready_to_queue_append_ms` is still above the product target, or P95 is routinely above ~60s for accounts that already have ready candidates.
3. `wasted_rescore_ratio` is consistently high before first visible match, e.g. most refreshes rescore 90%+ unchanged candidates to include a small newly-ready batch.
4. `refresh_ms_per_candidate` grows roughly linearly with candidate count and dominates total time for `251+` or `1001+` candidate accounts.
5. Multiple full refreshes run before first visible match for the same account, but only the newest small candidate batch materially changes visible queue output.
6. Worker saturation is caused by long full refresh execution, not by enrichment/provider limits.

### Do not do this refactor yet if

Do not start the feed refactor if the measurements show:

- `setup_to_candidate_ready_ms` dominates. Then improve enrichment selection, analysis, activation, or globally-ready candidate seeding first.
- `candidate_ready_to_refresh_start_ms` dominates. Then fix priority, `available_at`, worker concurrency, or stale running-job supersession first.
- Refreshes publish quickly but `review_queue_appended.appended_count = 0`. Then the bottleneck is scoring quality, target playlist setup/intent, strictness, filters, or entitlement — not snapshot architecture.
- `publish_to_queue_append_ms` dominates. Then improve queue sync/refetch behavior before changing the snapshot model.
- Full refresh duration is already comfortably below the product target for the candidate-count cohorts that matter.

Do not use raw `match_result` existence as activation. The activation event is first visible review-card readiness.

## Future implementation order

Do **not** start here. First implement the primary first-visible full-snapshot plan:

1. Fix `queue_priority` / `available_at` pending merge.
2. Add `interactive: 200` queue band.
3. Replace raw `firstMatchReady` with first-visible readiness.
4. Use first-visible readiness in scheduling.
5. Add first-match-bootstrap enrichment selection.
6. Update `/match` building states.
7. Measure time-to-first-visible-match and full-refresh cost.

Only if measurements show full snapshot refresh is still the bottleneck, implement this future feed architecture:

1. Add `match_feed_generation`.
2. Add `scope` and `generation_id` to `match_snapshot`.
3. Add `match_feed_candidate`.
4. Persist newly ready candidates from enrichment chunks.
5. Implement incremental `MatchSnapshotRefreshPlan` mode.
6. Publish `scope='incremental'` snapshots from candidate batches.
7. Change queue sync from latest-only to all unapplied current-generation serving snapshots.
8. Change broad read paths to `getLatestFullMatchSnapshot()`.
9. Add background full refresh after first visible match / idle.

## Testing plan

### Unit tests

- Pending refresh merge preserves max priority.
- Pending refresh merge preserves earliest `available_at`.
- Incremental plan selects only pending candidates.
- Full plan selects all entitled/data-enriched candidates.
- Queue sync applies multiple snapshots in order.
- Queue sync does not duplicate subjects already queued in the same session.
- `getLatestFullMatchSnapshot()` ignores incremental snapshots.

### Integration tests

- Enrichment creates pending candidates and triggers incremental refresh.
- Incremental snapshot with pairs below 0.5 does not create default visible queue item.
- Incremental snapshot with a pair >= 0.5 creates a queue item.
- New `/match` session with no full snapshot applies existing incremental snapshots.
- New `/match` session with a full snapshot applies full, then later incrementals.
- Config change creates new generation and old incremental snapshots are ignored.
- Running full refresh supersedes when first-match incremental request arrives.

## Migration / rollout notes

- Add new columns/tables behind code that still treats all existing snapshots as `scope='full'`.
- Backfill existing snapshots with `scope='full'` and nullable `generation_id`.
- Deploy read helper changes before publishing incremental snapshots.
- Only enable incremental publishing after queue sync is generation/scope-aware.
- Include `NOTIFY pgrst, 'reload schema';` in RPC-changing migrations.

## Final recommendation

For the current codebase, do **not** treat this as the primary root-cause plan.

The first-visible-match progressive pipeline shipped first (git history: `feat(match): define first-visible-match readiness`, `feat(scheduler): prioritize match refresh until first visible card exists`). It fixed the actual immediate root cause with much less risk:

```txt
first-visible readiness
+ interactive refresh priority
+ near-ready enrichment selection
+ atomic full-snapshot publication
+ queue sync at snapshot boundaries
+ honest /match building state
```

Keep this progressive match-feed design as a future option if metrics prove that full-snapshot refresh time remains the dominant blocker after those fixes.
