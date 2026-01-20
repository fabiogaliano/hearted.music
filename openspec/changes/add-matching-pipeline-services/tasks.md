# Implementation Tasks

Tasks are ordered by dependency: Phase 4f (Genre) → 4g (Profiling) → 4e (Matching).
Each phase builds on the previous.

---

## 0. Prerequisites

- [ ] 0.1 Add `LASTFM_API_KEY` to `src/env.ts` (optional, graceful degradation if missing)
- [ ] 0.2 Verify `song.genres` column exists in schema (TEXT[] with max 3 elements)
- [ ] 0.3 Verify `playlist_profile` table exists with required columns

---

## 1. Phase 4f: Genre Enrichment

### 1.1 Last.fm Service

- [ ] 1.1.1 Create `src/lib/services/lastfm/service.ts`
  - Port `LastFmService` class from `old_app/lib/services/lastfm/LastFmService.ts`
  - Use `ConcurrencyLimiter` from `@/lib/utils/concurrency.ts` (5 concurrent, 200ms interval)
  - Implement `getTrackTopTags`, `getAlbumTopTags`, `getArtistTopTags`
  - Implement `getTagsWithFallback` with chain: album → artist
  - Return `Result<GenreLookupResult, LastFmError>` instead of throwing
  - Add `createLastFmService()` factory reading `LASTFM_API_KEY` from env

- [ ] 1.1.2 Create `src/lib/services/lastfm/whitelist.ts`
  - Port `GENRE_WHITELIST` set (469 canonical genres)
  - Port `isGenre(tag: string): boolean` function
  - Export as `const GENRE_WHITELIST: ReadonlySet<string>`

- [ ] 1.1.3 Create `src/lib/services/lastfm/normalize.ts`
  - Port `extractPrimaryArtist(artist: string): string`
  - Port `normalizeAlbumName(album: string): string`
  - Handle "(feat. X)", "(with X)", "- Remastered", "- Deluxe Edition"

- [ ] 1.1.4 Create `src/lib/services/lastfm/types.ts`
  - Define `LastFmTag`, `GenreLookupResult`, `GenreSourceLevel` types
  - Define `LastFmError` using `TaggedError`

### 1.2 Genre Enrichment Service

- [ ] 1.2.1 Create `src/lib/services/genre/service.ts`
  - Port `GenreEnrichmentService` from `old_app/lib/services/genre/GenreEnrichmentService.ts`
  - Constructor takes optional `LastFmService` (graceful degradation)
  - Implement `enrichSong(songId, artist, title, album?)` → `Result<string[], GenreError>`
  - Implement `enrichBatch(inputs[], onProgress?)` → `Result<BatchResult, GenreError>`
  - Store genres on `song.genres` using `data/song.ts`
  - Use content hashing for cache keys

- [ ] 1.2.2 Add genre queries to `src/lib/data/song.ts`
  - Add `updateSongGenres(songId: string, genres: string[]): Promise<Result<void, DbError>>`
  - Add `getSongsWithoutGenres(accountId: string, limit?: number): Promise<Result<Song[], DbError>>`

- [ ] 1.2.3 Create `src/lib/errors/external/lastfm.ts`
  - `LastFmRateLimitError` - 429 from API
  - `LastFmNotFoundError` - Artist/album not found
  - `LastFmApiError` - Other API errors

---

## 2. Phase 4g: Playlist Profiling

### 2.1 Profile Service

- [ ] 2.1.1 Create `src/lib/services/profiling/service.ts`
  - Port `PlaylistProfilingService` from `old_app/lib/services/profiling/PlaylistProfilingService.ts`
  - Constructor takes `EmbeddingService` and optional `GenreEnrichmentService`
  - Implement `computeProfile(playlistId, songIds): Result<PlaylistProfile, ProfilingError>`
  - Implement `computeProfiles(playlistIds[]): Result<Map<string, PlaylistProfile>, ProfilingError>`
  - Implement `getProfile(playlistId): Result<PlaylistProfile | null, DbError>`
  - Implement `invalidateProfile(playlistId): Promise<void>`

- [ ] 2.1.2 Create `src/lib/services/profiling/types.ts`
  - Define `PlaylistProfile` interface (embedding, audioCentroid, genreDistribution, emotionDistribution)
  - Define `ProfileKind` enum ('content_v1', 'context_v1')
  - Define `AudioCentroid` interface

- [ ] 2.1.3 Port centroid calculation utilities
  - `calculateEmbeddingCentroid(embeddings: number[][]): number[]`
  - `calculateAudioCentroid(features: AudioFeatures[]): AudioCentroid`
  - `computeGenreDistribution(genres: string[][]): Record<string, number>`
  - `computeEmotionDistribution(analyses: SongAnalysis[]): Record<string, number>`

