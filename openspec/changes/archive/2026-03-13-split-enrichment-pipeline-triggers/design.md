## Context

The current enrichment workflow is centered on a monolithic `runEnrichmentPipeline()` call that executes all six stages regardless of why it was triggered.

That shape is now misaligned with the product:

- extension sync needs only song-side enrichment so freshly synced liked songs become analysis-ready
- onboarding destination save needs only destination-side work after playlist selection changes
- the UI already advances to `ready` immediately after saving destination playlists, so waiting for destination profiling and matching inside the same request adds latency without adding product value
- matching retries create duplicate `match_context` rows because the pipeline stage uses a timestamp-based context identity

The implementation should keep the behavioral change small:

- split orchestration by trigger boundary
- preserve a backward-compatible full-pipeline wrapper for existing callers
- reuse the richer cache-first matching hashes instead of inventing a second source of truth
- keep destination-dependent skips explicit rather than turning them into failures

## Goals / Non-Goals

**Goals:**
- align orchestration entry points with the two real product triggers
- keep `runEnrichmentPipeline()` available as a compatibility wrapper
- make pipeline-triggered matching idempotent for same-input reruns
- let destination playlist save return success without waiting for destination-side completion
- ensure sync no longer runs destination profiling or matching

**Non-Goals:**
- redesigning the onboarding UI
- changing matching weights or ranking semantics
- introducing a full distributed job system if the current runtime already supports reliable follow-on work
- solving playlist-profile bootstrap quality gaps from sparse first-run inputs

## Decisions

### 1. Split orchestration into trigger-scoped entry points

**Decision:** The orchestrator exposes three product-aligned functions:

- `runSongEnrichment(accountId, options?)`
- `runDestinationProfiling(accountId)`
- `runMatching(accountId, options?)`

`runEnrichmentPipeline(accountId, options?)` remains available and composes these three functions sequentially.

**Rationale:** The current two triggers do not need the same work. Sync needs the four liked-song stages, while destination save needs only playlist profiling and matching. Splitting the entry points makes the trigger contract explicit without forcing all callers to migrate immediately.

**Implications:**
- existing internal callers can remain on `runEnrichmentPipeline()` during the refactor
- new or updated trigger call sites should select the narrowest entry point for their product boundary
- orchestration helpers should stay centralized so the split does not duplicate bootstrap logic

### 2. Keep shared pipeline bootstrap in the orchestrator

**Decision:** Shared helpers remain centralized in `orchestrator.ts`, including:

- `resolveBatchSize(options?)`
- `initEmbeddingService()`
- `buildContext(accountId, embeddingService)`
- `collectStageJobIds(stages)`

**Rationale:** The trigger split changes orchestration boundaries, not the underlying stage runtime model. Centralizing shared setup preserves one authoritative path for batch sizing, embedding bootstrapping, stage context creation, and result aggregation.

**Implications:**
- `runSongEnrichment()` and `runMatching()` can share batch selection behavior without diverging
- the compatibility wrapper can preserve the old result shape while delegating to the new entry points
- destination-dependent skips remain explicit in the stage results instead of being hidden as bootstrap failures

### 3. Sync only triggers song-side enrichment

**Decision:** `POST /api/extension/sync` triggers only the song-side follow-on stages:

- `audio_features`
- `genre_tagging`
- `song_analysis`
- `song_embedding`

It does not trigger `playlist_profiling` or `matching`.

**Rationale:** Sync has no reason to block on destination-side work because destination playlists may not be selected yet, and profiling/matching belong to a different product moment.

**Implications:**
- sync remains the trigger that enriches liked-song candidates
- destination-specific work is deferred until onboarding destination selection exists
- tests should verify that sync no longer creates destination-side stage activity

### 4. Destination playlist save is not a destination-work barrier

**Decision:** `savePlaylistDestinations()` returns success once the playlist flags are persisted. Destination-side follow-on work runs only when it is meaningful:

