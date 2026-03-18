## 1. Pure calculation functions

- [x] 1.1 Add `blendEmbeddings(songCentroid, intentEmbedding, intentWeight)` to `src/lib/domains/taste/playlist-profiling/calculations.ts` — L2-normalize both inputs, weighted average, re-normalize result. Short-circuit: return the other vector if either input is empty/null.
- [x] 1.2 Add `computeIntentWeight(songCount, hasDescription)` to `src/lib/domains/taste/playlist-profiling/calculations.ts` — smooth decay formula with named constants (`INTENT_BASE_WEIGHT`, `INTENT_DESC_BOOST`, `INTENT_MATURITY_THRESHOLD`, `INTENT_FLOOR_WITH_DESC`, `INTENT_FLOOR_NAME_ONLY`).
- [x] 1.3 Unit tests for `blendEmbeddings`: empty song centroid returns intent, null intent returns centroid, weight=0 returns centroid, weight=1 returns intent, normalization correctness, different-magnitude inputs produce weight-accurate blend.
- [x] 1.4 Unit tests for `computeIntentWeight`: floor enforcement (name-only 0.15, with-desc 0.30), decay curve at 0/5/10/20/30+ songs, description boost factor.

## 2. Content hash update

- [x] 2.1 In `computeProfile()`, remove the `songCentroid.length === 0` guard so intent text is always passed to `hashPlaylistProfile()`. The service combines `options.name` + `options.description` into `intentText` and passes it as `descriptionText` to the hash function.

## 3. Profile computation — intent blending

- [x] 3.1 Change `ProfilingOptions` to accept separate `name?: string` and `description?: string` fields instead of `descriptionText`. The service combines them internally and derives `hasDescription` from `!!options.description`.
- [x] 3.2 In `computeProfile()`, always embed intent text when `name` or `description` exists — move the `embedText()` call out of the `songCentroid.length === 0` guard. Use `{ prefix: "passage:" }`.
- [x] 3.3 Replace the current fallback logic with `blendEmbeddings(songCentroid, intentEmbedding, computeIntentWeight(...))`. The blend function's short-circuit handles the 0-song case (returns intent embedding directly).
- [x] 3.4 Update caller in `stages/playlist-profiling.ts` to pass `{ name: playlist.name, description: playlist.description }` instead of constructing `descriptionText`.

## 4. Integration verification

- [x] 4.1 Smoke test: profile a playlist with name + description + songs, verify the embedding centroid differs from a pure song centroid (not null, not identical to song-only centroid).
- [x] 4.2 Smoke test: profile an empty playlist with name + description, verify it produces a non-null embedding (intent-only).
- [x] 4.3 Verify content hash changes when description text changes (same songs, different name → different `contentHash`).
