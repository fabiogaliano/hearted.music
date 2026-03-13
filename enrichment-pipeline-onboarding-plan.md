# Enrichment Pipeline Onboarding Plan

## Goal

Reshape the enrichment pipeline around the real onboarding product flow instead of one hardcoded end-to-end orchestration path.

The immediate goal is not to design a generic workflow engine. It is to make onboarding behavior clear and durable:

- sync can start song-side enrichment immediately
- destination-dependent work waits until the user selects playlists
- playlist save does not need to block the UI from advancing to the next onboarding step
- matching runs should dedupe identical inputs instead of appending duplicate contexts

## Confirmed Current Behavior

### UI flow

The onboarding playlists step currently:

1. calls `savePlaylistDestinations()`
2. then immediately calls `goToStep("ready", { syncStats })`

This means the UI already treats playlist selection as the user milestone and does not require recommendations to exist before moving forward.

### Server flow

`savePlaylistDestinations()` currently:

1. updates destination playlist flags
2. if at least one destination is selected, awaits `runEnrichmentPipeline(accountId)`
3. returns success

So the current server behavior is stricter than the actual UI requirement.

## Agreed Domain Decisions

### Item status

`item_status` remains user-review / user-action state only.

It should not be used to mean "matching completed".

### Match context meaning

A `match_context` should represent one matching computation for one exact input state.

It is best treated as a cacheable snapshot, not:

- the single current truth for the account
- a pure append-only history log for every rerun

### Duplicate runs

Identical matching runs should collapse / dedupe.

If the relevant inputs are unchanged, a retry or duplicate trigger should reuse the same matching context instead of creating a new one.

### Playlist reselection

When the selected playlist set changes, the old context is no longer current for that playlist set.

It can remain stored as reusable cache, but it should not be treated as the active result for the new selection.

### Clearing destinations

If the user clears all destination playlists:

- do not run destination profiling or matching
- do not delete previously stored matching contexts/results

Persisted contexts can remain available for future reuse if the same selection is restored later.

### Zero liked songs

For onboarding, destination profiling and matching should be skipped when there are no liked songs worth matching.

Even though playlist profiling is technically independent, there is no product value in computing it during onboarding if there are no candidate liked songs.

## Dependency Notes

The real dependency chain on the song side is:

`song_analysis -> song_embedding -> matching`

Important implications:

- `playlist_profiling` does not depend on liked-song LLM analysis
- `matching` does depend on song embeddings
- song embeddings currently depend on song analysis being present

For onboarding this is acceptable because sync currently waits for song-side enrichment before the user reaches playlist selection.

## Recommended Onboarding Execution Shape

### 1. Sync step

Run song-side enrichment only:

- `audio_features`
- `genre_tagging`
- `song_analysis`
- `song_embedding`

Do not treat missing destination playlists as a problem during this step.

### 2. Playlist selection step

When the user confirms destination playlists:

1. persist playlist destination flags
2. advance onboarding to the next step immediately
3. trigger destination-dependent work as follow-on internal processing

The onboarding step transition should not depend on matching finishing successfully.

### 3. Destination-dependent follow-on work

After playlist save, run only the destination side:

- destination playlist profiling
- matching

Skip this follow-on work when:

- no destination playlists are selected
- there are no liked songs / candidate songs to match

### 4. Matching behavior

Matching should only proceed when required song-side prerequisites are ready.

For onboarding, this should usually be true because sync runs first, but the matching step should still be written defensively.

## Matching Persistence Direction

The current pipeline matching path creates a fresh context using a time-based hash, which makes retries and repeated triggers append duplicate contexts.

The desired direction is:

- compute a deterministic matching identity from the relevant inputs
- reuse an existing context when those inputs are identical
- create a new context only when the actual matching inputs change

Relevant identity inputs should include at least:

- account id
- selected destination playlist set
- candidate liked-song set being matched
- matching-relevant config
- model / version inputs that affect the result

## Minimal Architectural Direction

Keep the redesign product-driven and small.

Preferred shape:

- `runSongEnrichment(accountId)`
- `runDestinationProfiling(accountId)`
- `runMatching(accountId)`

Notes:

- `runMatching()` should fetch what it needs instead of depending on playlist data being ferried through the orchestrator
- no generic DAG / registry / recipe system is needed for this step
- the split is justified by different trigger times in the product, not by abstract workflow theory

## Nice-to-Have, Not Required Immediately

A `blocked` stage status may still be useful for cases where matching is triggered but prerequisites are not ready yet.

This is not required to make the onboarding flow sane, but it would express intent better than overloading `skipped`.

## Explicitly Deferred

These do not need to be fully defined for the onboarding refactor:

- post-onboarding manual Sync button behavior
- recommendation UI behavior for inactive / cleared destination sets
- zero-liked-songs onboarding UX details beyond skipping destination-dependent work
- long-term cleanup / GC policy for stale cached contexts

## Implementation Priorities

### Priority 1

Split onboarding behavior conceptually:

- sync runs song enrichment
- playlist save triggers destination-side work

### Priority 2

Stop requiring playlist save to behave like a full pipeline completion barrier.

### Priority 3

Make matching idempotent for identical inputs.

### Priority 4

Only after the above, define how future manual sync should retrigger matching outside onboarding.
