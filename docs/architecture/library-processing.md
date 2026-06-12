# Library Processing

Centralizes follow-on scheduling for `enrichment` and `matchSnapshotRefresh`. Makes scheduling policy easier to understand, monetization-ready, and ready for fast first-value UX.

## Why This Refactor

Today the decision of "what should happen next for this account?" is split across onboarding target selection, extension sync, enrichment trigger helpers, worker completion, and refresh rerun mechanics. This creates:

1. Scheduling policy is hard to reason about
2. Enrichment stop semantics are ambiguous
3. The current shape is weak for monetization, queue preference, and measurement

## Design Summary

### Core Control Plane

- domain: `library-processing`
- state record: `LibraryProcessingState`
- DB table: `library_processing_state`
- service entrypoint: `applyLibraryProcessingChange(...)`
- pure reconciler: `reconcileLibraryProcessing(...)`
- side-effect output: `LibraryProcessingEffects`
- input union: `LibraryProcessingChange`

### Scope

`LibraryProcessingState` models only `enrichment` and `matchSnapshotRefresh`. Sync remains a change source, not a controlled workflow.

### Canonical Naming

- workflow slice: `matchSnapshotRefresh`
- durable job type: `match_snapshot_refresh`
- change helper group: `MatchSnapshotChanges.*`

A `matchSnapshotRefresh` job still performs a publish.

---

## Core Domain Model

### Workflow State Shape

```ts
interface LibraryProcessingWorkflowState {
  requestedAt: string | null;
  settledAt: string | null;
  activeJobId: string | null;
}

interface LibraryProcessingState {
  accountId: string;
  enrichment: LibraryProcessingWorkflowState;
  matchSnapshotRefresh: LibraryProcessingWorkflowState;
  createdAt: string;
  updatedAt: string;
}
```

| Field | Meaning |
|---|---|
| `requestedAt` | Latest request marker for this workflow |
| `settledAt` | Latest request marker this workflow has successfully satisfied |
| `activeJobId` | Currently active job for this workflow, if any |

**Staleness rule:** a workflow still owes work when `requestedAt` exists and `settledAt` is null or older than `requestedAt`.

**Critical correctness detail:** when a job completes, `settledAt` must be set to the request marker that job was satisfying — not wall-clock completion time. This prevents a newer change that arrived during execution from being masked.

### Row Shape

`library_processing_state` is:

- one row per account
- flattened typed columns, not JSONB blobs
- created lazily on first library-processing use
- timestamped with `created_at` / `updated_at`
- active-job columns reference `job(id)` with `ON DELETE SET NULL`

### LibraryProcessingEffects

```ts
type LibraryProcessingEffect =
  | { kind: "ensure_enrichment_job"; accountId: string; satisfiesRequestedAt: string }
  | { kind: "ensure_match_snapshot_refresh_job"; accountId: string; satisfiesRequestedAt: string };
```

- ensure-job effects carry the exact request marker the job satisfies
- state updates (advancing `requestedAt`, `settledAt`, clearing `activeJobId`) belong in reconciliation, not as separate effects
- queue priority is resolved during effect execution, not inside the pure reconciler
- `needsTargetSongEnrichment` is derived from current DB state during job ensuring, not stored in state

### Job Metadata

Queue-claimed jobs that satisfy `LibraryProcessingState` freshness carry:

- a nullable request-marker column on `job` (used only by `enrichment` and `match_snapshot_refresh`)
- a nullable numeric `queue_priority` column on `job`

Sync phase jobs do not need queue priority.

---

## Change Sources

### Typed Change Union

