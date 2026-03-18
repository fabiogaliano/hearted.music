## Context

Playlist profiles are computed in `PlaylistProfilingService.computeProfile()` (`src/lib/domains/taste/playlist-profiling/service.ts:78`). The embedding centroid is currently the mean of all song embeddings in the playlist. Name/description text is only embedded as a fallback when no songs have embeddings (line 147).

The matching algorithm in `MatchingService.scoreSongToPlaylist()` (`src/lib/domains/taste/song-matching/service.ts:226`) computes cosine similarity between a song's embedding and the playlist profile's embedding centroid. It has no knowledge of playlist metadata — it only sees the profile.

This means the change is entirely contained within profiling. The matching algorithm consumes a richer profile without knowing how it was built.

**Key integration points:**
- `computeProfile()` — where the blend happens
- `calculations.ts` — where pure functions live (`calculateCentroid`, `calculateAudioCentroid`, `computeGenreDistribution`)
- `hashing.ts:hashPlaylistProfile()` — where the content hash previously gated intent text on `songCentroid.length === 0`
- `EmbeddingService.embedText()` — already public, supports arbitrary text with prefix selection

## Goals / Non-Goals

**Goals:**
- Blend playlist name/description semantic meaning into the profile embedding centroid
- Weight the blend adaptively: heavier intent for sparse/new playlists, lighter for established ones
- Boost intent weight when description exists (richer signal than name alone)
- Ensure name/description changes invalidate cached profiles and trigger re-matching
- Preserve all existing matching behavior for playlists where intent doesn't change scores

**Non-Goals:**
- Changing the matching algorithm or adding a 4th scoring factor
- Changing `ScoreFactors`, `MatchingWeights`, or `MatchingConfig` types
- Adding user-configurable intent weights (internal implementation detail)
- Changing the 3-signal weight distribution (embedding 0.5, audio 0.3, genre 0.2)
- Storing name embeddings separately from the profile — the blend result replaces the centroid

## Decisions

### D1: Blend into centroid, not a 4th scoring factor

**Choice:** Weighted-average the intent embedding into the song centroid during profiling.

**Alternative considered:** Add `nameAffinity` as a 4th factor in `scoreSongToPlaylist()`.

**Rationale:** The profiling approach requires zero type changes (`ScoreFactors`, `MatchingWeights`, `DataAvailability`, `MatchingConfig` all untouched), zero matching algorithm changes, and zero caller changes. The 4th factor approach would modify types across 5+ files and require retuning all weight distributions. The profile IS what the playlist is — and what it is includes its stated intent.

### D2: Use `passage:` prefix for intent embedding

**Choice:** Embed name/description with `{ prefix: "passage:" }`.

**Alternative considered:** Use `query:` prefix since the name is semantically a "query" (what songs should match this?).

**Rationale:** The blended centroid is compared against song embeddings (all `passage:`-prefixed) via cosine similarity. E5 models are trained with prefix-aware contrastive loss — mixing `query:` and `passage:` vectors in a centroid produces a semantically undefined hybrid. Using `passage:` keeps the entire centroid in the same embedding subspace.

### D3: Accept separate `name`/`description` fields, compute weight internally

**Choice:** `ProfilingOptions` accepts `name?: string` and `description?: string` as separate fields. `computeProfile()` combines them into intent text internally and derives `hasDescription` from `!!options.description`. `computeIntentWeight(songCount, hasDescription)` is a pure function inside `calculations.ts`.

**Alternatives considered:** (a) `IntentBlendConfig` type passed by the caller, (b) single `descriptionText` string with `hasDescription` boolean, (c) inferring description presence by parsing a separator in the combined string.

**Rationale:** Separate fields are the cleanest API — the caller passes what it has (`playlist.name`, `playlist.description`), the service owns the combination logic. No string parsing, no redundant booleans, no coupling to join format.

### D4: L2-normalize before and after blending

**Choice:** Normalize both vectors to unit length before weighted average, then re-normalize the result.

**Rationale:** Song centroids (mean of many vectors) have lower magnitude (~0.6-0.8) than single intent embeddings (~0.9-1.0). Without normalization, the weight parameter doesn't accurately control semantic influence — the higher-magnitude vector dominates beyond its assigned weight. This is well-established in embedding centroid literature.

### D5: Intent weight formula with floor

```typescript
const decay = Math.max(0, 1.0 - songCount / 30);
const weight = BASE_WEIGHT * descBoost * decay;
const floor = hasDescription ? 0.30 : 0.15;
return Math.max(floor, Math.min(1.0, weight));
```

Constants: `BASE_WEIGHT = 0.35`, `DESC_BOOST = 1.5`, maturity threshold = 30 songs, floor with description = 0.30, floor name-only = 0.15.

**Key properties:**
- Intent weight never reaches 0 — user named the playlist deliberately
- Description presence boosts weight by 50% (richer, more deliberate signal)
- Smooth decay rather than tiers — no discontinuities
- 0-song case handled by `blendEmbeddings` short-circuit (returns intent vector directly), not the weight function

### D6: Always include intent text in content hash

**Choice:** Remove the `songCentroid.length === 0` guard in `computeProfile()`. The service combines `name` + `description` into `intentText` and passes it as `descriptionText` to `hashPlaylistProfile()` unconditionally.

**Rationale:** Name changes must invalidate the profile. The old guard suppressed intent text from the hash when songs exist, meaning a rename produced the same hash → no re-profile → no re-match.

## Risks / Trade-offs

**[All cached profiles become misses on deploy]** → Self-healing. No migration needed — profiles recompute on next pipeline run with the new blended embedding. One-time cost.

**[One extra `embedText()` call per playlist per profiling run]** → Negligible. Short text (name + description, ~10-30 tokens), single API call to DeepInfra. For 30 playlists, adds ~1-2 seconds total to batch profiling.

**[Matching scores shift for all playlists]** → Expected and desired. Playlists with evocative names will attract semantically aligned songs more strongly. Existing match_decision rows remain valid (they reference the old match, not the new one).

**[Misnamed playlists produce compromised centroids]** → Correct behavior. A "chill vibes" playlist full of death metal SHOULD produce weaker matches — the playlist identity is confused. The user should rename it or update the description.

**[Weight formula may need tuning]** → Constants are named and co-located in `calculations.ts`. Easy to adjust without architectural changes.
