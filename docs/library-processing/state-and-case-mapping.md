# Library Processing State And Case Mapping

## Purpose

This document is independent from the implementation plan.

Its job is to map:

- the meaning of `LibraryProcessingState`
- the contracts of each change source
- which source cases should have library-processing effects
- which cases should have no effect
- which cases still need an explicit product/architecture decision

This document should stay concrete and case-oriented.

See also:

- `implementation-plan.md`

---

## Shared State Meaning

### Workflow Freshness State

Each workflow slice in `LibraryProcessingState` should track:

- `requestedAt`
- `settledAt`
- `activeJobId`

### Intended Meaning

| Field | Meaning |
|---|---|
| `requestedAt` | The latest request marker for this workflow. |
| `settledAt` | The latest request marker this workflow has successfully satisfied. |
| `activeJobId` | The currently active job for this workflow, if any. |

### Staleness Rule

A workflow still owes work when:

- `requestedAt` exists
- and `settledAt` is null or older than `requestedAt`

### Correct Settlement Rule

When a job completes successfully, `settledAt` should become:

- the request marker that the job was trying to satisfy

not:

- the wall-clock completion time

This preserves correctness if newer changes arrived while the job was running.

### Workflow Slice Meaning

| Workflow | `requestedAt` means | `settledAt` means |
|---|---|---|
| `enrichment` | New candidate-side enrichment work has been requested | Enrichment has satisfied work through that request marker |
| `matchSnapshotRefresh` | A fresher match snapshot has been requested | Match snapshot publication has satisfied work through that request marker |

---

## Early-Value Behavior And Derived Product Signals

### Early-Value Behavior

Fast first-value behavior should come from:

- scheduler timing
- current enrichment execution strategy
- immediate refresh invalidation when liked-song additions may already be matchable from shared cache
- later refresh invalidation only when enrichment makes new candidates available
- derived UI/read-model signals

This refactor does **not** require a separate `resultGoal` field on jobs.

### Derived Product Signal

The FE-facing question:

- "can we show the user a real match yet?"

should be represented as a **derived signal**, not persisted in `LibraryProcessingState`.

Recommended derived signal:

- `firstMatchReady`

Meaning:

- the latest published snapshot for the account is non-empty

### FE Update Path

In v1:

- derive `firstMatchReady` from the existing read model / server-function layer
- update the UI using the existing active-job polling + query invalidation pattern
- do not introduce new SSE just for this signal

---

## Change Source Contracts

### Exact `LibraryProcessingChange` Union

Use `kind` as the discriminant field.

```ts
type LibraryProcessingChange =
  | {
      kind: "onboarding_target_selection_confirmed";
      accountId: string;
    }
  | {
      kind: "library_synced";
      accountId: string;
      changes: {
        likedSongs: {
          added: boolean;
          removed: boolean;
        };
        targetPlaylists: {
          trackMembershipChanged: boolean;
          profileTextChanged: boolean;
          removed: boolean;
        };
      };
    }
  | {
      kind: "enrichment_completed";
      accountId: string;
      jobId: string;
      requestSatisfied: boolean;
      newCandidatesAvailable: boolean;
    }
  | {
      kind: "enrichment_stopped";
      accountId: string;
      jobId: string;
      reason: "local_limit" | "error";
    }
  | {
      kind: "match_snapshot_published";
      accountId: string;
      jobId: string;
    }
  | {
      kind: "match_snapshot_failed";
      accountId: string;
      jobId: string;
    };
```

These payloads are intentionally minimal. Request markers belong to the control plane and should be carried on the job/effect side, not copied into source changes.

### Onboarding

Current product understanding:

- onboarding target selection is an initial confirmation flow
- it is not the same as later target editing
- the user can also skip / confirm an empty target set

Library-processing contract:

- if onboarding initial confirmation results in **1+ selected targets** -> emit an onboarding library-processing change
- if onboarding confirms **0 selected targets / skip** -> emit **no** library-processing change
- after target confirmation, reconciliation should preserve current early-value behavior against the current library state rather than introducing onboarding-only durable milestone fields

### Sync

Library-processing contract:

- one sync request emits **one aggregated** library-processing change
- that change is source-shaped and backend-internal
- the change carries **no timestamp / request marker**
- all booleans are required
- all-false is a valid no-processing-change sync result
- target-side correctness depends on exact target track-membership changes
- sync remains responsible for ingestion and phase-job tracking, not direct follow-on scheduling policy

Public sync shape:

```ts
{
  kind: "library_synced",
  accountId: string,
  changes: {
    likedSongs: {
      added: boolean,
      removed: boolean,
    },
    targetPlaylists: {
      trackMembershipChanged: boolean,
      profileTextChanged: boolean,
      removed: boolean,
    },
  },
}
```

Notes:

- `targetPlaylists.removed` means a processing-relevant target-playlist removal
- the scheduler may consult current target existence when deciding whether `likedSongs.added` should also invalidate `matchSnapshotRefresh`

### Enrichment Worker Outcome

Library-processing contract:

- enrichment reports meaningful completion/stop changes back to the scheduler
- successful completion should carry:
  - `requestSatisfied`
  - `newCandidatesAvailable`
