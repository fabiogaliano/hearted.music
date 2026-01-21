# Change: Add Matching Pipeline Services (Phases 4e-4g)

## Why

The matching pipeline is the **core business logic** that enables sorting liked songs into destination playlists. Without it, the app can analyze songs but cannot actually sort them. Phases 4e (Matching), 4f (Genre Enrichment), and 4g (Playlist Profiling) represent the remaining services needed to complete the v2 migration's service layer.

These services exist in `old_app/lib/services/` with ~5,000 lines of production-tested code implementing:
- Multi-factor scoring (vector similarity, semantic, audio features, genre alignment)
- Cache-first patterns with content hashing for invalidation
- Last.fm integration for genre enrichment
- Playlist profiling with embedding centroids and feature distributions

## What Changes

### Phase 4f: Genre Enrichment (Foundation Layer)

Port Last.fm integration for enriching songs with canonical genres.

| Source File                                            | Target Location                            | Lines | Purpose                                 |
| ------------------------------------------------------ | ------------------------------------------ | ----- | --------------------------------------- |
| `old_app/lib/services/lastfm/LastFmService.ts`         | `src/lib/integrations/lastfm/service.ts`   | 311   | Last.fm API client with rate limiting   |
| `old_app/lib/services/lastfm/utils/genre-whitelist.ts` | `src/lib/integrations/lastfm/whitelist.ts` | 469   | 469-genre canonical taxonomy            |
| `old_app/lib/services/lastfm/utils/normalize.ts`       | `src/lib/integrations/lastfm/normalize.ts` | 81    | Artist/album name normalization         |
| `old_app/lib/services/genre/GenreEnrichmentService.ts` | `src/lib/capabilities/genre/service.ts`    | 477   | DB-first genre enrichment orchestration |

**Key Adaptations:**
- Replace old logging/metrics with v1 patterns (`better-result` errors)
- Use `ConcurrencyLimiter` from `@/lib/shared/utils/concurrency.ts`
- Store genres on `song.genres` column (TEXT[], max 3 ordered elements)
- Use `data/song.ts` for persistence instead of `TrackGenreRepository`

### Phase 4g: Playlist Profiling (Aggregation Layer)

Port playlist profile computation for matching destination playlists.

| Source File                                                  | Target Location                              | Lines | Purpose                                 |
| ------------------------------------------------------------ | -------------------------------------------- | ----- | --------------------------------------- |
| `old_app/lib/services/profiling/PlaylistProfilingService.ts` | `src/lib/capabilities/profiling/service.ts`  | 770   | DB-first profile computation            |
| `old_app/lib/services/reccobeats/ReccoBeatsService.ts`       | `src/lib/integrations/reccobeats/service.ts` | 226   | ReccoBeats audio features API           |
| `old_app/lib/services/audio/AudioFeaturesService.ts`         | `src/lib/integrations/audio/service.ts`      | 45    | Audio features backfill + normalization |

**Key Adaptations:**
- Use existing `EmbeddingService` from `src/lib/ml/embedding/service.ts`
- Use existing `data/vectors.ts` for `playlist_profile` table operations
- Port centroid calculation logic
- Port genre/emotion distribution aggregation
- Integrate with new `GenreEnrichmentService` for genre data
- Backfill missing audio features via `AudioFeaturesService` and persist to `song_audio_feature`

### Phase 4e: Matching Pipeline (Core Algorithm)

Port the multi-factor matching algorithm.