- [ ] 2.1.4 Use playlist profile queries in `src/lib/data/vectors.ts`
  - Use `upsertPlaylistProfile(data: UpsertPlaylistProfile): Promise<Result<PlaylistProfile, DbError>>`
  - Use `getPlaylistProfile(playlistId: string): Promise<Result<PlaylistProfile | null, DbError>>`
  - Use `getPlaylistProfilesBatch(playlistIds: string[]): Promise<Result<Map<string, PlaylistProfile>, DbError>>`
  - Add `deletePlaylistProfile(playlistId: string): Promise<Result<void, DbError>>`

### 2.2 Audio Features Backfill (ReccoBeats)

- [ ] 2.2.1 Create `src/lib/services/reccobeats/service.ts`
  - Port `ReccoBeatsService` from `old_app/lib/services/reccobeats/ReccoBeatsService.ts`
  - Use `ConcurrencyLimiter` from `@/lib/utils/concurrency.ts` (5 concurrent, 50ms interval)
  - Implement `getAudioFeaturesBatch(spotifyTrackIds: string[])`
  - Return `Result<Map<string, ReccoBeatsAudioFeatures>, ReccoBeatsError>`
  - Add `createReccoBeatsService()` factory (no API key required)

- [ ] 2.2.2 Create `src/lib/services/audio/service.ts`
  - Port `AudioFeaturesService` from `old_app/lib/services/audio/AudioFeaturesService.ts`
  - Accept `ReccoBeatsService` dependency (optional, graceful degradation)
  - Add `backfillMissingFeatures(songs): Promise<Result<Map<string, AudioFeature>, AudioFeaturesError>>`
  - Persist results via `data/song-audio-feature.ts` upsert

- [ ] 2.2.3 Create `src/lib/errors/external/reccobeats.ts`
  - `ReccoBeatsRateLimitError` - 429 from API
  - `ReccoBeatsNotFoundError` - No features found
  - `ReccoBeatsApiError` - Other API errors

- [ ] 2.2.4 Integrate audio features service into profiling
  - Backfill missing audio features before computing centroids
  - Prefer existing `song_audio_feature` rows; only fetch when missing

---

## 3. Phase 4e: Matching Pipeline

### 3.1 Supporting Utilities

- [ ] 3.1.1 Create `src/lib/services/embedding/extractors.ts`
  - Port `extractSongText(analysis): VectorizationText` from `analysis-extractors.ts`
  - Port `extractPlaylistText(analysis): VectorizationText`
  - Port `combineVectorizationText(text): string`
  - Port `intensityToText(intensity): string` helper
  - Port `getTopListeningContexts(contexts, limit): string[]` helper

- [ ] 3.1.2 Create `src/lib/services/embedding/hashing.ts`
  - Port hashing functions using Web Crypto API (Edge compatible)
  - Implement `stableStringify(obj): string` for deterministic serialization
  - Implement `stableHash(content): Promise<string>` using SHA-256
  - Implement `shortHash(content): Promise<string>` (first 16 chars)
  - Port `hashTrackContent(text): Promise<string>` with version prefix
  - Port `hashPlaylistProfile(params): Promise<string>` with version prefix
  - Port `hashMatchContext(params): Promise<string>`
  - Port `hashCandidateSet(songIds, contentHashes): Promise<string>`
  - Port `hashPlaylistSet(playlistIds, profileHashes): Promise<string>`

- [ ] 3.1.3 Create `src/lib/services/embedding/versioning.ts`
  - Define `EXTRACTOR_VERSION = 1`
  - Define `EMBEDDING_SCHEMA_VERSION = 1`
  - Define `PLAYLIST_PROFILE_VERSION = 1`
  - Define `MATCHING_ALGO_VERSION = 'matching_v2'`

### 3.2 Semantic Matcher

- [ ] 3.2.1 Create `src/lib/services/matching/semantic.ts`
  - Port `SemanticMatcher` from `old_app/lib/services/semantic/SemanticMatcher.ts`
  - Implement fast paths: exact match, substring match
  - Implement `getSimilarity(str1, str2): Promise<number>` using embeddings
  - Implement `areSimilar(str1, str2, threshold?): Promise<boolean>`
  - Implement `findSimilar(query, candidates, threshold?): Promise<SimilarResult[]>`
  - Use `DeepInfraService` when `DEEPINFRA_API_KEY` is set (prod)
  - When key is missing (local), skip embedding calls and rely on lexical matches only
  - Add in-memory cache (TTL: 1 hour, max size: 1000)

### 3.3 Matching Config