- stop reasons must distinguish at least:
  - `local_limit`
  - `error`
- the scheduler, not `EnrichmentChanges.*`, owns the target-existence gate for any refresh invalidation

### Match Snapshot Refresh Worker Outcome

Library-processing contract:

- match snapshot refresh reports publish/failure changes back to the scheduler
- jobs are single-pass; repeated passes are scheduler-owned
- success stays expressed in `publish` / `published` terms
- if refresh execution needs a tiny execution hint such as `needsTargetSongEnrichment`, that hint should be derived from current DB state when ensuring the job and should not become new durable control-plane state

### Execution Data-Plane Boundary

This refactor also needs one explicit execution/data-plane fix that is adjacent to, but separate from, the control-plane model.

Current issue in `src/lib/workflows/enrichment-pipeline/batch.ts`:

- batch selection computes large app-side exclusion sets of already-processed songs
- those IDs are sent to PostgREST via `.not("song_id", "in", ...)`
- large libraries can exceed URL limits
- the approach is also inefficient because it computes all processed songs and excludes them instead of directly selecting songs that still need work

Chosen direction:

- keep `library-processing` as the control plane
- replace app-side giant exclusion lists with DB-side selectors / RPCs in the enrichment execution layer
- directly select liked songs that still need enrichment
- keep refresh candidate loading aligned with a DB-side data-enrichment selector
- ideally fold terminal failures into the DB-side selector rather than passing them as an app-side exclusion list

This does **not** require new durable control-plane state. It is a workflow-local execution concern.

---

## Sync Case Mapping

This section focuses on **processing-relevant sync changes**.

### Liked-Song Changes

| Case | Intended Sync Change | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|---|
| Liked songs added and targets currently exist | `likedSongs.added = true` | Advance `enrichment.requestedAt`; advance `matchSnapshotRefresh.requestedAt` | No | Added songs may already be matchable immediately because refresh candidates are based on shared/global artifacts, not account-scoped completion alone. |
| Liked songs added and no targets currently exist | `likedSongs.added = true` | Advance `enrichment.requestedAt` only | No | Refresh invalidation is gated by current target existence in the scheduler. |
| Liked songs removed | `likedSongs.removed = true` | Advance `matchSnapshotRefresh.requestedAt` | No | Removed liked songs can invalidate the current published snapshot even if no enrichment is needed. |
| Liked songs added and removed in the same sync | `likedSongs.added = true`; `likedSongs.removed = true` | Carry both changes in one aggregated sync change | No | Combined case should stay explicit. |

### Exact Target-Side Changes

These should be represented as exact changes, not collapsed into broad metadata buckets.

| Case | Intended Sync Change | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|---|
| Target playlist track membership changed | `targetPlaylists.trackMembershipChanged = true` | Advance `matchSnapshotRefresh.requestedAt` | No | Current code only treats add/remove membership changes as meaningful here, not order-only changes. |
| Target playlist name changed | `targetPlaylists.profileTextChanged = true` | Advance `matchSnapshotRefresh.requestedAt` | No | Name participates in playlist profiling intent. |
| Target playlist description changed | `targetPlaylists.profileTextChanged = true` | Advance `matchSnapshotRefresh.requestedAt` | No | Description participates in playlist profiling intent. |
| Target playlist image changed | no public change | None | Yes | Image is cosmetic and should have no direct library-processing effect. |
| Target playlist song-count-only changed | no public change | None | Yes | Song-count-only change has no direct effect. Target-side correctness depends on exact track-membership changes, not summary fields. |
| Some target playlists removed | `targetPlaylists.removed = true` | Advance `matchSnapshotRefresh.requestedAt`; refresh remaining targets | No | Published snapshot may need to change even if no target songs were added/removed this sync. |
| All target playlists removed | `targetPlaylists.removed = true` | Advance `matchSnapshotRefresh.requestedAt`; publish empty state via current DB state | No | Public sync change does not carry a separate all-targets-removed boolean. That distinction can be derived later from current target state. |

### Explicit No-Effect Sync Cases

| Case | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|
| Non-target playlist created/updated/removed only | None | Yes | Should stay outside library-processing unless target selection later changes. |
| Non-target playlist track changes only | None | Yes | Current code already ignores these for refresh. |
| Target playlist order-only track changes | None under current assumptions | Yes | If profiling later becomes order-sensitive, revisit this. |
| Sync completed with no processing-relevant changes | None | Yes | Still emit the aggregated sync change, but all booleans remain false. |

### Combined Target-Side Scenarios That Must Stay Supported

| Scenario | Intended Handling |
|---|---|
| Target track changes + liked-song additions | One aggregated sync change carries both changes |
| Target profile-text changes + liked-song removals | One aggregated sync change carries both changes |
| Some targets removed while others remain | Refresh remaining targets, not empty state |
| Candidate-side and target-side changes together | Scheduler receives one combined change set and reconciles both workflows |

---

## Onboarding Case Mapping