```ts
type LibraryProcessingChange =
  | { kind: "onboarding_target_selection_confirmed"; accountId: string }
  | {
      kind: "library_synced";
      accountId: string;
      changes: {
        likedSongs: { added: boolean; removed: boolean };
        targetPlaylists: {
          trackMembershipChanged: boolean;
          profileTextChanged: boolean;
          removed: boolean;
        };
      };
    }
  | { kind: "enrichment_completed"; accountId: string; jobId: string; requestSatisfied: boolean; newCandidatesAvailable: boolean }
  | { kind: "enrichment_stopped"; accountId: string; jobId: string; reason: "local_limit" | "error" }
  | { kind: "match_snapshot_published"; accountId: string; jobId: string }
  | { kind: "match_snapshot_failed"; accountId: string; jobId: string };
```

Payloads are intentionally minimal. Request markers belong to the control plane and must not be copied into source changes. Extend this union for future monetization sources (e.g. `songs_unlocked`) rather than bypassing the control plane.

### Grouped Source Helpers

- `OnboardingChanges.targetSelectionConfirmed(...)`
- `SyncChanges.librarySynced(...)`
- `EnrichmentChanges.completed(...)` / `EnrichmentChanges.stopped(...)`
- `MatchSnapshotChanges.published(...)` / `MatchSnapshotChanges.failed(...)`

These helpers produce valid `LibraryProcessingChange` shapes and must not invent control-plane timestamps.

### Sync Contract

One sync request emits one aggregated `library_synced` change. Rules:

- the change is backend-internal, not FE state
- carries no timestamp or request marker
- all booleans are required; all-false is a valid result
- `targetPlaylists.removed` means a processing-relevant target-playlist removal
- sync remains responsible for ingestion and phase-job tracking, not direct follow-on scheduling policy

### Onboarding Contract

- 1+ selected targets → emit `onboarding_target_selection_confirmed`
- 0 targets / skip → emit **no** library-processing change
- preserve current early-value behavior by reconciling against current library state, not with onboarding-only durable milestone fields

---

## Case Mapping

### Sync: Liked-Song Changes

| Case | Sync Change | Effect |
|---|---|---|
| Added, targets exist | `likedSongs.added = true` | Advance `enrichment.requestedAt`; advance `matchSnapshotRefresh.requestedAt` |
| Added, no targets | `likedSongs.added = true` | Advance `enrichment.requestedAt` only (refresh gated by target existence) |
| Removed | `likedSongs.removed = true` | Advance `matchSnapshotRefresh.requestedAt` |
| Added and removed in same sync | both true | Carry both in one aggregated change |

### Sync: Target-Side Changes

| Case | Sync Change | Effect |
|---|---|---|
| Track membership changed | `targetPlaylists.trackMembershipChanged = true` | Advance `matchSnapshotRefresh.requestedAt` |
| Name changed | `targetPlaylists.profileTextChanged = true` | Advance `matchSnapshotRefresh.requestedAt` |
| Description changed | `targetPlaylists.profileTextChanged = true` | Advance `matchSnapshotRefresh.requestedAt` |
| Image changed | no change | None — cosmetic |
| Song count only changed | no change | None — target correctness depends on exact track-membership changes |
| Some targets removed | `targetPlaylists.removed = true` | Advance `matchSnapshotRefresh.requestedAt`; refresh remaining targets |
| All targets removed | `targetPlaylists.removed = true` | Advance `matchSnapshotRefresh.requestedAt`; publish empty state |

### Sync: No-Effect Cases

| Case | Notes |
|---|---|
| Non-target playlist changes only | Stays outside library-processing unless target selection changes |
| Target playlist order-only track changes | No effect under current assumptions; revisit if profiling becomes order-sensitive |
| Sync completed with no processing-relevant changes | Still emit the change; all booleans remain false |

### Sync: Combined Scenarios

| Scenario | Handling |
|---|---|
| Target track changes + liked-song additions | One aggregated change carries both |
| Target profile-text changes + liked-song removals | One aggregated change carries both |
| Some targets removed while others remain | Refresh remaining targets, not empty state |
| Candidate-side and target-side changes together | Scheduler receives one combined change set and reconciles both workflows |

### Onboarding Cases