- [ ] 3.3.1 Create `src/lib/services/matching/config.ts`
  - Port `MATCHING_WEIGHTS` object (embedding, profiles, scoring, tiers)
  - Port `AUDIO_FEATURE_WEIGHTS` object
  - Port `RERANKER_CONFIG` object (topN, blendWeight, minScoreThreshold)
  - Export as Zod schemas for validation
  - Export derived types using `z.infer<>`

### 3.4 Core Matching Service

- [ ] 3.4.1 Create `src/lib/services/matching/service.ts`
  - Port `MatchingService` from `old_app/lib/services/matching/MatchingService.ts`
  - Constructor takes: `EmbeddingService`, `SemanticMatcher`, `PlaylistProfilingService`, optional `RerankerService`, optional `GenreEnrichmentService`
  - Implement `matchSong(songId, playlistIds): Promise<Result<MatchResult[], MatchingError>>`
  - Implement `matchBatch(songIds, playlistIds): Promise<Result<Map<string, MatchResult[]>, MatchingError>>`
  - Port scoring functions:
    - `computeVectorScore(songEmb, playlistEmb): number` (cosine similarity)
    - `computeSemanticScore(songAnalysis, playlistProfile): number`
    - `computeAudioScore(songFeatures, playlistCentroid): number`
    - `computeGenreScore(songGenres, playlistDistribution): number`
    - `aggregateScores(factors, weights): number`
  - Port adaptive weight selection based on data availability

- [ ] 3.4.2 Create `src/lib/services/matching/types.ts`
  - Define `MatchResult` interface (songId, playlistId, score, rank, factors)
  - Define `ScoreFactors` interface (vector, semantic, audio, genre)
  - Define `MatchingError` union type

### 3.5 Match Caching Service

- [ ] 3.5.1 Create `src/lib/services/matching/cache.ts`
  - Port `MatchCachingService` from `old_app/lib/services/matching/MatchCachingService.ts`
  - Implement `getOrComputeMatches(accountId, songIds, playlistIds): Promise<Result<Map<string, MatchResult[]>, MatchingError>>`
  - Implement context hash computation using `hashMatchContext`
  - Implement cache lookup via `data/matching.ts` queries
  - Implement cache storage via `insertMatchResults`
  - Port invalidation logic (hash changes trigger recompute)

---

## 4. Integration

- [ ] 4.1 Update `src/lib/services/embedding/service.ts`
  - Add `buildEmbeddingText` method using new extractors
  - Integrate with `hashTrackContent` for content hashing

- [ ] 4.2 Create service factory functions
  - `createLastFmService(): LastFmService | null`
  - `createGenreEnrichmentService(): GenreEnrichmentService`
  - `createReccoBeatsService(): ReccoBeatsService | null`
  - `createAudioFeaturesService(): AudioFeaturesService`
  - `createPlaylistProfilingService(): PlaylistProfilingService`
  - `createMatchingService(): MatchingService`
  - `createMatchCachingService(): MatchCachingService`

---

## 5. Testing

- [ ] 5.1 Add unit tests for text extraction
  - Test `extractSongText` with various analysis structures
  - Test `extractPlaylistText` with various analysis structures

- [ ] 5.2 Add unit tests for hashing
  - Test determinism (same input → same hash)
  - Test version prefix parsing

- [ ] 5.3 Add integration tests for matching pipeline
  - Test matching accuracy with known song-playlist pairs
  - Test cache hit/miss behavior
  - Test graceful degradation (no Last.fm key, no genres, etc.)

- [ ] 5.4 Run typecheck and lint
  - `bun run typecheck`
  - `bun run lint`

---

## 6. Documentation

- [ ] 6.1 Update ROADMAP.md to mark phases 4e, 4f, 4g as complete
- [ ] 6.2 Add service documentation in code (JSDoc comments)

---

## Dependencies Graph

```
Phase 4f (Genre)
├── lastfm/service.ts
├── lastfm/whitelist.ts
├── lastfm/normalize.ts
├── lastfm/types.ts
├── genre/service.ts
└── errors/external/lastfm.ts

Phase 4g (Profiling)
├── reccobeats/service.ts
├── audio/service.ts
├── errors/external/reccobeats.ts
├── profiling/service.ts (depends on: EmbeddingService, GenreEnrichmentService)
├── profiling/types.ts
├── data/song-audio-feature.ts updates
└── data/vectors.ts updates

Phase 4e (Matching)
├── embedding/extractors.ts
├── embedding/hashing.ts
├── embedding/versioning.ts
├── matching/semantic.ts (depends on: DeepInfraService when available)
├── matching/config.ts
├── matching/service.ts (depends on: all of the above)
├── matching/cache.ts (depends on: MatchingService, data/matching.ts)
└── matching/types.ts
```