| Case | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|
| Initial target selection confirmed with 1+ targets | Emit onboarding library-processing change; preserve current early-value behavior by reconciling against current library state | No | This stays onboarding-specific and should not be modeled as a generic edit/removal event. |
| Initial target selection confirmed with 0 targets / skip | None | Yes | This remains an onboarding concern, not a library-processing change. |
| Later target removal/edit outside onboarding | Not an onboarding case | N/A | Belongs to later non-onboarding change sources. |

---

## Enrichment Worker Outcome Mapping

| Case | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|
| `completed` with `requestSatisfied = false` and `newCandidatesAvailable = false` | Leave `enrichment` stale; clear/update `activeJobId`; do not invalidate `matchSnapshotRefresh` | No | Successful chunk, but more enrichment is still owed and no new refresh candidates appeared. |
| `completed` with `requestSatisfied = false` and `newCandidatesAvailable = true` | Leave `enrichment` stale; clear/update `activeJobId`; if targets currently exist, advance `matchSnapshotRefresh.requestedAt` | No | Early refresh is allowed because a fresher snapshot may now exist even though enrichment is not yet fully satisfied. |
| `completed` with `requestSatisfied = true` and `newCandidatesAvailable = false` | Set `enrichment.settledAt` to the request marker the job satisfied; clear `activeJobId`; do not invalidate `matchSnapshotRefresh` | No | Requested enrichment work is satisfied, but no new refresh candidates were created by this pass. |
| `completed` with `requestSatisfied = true` and `newCandidatesAvailable = true` | Set `enrichment.settledAt` to the request marker the job satisfied; clear `activeJobId`; if targets currently exist, advance `matchSnapshotRefresh.requestedAt` | No | Enrichment is satisfied for this marker and the candidate set improved. |
| `stopped` with `reason = local_limit` | Do not advance `settledAt`; clear/update `activeJobId`; leave workflow stale if requested work remains | No | `local_limit` is a local/testing stop, not a product success state. |
| `stopped` with `reason = error` | Do not advance `settledAt`; clear/update `activeJobId`; reconcile retry/error handling separately | No | Exact retry/error policy can be finalized during implementation. |

---

## Match Snapshot Refresh Worker Outcome Mapping

| Case | Intended Library-Processing Effect | No Effect? | Notes |
|---|---|---|---|
| `published` after a successful refresh attempt | Set `matchSnapshotRefresh.settledAt` to the request marker the job was satisfying; clear `activeJobId` | No | This is the durable success condition for refresh freshness. The publish attempt may or may not have written a new snapshot row; settlement still tracks successful satisfaction of the request marker. |
| `published` with a non-empty latest snapshot | Derived `firstMatchReady` becomes true | No | This is the first real match the user can be shown, but it remains a read-model/UI signal rather than core state. |
| `published` with explicit empty state because no targets remain | Still a successful settlement for the request marker | No | Important special case. Empty state is still a valid fresh snapshot. |
| `failed` | Do not advance `settledAt`; clear/update `activeJobId`; reconcile retry/error handling separately | No | Exact retry/error policy can be finalized during implementation. |

---

### Failure Handling In V1

For this refactor, failure handling should stay bounded:

- on `enrichment_stopped` with `reason = error`, clear `activeJobId`, do not advance `settledAt`, and leave the workflow stale
- on `match_snapshot_failed`, clear `activeJobId`, do not advance `settledAt`, and leave the workflow stale
- do **not** auto-reensure immediately as part of this refactor

This keeps the freshness model correct without forcing retry policy into the first cut.

---

## Working Assumptions

These assumptions are currently guiding the mapping and should be revisited if product behavior changes:

1. Source changes should stay source-shaped and backend-internal.
2. One sync request always emits one aggregated `library_synced` change, even when all booleans are false.
3. Liked-song additions can invalidate `matchSnapshotRefresh` immediately when targets exist because refresh candidates may already be available from shared cache.
4. Enrichment should only re-invalidate `matchSnapshotRefresh` when `newCandidatesAvailable` is true.
5. The scheduler, not source helpers, owns target-existence gates for refresh invalidation.
6. `local_limit` is a local/testing tool, not product behavior.
7. Name and description are profile-relevant target-side changes and are intentionally aggregated into `profileTextChanged` in the public sync change.
8. Image and song-count-only changes have no direct library-processing effect.
9. Target-side correctness depends on exact target track-membership changes rather than summary fields.
10. The current enrichment chunk progression is an execution strategy, not an architecture contract.
11. Enrichment candidate selection should move to DB-side selectors that directly find songs still needing work rather than building app-side giant exclusion lists.
12. The data-enrichment selector for match snapshot refresh should preserve current semantics by omitting the account-scoped `item_status` requirement.

---

## Open Decisions To Resolve

1. **What should the generic job request-marker column be named?**  
   We have aligned on the concept and scope, but not the final column name.

2. **What should the minimal measurement table be named and how should retention be handled?**  
   The grain and payload shape are aligned, but storage details remain open.

3. **What exact SQL/RPC shape should the DB-side enrichment selectors take, and should terminal-failure exclusion be folded in on the first pass?**  
   The architectural direction is aligned, but the exact selector/query shape still needs to be finalized during implementation.