| Source File                                                 | Target Location                             | Lines | Purpose                         |
| ----------------------------------------------------------- | ------------------------------------------- | ----- | ------------------------------- |
| `old_app/lib/services/matching/matching-config.ts`          | `src/lib/capabilities/matching/config.ts`   | 125   | Algorithm weights & thresholds  |
| `old_app/lib/services/semantic/SemanticMatcher.ts`          | `src/lib/capabilities/matching/semantic.ts` | 306   | Theme/mood similarity           |
| `old_app/lib/services/vectorization/analysis-extractors.ts` | `src/lib/ml/embedding/extractors.ts`        | 354   | Text extraction from analysis   |
| `old_app/lib/services/vectorization/hashing.ts`             | `src/lib/ml/embedding/hashing.ts`           | 327   | Content hashing for cache keys  |
| `old_app/lib/services/matching/MatchingService.ts`          | `src/lib/capabilities/matching/service.ts`  | 1493  | Core multi-factor scoring       |
| `old_app/lib/services/matching/MatchCachingService.ts`      | `src/lib/capabilities/matching/cache.ts`    | 534   | Cache-first match orchestration |

**Key Adaptations:**
- Use existing `EmbeddingService` and `RerankerService`
- Use existing `data/matching.ts` for `match_context` and `match_result`
- Replace `VectorizationService` with `EmbeddingService` + extractors
- Replace crypto import with Web Crypto API for Edge compatibility
- Remove repository patterns in favor of `data/` modules

### Already Implemented (No Porting Needed)

These services exist in v1_hearted and will be integrated:
- `src/lib/ml/embedding/service.ts` - Song embedding generation
- `src/lib/integrations/deepinfra/service.ts` - DeepInfra API (embeddings + reranker)
- `src/lib/ml/reranker/service.ts` - Cross-encoder reranking
- `src/lib/data/matching.ts` - Match context/result DB operations
- `src/lib/data/vectors.ts` - Embedding storage (songs + playlists)

## Impact

### Affected Specs
- `matching-pipeline` - Primary capability being implemented

### Affected Code
- `src/lib/capabilities/` - Matching, genre, profiling, sync
- `src/lib/integrations/` - Last.fm, ReccoBeats, DeepInfra, Spotify
- `src/lib/ml/` - Embedding and reranking utilities
- `src/lib/data/song.ts` - May need genre-specific queries
- `src/lib/data/vectors.ts` - May need playlist profile queries
- `src/lib/data/song-audio-feature.ts` - Audio features read/write for profiling
- `src/env.ts` - Add `LASTFM_API_KEY` environment variable

### Database
- `song.genres` column - Store enriched genres (TEXT[], max 3)
- `playlist_profile` table - Store computed profiles
- `match_context` table - Cache context (already exists)
- `match_result` table - Match scores (already exists)

### Dependencies
- **No new npm packages required**
- Last.fm API key via environment variable

## Acceptance Criteria

1. **Genre Enrichment**: Songs can be enriched with Last.fm genres (max 3, ordered by relevance)
2. **Playlist Profiling**: Destination playlists can be profiled with embedding centroids and distributions
3. **Audio Features**: Missing audio features are backfilled via ReccoBeats and stored in `song_audio_feature`
4. **Matching**: Songs can be matched to playlists with weighted multi-factor scores
5. **Caching**: Match results are cached and invalidated correctly on changes
6. **Performance**: Matching completes in <5s for typical library (500 songs, 20 playlists)
7. **Edge Compatible**: All services work on Cloudflare Workers (no Node.js-specific APIs)

## Migration Notes

This is a **port** with adaptations, not a rewrite. The algorithm logic remains the same:
- Same MATCHING_WEIGHTS configuration
- Same multi-factor scoring formula
- Same cache invalidation strategy via content hashing
- Same genre whitelist and normalization

Changes are limited to:
- TypeScript patterns (Result types, error handling)
- Database access (data modules vs repositories)
- Edge compatibility (Web Crypto vs Node crypto)
- Integration with existing v1 services

## References

- [ROADMAP.md Phases 4e-4g](/docs/migration_v2/ROADMAP.md)
- [matching-pipeline spec](/openspec/specs/matching-pipeline/spec.md)
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md)
- [01-SCHEMA.md](/docs/migration_v2/01-SCHEMA.md)
