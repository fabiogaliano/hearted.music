## Why

This follows the active `connect-matching-pipeline-to-ui` work and addresses the remaining first-run profiling gap.

This change is **not** meant to define the only playlist profiling mode. It introduces one low-cost bootstrap mode within a broader profiling strategy that can later also support:

- `playlist_only` profiling built strictly from playlist-member songs, including analysis-backed signals
- a combined profiling mode that uses both playlist-member song signals and playlist text

The current enrichment pipeline now runs after sync, but destination playlist profiles are still starved on first run:

- `playlist_profiling` runs before the current pipeline run has created any new song embeddings
- it reads destination playlist-member songs, not just the liked-song batch
- those playlist-member songs usually have no audio features, genres, or embeddings yet

As a result, `playlist_profile` rows are often persisted with `embedding: null`, `audio_centroid: {}`, and `genre_distribution: {}`. Matching then has little or no usable playlist-side signal.

There is also a cache issue: playlist profile reuse is currently keyed too narrowly, so newly available bootstrap inputs can fail to invalidate stale empty profiles.

## What Changes

- **Playlist-member free-signal bootstrap**: backfill missing audio features and genres for destination playlist members inside the existing `playlist_profiling` stage
- **Description embedding fallback**: when no member-song embedding centroid exists, use normalized playlist `name + description` text via the existing `EmbeddingService.embedText(..., { prefix: "passage:" })`
- **Stronger cache invalidation**: derive the playlist profile fingerprint from the actual inputs that shape the profile and bump the playlist-profile version
- **Regression coverage**: add tests for first-run bootstrap, cache invalidation on description/input changes, and cache reuse when inputs are unchanged

This change specifically covers the **description-assisted bootstrap mode**. It must be implemented so future `playlist_only` and combined modes can coexist without reworking the pipeline contract.

### Out of scope

- Running `song_analysis` or `song_embedding` on playlist-member songs
- Changing matching weights or score aggregation
- UI changes
- Adding a persistent `playlist_profile.method` column
- Fully specifying or implementing `playlist_only` and combined profiling modes

## Affected specs

- `matching-pipeline`

## Capabilities

### Modified Capabilities

- **matching-pipeline**: destination playlist profiles can bootstrap from free member-song enrichment and playlist description text when song-derived embeddings are absent, and profile caching must invalidate when those bootstrap inputs change while leaving room for future `playlist_only` and combined profiling modes

## Impact

- **Playlist profiling stage**: `src/lib/workflows/enrichment-pipeline/stages/playlist-profiling.ts`
- **Playlist profiling service**: `src/lib/domains/taste/playlist-profiling/service.ts`
- **Playlist profiling types**: `src/lib/domains/taste/playlist-profiling/types.ts`
- **Versioning**: `src/lib/domains/enrichment/embeddings/versioning.ts`
- **Regression tests**: `src/lib/domains/taste/playlist-profiling/__tests__/playlist-profiling-integration.test.ts`, `src/lib/workflows/enrichment-pipeline/__tests__/orchestrator.test.ts`, `src/lib/workflows/enrichment-pipeline/__tests__/pipeline.integration.test.ts`