- skip immediately if zero destination playlists are selected
- skip immediately if the account has zero liked songs to match
- otherwise trigger destination profiling followed by matching without blocking onboarding progression to `ready`

**Rationale:** The user-visible success event is the saved selection, not completion of downstream enrichment. Blocking the response on destination-side work adds latency but does not change the UI contract.

**Implementation constraint:** The follow-on execution mechanism must be the simplest option that is actually reliable in this runtime. A naive fire-and-forget pattern is acceptable only if request completion does not terminate the work prematurely; otherwise the implementation should hand off to an existing durable mechanism.

**Implications:**
- destination-side failures should be logged or tracked without rolling back the successful save
- onboarding progression semantics remain immediate
- follow-on work should not rerun song-side stages

### 5. Matching identity reuses cache-equivalent hashing

**Decision:** The matching stage computes deterministic context metadata before calling `runTrackedStageJob`. The metadata must reuse or extract the same authoritative hashing direction already used by the cache-first matching path.

`contextHash` is derived from:

- `playlistSetHash` based on playlist/profile inputs that affect results
- `candidateSetHash` based on matching-relevant candidate content
- matching configuration hash
- model/version hash

The stage uses `MATCHING_ALGO_VERSION` instead of a hardcoded version string.

**Rationale:** The current timestamp-based hash defeats idempotency and creates duplicate `match_context` rows on retried pipeline runs. Reusing the cache-first hashing primitives keeps one source of truth for what constitutes a materially different matching input set.

**Implications:**
- identical reruns short-circuit before creating a tracked matching job
- changed playlist membership, playlist profiles, candidate data, config, or model/version produce a new context hash naturally
- the matching stage should call `getMatchContextByHash(contextHash, accountId)` before context creation

### 6. Matching remains defensive and skip-oriented

**Decision:** Matching continues to treat missing prerequisites as explicit skip conditions rather than hard failures.

Skip conditions include:

- no selected destination playlists
- no destination playlists with usable profiles
- no candidate songs ready for matching
- missing prerequisite enrichment needed to compute matches

**Rationale:** The refactor is about boundary alignment and idempotency, not stricter failure semantics. Skipping keeps reruns safe while inputs are still catching up.

**Implications:**
- matching should not use `item_status` as a proxy for “matching completed”
- the stage result should distinguish real failures from “nothing to do yet”
- a future `blocked` status can be introduced later without changing this trigger split

## Data flow

```text
POST /api/extension/sync
  → Phase 1: liked songs sync
  → Phase 2: playlists sync
  → Phase 3: playlist tracks sync
  → runSongEnrichment(accountId, options?)
      → selectPipelineBatch(accountId, batchSize)
      → audio_features
      → genre_tagging
      → song_analysis
      → song_embedding
  → Response returns without destination profiling or matching

savePlaylistDestinations(accountId, playlistIds)
  → persist destination flags
  → update onboarding progression to ready
  → if no selected destinations: return
  → if liked-song count is zero: return
  → trigger destination-side follow-on work
      → runDestinationProfiling(accountId)
      → runMatching(accountId, options?)
  → Response does not wait for destination-side completion

runEnrichmentPipeline(accountId, options?)
  → runSongEnrichment(accountId, options?)
  → runDestinationProfiling(accountId)
  → runMatching(accountId, options?)
```

## Risks / Trade-offs

**[Post-response reliability]** → The change requires a follow-on execution strategy that actually survives request completion in the current runtime. The implementation should stay minimal, but not at the expense of dropped destination-side work.

**[Hash breadth changes cache behavior]** → Reusing richer playlist/candidate hashing may produce more context splits than the current timestamp approach seems to, but that is the correct trade-off because only materially different inputs should create new contexts.

**[Wrapper/result compatibility]** → Keeping `runEnrichmentPipeline()` reduces migration risk, but the wrapper must preserve explicit skip semantics and avoid accidentally profiling destinations when there are zero liked-song candidates.

## Open Questions

None. The only implementation choice left open is which reliable follow-on execution mechanism is simplest in the current runtime.