| Case | Effect |
|---|---|
| Initial selection with 1+ targets | Emit change; preserve early-value behavior by reconciling against current library state |
| Initial selection with 0 targets / skip | None |
| Later target removal/edit outside onboarding | Not an onboarding case — belongs to future non-onboarding change sources |

### Enrichment Worker Outcomes

| Case | Effect |
|---|---|
| `completed`, `requestSatisfied=false`, `newCandidatesAvailable=false` | Leave `enrichment` stale; update `activeJobId`; do not invalidate refresh |
| `completed`, `requestSatisfied=false`, `newCandidatesAvailable=true` | Leave `enrichment` stale; update `activeJobId`; advance `matchSnapshotRefresh.requestedAt` if targets exist |
| `completed`, `requestSatisfied=true`, `newCandidatesAvailable=false` | Set `enrichment.settledAt` to satisfied marker; clear `activeJobId`; do not invalidate refresh |
| `completed`, `requestSatisfied=true`, `newCandidatesAvailable=true` | Set `enrichment.settledAt`; clear `activeJobId`; advance `matchSnapshotRefresh.requestedAt` if targets exist |
| `stopped`, `reason=local_limit` | Do not advance `settledAt`; update `activeJobId`; leave workflow stale |
| `stopped`, `reason=error` | Do not advance `settledAt`; update `activeJobId`; reconcile retry separately |

### Match Snapshot Refresh Outcomes

| Case | Effect |
|---|---|
| `published` (successful attempt) | Set `matchSnapshotRefresh.settledAt` to satisfied marker; clear `activeJobId` |
| `published`, non-empty snapshot | Derived `firstMatchReady` becomes true |
| `published`, explicit empty state (no targets remain) | Still a successful settlement |
| `failed` | Do not advance `settledAt`; update `activeJobId`; reconcile retry separately |

### Failure Handling In V1

On `enrichment_stopped` with `reason=error` or `match_snapshot_failed`: clear `activeJobId`, do not advance `settledAt`, leave the workflow stale. Do **not** auto-reensure immediately. Retry policy can be layered on later.

---

## Scheduler And Reconciliation

`applyLibraryProcessingChange(...)` must:

1. Load `LibraryProcessingState`
2. Stamp a new request marker for this apply cycle
3. Apply the incoming `LibraryProcessingChange`
4. Call `reconcileLibraryProcessing(...)`
5. Persist the new state
6. Execute `LibraryProcessingEffects`

`reconcileLibraryProcessing(...)` decides:

- whether `requestedAt` should advance
- whether `settledAt` should advance
- whether active job refs should be updated or cleared
- whether the workflow is stale and another job should exist
- whether target existence gates refresh invalidation

The new model must distinguish enrichment success that satisfied the request marker vs. did not, `local_limit` stop, and `error` stop. The current ambiguous "completed" outcome from enrichment chaining must be removed.

---

## Execution Model

Jobs stay as the execution primitive. The scheduler becomes the owner of "should another job exist to satisfy stale workflow state?"

Changes:
- `matchSnapshotRefresh` jobs become single-pass; `rerunRequested` is removed
- enrichment worker reports outcomes back to the scheduler
- scheduler decides whether another enrichment chunk or refresh job should exist

The enrichment workflow still owns chunk-size progression, chunk execution, and artifact/stage logic. That progression is the current execution strategy, not an architecture contract.

### Early Refresh Policy

- liked-song additions can invalidate `matchSnapshotRefresh` immediately when targets exist (some added songs may already be matchable from shared cache)
- enrichment re-invalidates `matchSnapshotRefresh` only when `newCandidatesAvailable === true`
- target-existence gate belongs in the scheduler, not in `EnrichmentChanges.*`

### DB-Side Candidate Selection

Replace the current app-side exclusion list in `src/lib/workflows/enrichment-pipeline/batch.ts` with DB-side selectors. The current approach builds large exclusion sets of already-enriched songs, sends them via `.not("song_id", "in", ...)`, and can exceed PostgREST URL limits.

Two selectors needed:

