## 1. Orchestrator split by trigger boundary

- [x] 1.1 Refactor `src/lib/workflows/enrichment-pipeline/orchestrator.ts` to expose `runSongEnrichment(accountId, options?)`, `runDestinationProfiling(accountId)`, and `runMatching(accountId, options?)`
- [x] 1.2 Extract or centralize shared helpers for batch-size resolution, embedding-service bootstrap, enrichment context creation, and stage job ID aggregation
- [x] 1.3 Rewrite `runEnrichmentPipeline(accountId, options?)` as sequential composition of the trigger-scoped entry points while preserving backward-compatible full-pipeline semantics
- [x] 1.4 Ensure the compatibility wrapper keeps destination-dependent skips explicit and does not run destination profiling when there are zero liked-song candidates

## 2. Deterministic matching identity

- [x] 2.1 Refactor `src/lib/workflows/enrichment-pipeline/stages/matching.ts` so matching identity is computed before `runTrackedStageJob`
- [x] 2.2 Reuse or extract the authoritative playlist/candidate/config/model hashing primitives from `src/lib/domains/taste/song-matching/cache.ts` or a shared helper
- [x] 2.3 Call `getMatchContextByHash(contextHash, accountId)` before creating a tracked matching job and return a no-op stage result when the same context already exists
- [x] 2.4 Replace hardcoded matching version strings with `MATCHING_ALGO_VERSION`
- [x] 2.5 Preserve explicit skip behavior for no destination playlists, no ready candidate songs, or missing prerequisites

## 3. Onboarding destination save decoupling

- [x] 3.1 Update `src/lib/server/onboarding.functions.ts` to import `runDestinationProfiling` and `runMatching` instead of the full pipeline entry point
- [x] 3.2 In `savePlaylistDestinations()`, return early when no destination playlists are selected
- [x] 3.3 In `savePlaylistDestinations()`, return early when `getLikedSongCount()` is zero
- [x] 3.4 Trigger destination profiling and matching after a successful save without making onboarding progression wait for destination-side completion
- [x] 3.5 Use the simplest follow-on execution mechanism that is actually reliable in this app/runtime and log or track failures without rolling back the save

## 4. Sync trigger boundary correction

- [x] 4.1 Update `src/routes/api/extension/sync.tsx` to call `runSongEnrichment(accountId, options?)` instead of `runEnrichmentPipeline(accountId, options?)`
- [x] 4.2 Ensure the sync follow-on path runs only `audio_features`, `genre_tagging`, `song_analysis`, and `song_embedding`
- [x] 4.3 Ensure sync no longer triggers destination profiling or matching

## 5. Testing and verification

- [x] 5.1 Update orchestrator tests to cover trigger-scoped entry points and backward-compatible wrapper behavior
- [x] 5.2 Add or update matching tests to cover identical rerun dedupe and fresh context creation when relevant inputs change
- [x] 5.3 Add integration coverage for sync running only song-side stages
- [x] 5.4 Add integration or manual verification coverage that destination save returns quickly and onboarding advances to `ready` without waiting for destination-side completion
- [x] 5.5 Run `bun run typecheck`
- [x] 5.6 Run `bun run test`
- [ ] 5.7 Manually verify that saving the same playlist selection twice does not create duplicate `match_context` rows, while changing relevant matching inputs does create a new context
