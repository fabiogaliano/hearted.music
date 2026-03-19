## Why

Playlist names and descriptions carry strong semantic intent — "crying in the car," "revenge era," "sunday softness" — but the matching algorithm ignores them entirely. Profile embeddings are computed purely from song content (centroid of song embeddings). Name/description is only used as a desperation fallback for empty playlists. This means a newly created playlist with a rich description attracts songs no better than an unnamed one, and the product's core promise — that playlist *intent* drives matching — isn't reflected in the algorithm.

Spotify's own Text2Tracks research (2025) validates that text-semantic matching from playlist descriptions to songs is a high-quality signal, outperforming title-based approaches by 48%. The E5 embedding model already in use is specifically designed for this kind of text-to-document semantic matching.

## What Changes

- Playlist profiles blend an "intent embedding" (from name + description) into the song-derived centroid, weighted by playlist maturity and description richness
- The intent embedding is **always** computed when profiling (not just as a fallback for empty playlists)
- A smooth weight formula controls how much intent vs content influences the profile: high for new/sparse playlists, lower (but never zero) for established ones
- Description presence boosts intent weight — descriptions are richer, more deliberate signals than names alone
- Content hash includes intent text unconditionally, so name/description changes invalidate cached profiles and trigger re-matching
- Vectors are L2-normalized before blending and re-normalized after, ensuring weight parameters accurately control semantic influence

## Capabilities

### New Capabilities

_(none — this enhances an existing capability)_

### Modified Capabilities

- `matching-pipeline`: Playlist Profiling requirement changes — embedding centroid is now a blend of song centroid + intent embedding rather than pure song centroid. Cache invalidation scenario gains intent text as an invalidation trigger. Weight aggregation defaults shift to accommodate the richer embedding signal.

## Impact

- **Code**: `src/lib/domains/taste/playlist-profiling/` (service + calculations), `src/lib/domains/enrichment/embeddings/hashing.ts`
- **API cost**: One additional `embedText()` call per playlist per profiling run (short text, negligible cost)
- **Cache**: All existing playlist profiles become cache misses on first run (content hash changes). Self-healing — no migration needed.
- **Matching behavior**: Scores will shift for all playlists. Playlists with evocative names/descriptions will attract semantically aligned songs more strongly. Empty playlists with descriptions become immediately useful for matching.
- **P1-5 validation**: The "always create rematch job on sync" behavior is confirmed correct — name/description changes now affect profiles, so the worker must always re-evaluate.