1. **Full pipeline selector** — next liked songs for an account not yet fully enriched. "Fully enriched" means: has `song_audio_feature`, non-empty `song.genres`, `song_analysis`, `song_embedding`, and account-scoped `account_item_newness` for that song.

2. **Data-enrichment selector** — same shared-artifact requirements, but **without** the account-scoped `account_item_newness` requirement. This preserves the current behavior where songs can be refresh-eligible from shared cache before account-scoped enrichment completes.

Terminal failures should ideally be folded into the full pipeline selector rather than passed as an app-side exclusion list.

---

## Priority Model

Queue bands: `low` | `standard` | `priority`

Current plan mapping (lives outside the scheduler):
- free → `low`
- credits → `standard`
- supporter → `priority`

DB: nullable numeric `queue_priority` on `job`. Claim ordering: `queue_priority DESC`, `created_at ASC`.

Priority resolution goes through `resolveQueuePriority(...)` — keeps pricing-plan names out of scheduler state.

---

## Derived Signals

`firstMatchReady` — the latest published snapshot for the account has at least one match. Derived from the existing read-model layer, not stored in `LibraryProcessingState`.

In v1: derive it in the existing server-function layer, include it in the dashboard/onboarding loader, and let the existing active-job polling + query invalidation trigger refetches. No new SSE needed.

---

## Measurement

One durable measurement row per claimed job attempt for `enrichment` and `match_snapshot_refresh`. Retries produce additional rows.

Shared columns: `job_id`, `account_id`, `workflow`, `queue_priority`, `attempt_number`, `queued_at`, `started_at`, `finished_at`, `outcome`, `created_at`. Plus a small `details` JSONB for workflow-specific metrics.

- Enrichment `details`: per-stage summary with `readyCount`, `doneCount`, `succeededCount`, `failedCount`
- Refresh `details`: `published`, `isEmpty`

Not in scope: credit charging, ledger writes, billing enforcement.

---

## Module Layout

```
src/lib/workflows/library-processing/
  types.ts
  service.ts
  reconciler.ts
  queries.ts
  queue-priority.ts
  changes/
    onboarding.ts
    sync.ts
    enrichment.ts
    match-snapshot.ts
```

No barrel exports. Keep lower-level job ensure helpers outside this folder.

---

## Migration Strategy

Hard cut — no legacy compatibility layer, no dual source of truth, no in-flight job preservation across cutover. Both workflows cut over together.

### Phase 1: Foundation

- [ ] Create `library_processing_state` table (flattened columns, `created_at`/`updated_at`)
- [ ] Add data access helpers for `LibraryProcessingState`
- [ ] Add `queue_priority` to queue-claimed jobs
- [ ] Add generic nullable job request-marker column
- [ ] Update claim RPCs to order by queue priority
- [ ] Add DB-side enrichment selectors (full pipeline + data-enrichment)
- [ ] Validate selector semantics match current artifact requirements
- [ ] Add workflow-specific progress types

### Phase 2: Core Domain

- [ ] Implement `applyLibraryProcessingChange(...)`
- [ ] Implement `reconcileLibraryProcessing(...)`
- [ ] Implement `LibraryProcessingEffects`
- [ ] Add grouped change helpers (`OnboardingChanges`, `SyncChanges`, `EnrichmentChanges`, `MatchSnapshotChanges`)
- [ ] Add `resolveQueuePriority(...)`

### Phase 3: Replace Policy-Shaped Trigger Boundaries

- [ ] Introduce lower-level ensure/create job helpers
- [ ] Stop routing scheduler behavior through policy-shaped trigger helpers
- [ ] Move active enrichment/refresh refs into `LibraryProcessingState`
- [ ] Stop using `user_preferences` job-pointer fields as orchestration source of truth

### Phase 4: Worker Cutover

- [ ] Make `matchSnapshotRefresh` jobs single-pass; remove `rerunRequested` orchestration
- [ ] Switch enrichment batch selection to DB-side selectors
- [ ] Switch match-snapshot candidate loading to DB-side data-enrichment selector
- [ ] Remove app-side giant exclusion-list construction from `batch.ts`
- [ ] Make enrichment outcomes explicit (`requestSatisfied`, `newCandidatesAvailable`, `local_limit`, `error`)
- [ ] Have worker outcomes call `applyLibraryProcessingChange(...)`
- [ ] On successful completion, set `settledAt` to the request marker the job satisfied

### Phase 5: Boundary Cutover

- [ ] Update onboarding target selection to emit `OnboardingChanges.*`
- [ ] Update sync route to emit aggregated `SyncChanges.librarySynced(...)`
- [ ] Remove direct follow-on scheduling from onboarding and sync
- [ ] Remove refresh-after-drain policy helpers

### Phase 6: Derived Signals And Cleanup

- [ ] Expose derived `firstMatchReady` through existing read-model path
- [ ] Update FE invalidation wiring to use existing active-job polling
- [ ] Remove obsolete pointer reads/writes from old orchestration paths
- [ ] Remove rerun and duplicate trigger logic
- [ ] Update tests and architecture docs

### Phase 7: Measurement

- [ ] Create minimal durable measurement storage
- [ ] Write one execution measurement row per claimed job attempt
- [ ] Capture enrichment stage summaries and refresh `published`/`isEmpty` details

---

## Working Assumptions

1. Source changes stay source-shaped and backend-internal.
2. One sync request always emits one aggregated `library_synced` change, even when all booleans are false.
3. Liked-song additions can invalidate `matchSnapshotRefresh` immediately when targets exist — refresh candidates may already be available from shared cache.
4. Enrichment should only re-invalidate `matchSnapshotRefresh` when `newCandidatesAvailable` is true.
5. The scheduler, not source helpers, owns target-existence gates for refresh invalidation.
6. `local_limit` is a local/testing tool, not product behavior.
7. Name and description are profile-relevant target-side changes, aggregated into `profileTextChanged`.
8. Image and song-count-only changes have no direct library-processing effect.
9. Target-side correctness depends on exact track-membership changes, not summary fields.
10. The current enrichment chunk progression is an execution strategy, not an architecture contract.
11. Enrichment candidate selection should move to DB-side selectors that directly find songs still needing work.
12. The data-enrichment selector must preserve current semantics by omitting the account-scoped `account_item_newness` requirement.

---

## Risks

1. **Mixed architecture during cutover** — avoid leaving old trigger-policy logic alive longer than necessary
2. **State drift between control plane and execution** — active refs must have one clear source of truth
3. **Settling the wrong request marker** — `settledAt` must reflect the marker the job satisfied, not generic completion time
4. **Priority semantics becoming product-copy-coupled** — keep pricing-plan names out of scheduler state
5. **Source changes getting broadened** — preserve exact processing-relevant changes; don't drift back to broad metadata buckets
6. **Over-triggering refresh** — immediate refresh invalidation must stay tied to real cache-hit possibility
7. **Leaving the batch selector bug alive** — do not ship the control-plane refactor while `batch.ts` still depends on giant app-side exclusion lists

---

## Open Inputs

- exact `library_processing_state` column names and migration/backfill details
- exact name of the generic job request-marker column
- exact measurement table name and retention strategy
- exact SQL/RPC shape for both enrichment selectors
- whether terminal-failure filtering should be fully folded into the selector in the first pass
- whether any schema cleanup should be done eagerly vs left inert

---

## End State

- change sources report meaningful library-processing changes
- `LibraryProcessingState` is the source of truth for workflow freshness
- the scheduler reconciles `requestedAt` vs `settledAt`
- jobs remain the execution primitive
- workers execute one pass at a time and report outcomes back
- queue ordering is explicit and monetization-ready
- cache-hit eligible songs can surface early through freshness-based refresh scheduling
- `firstMatchReady` is a derived read-model signal
- execution measurement exists without billing policy in orchestration
