# Matching Pipeline Specification

> Core song-to-playlist matching algorithm that enables sorting liked songs into destination playlists.

**Implementation Phases**: 4e (Matching), 4f (Genre), 4g (Profiling)
**Source**: `old_app/lib/services/matching/`, `vectorization/`, `semantic/`, `genre/`, `profiling/`
**Target**: `src/lib/services/matching/`, `genre/`, `profiling/`

---

## Purpose

Define the matching pipeline that computes which playlists each liked song should be sorted into. This is the core business logic of the application - without it, songs can be analyzed but never sorted.

---

## Requirements

### Requirement: Multi-Factor Matching

The system SHALL compute match scores using multiple complementary signals.

#### Scenario: Vector similarity computed
- **WHEN** matching a song to playlists
- **THEN** compute cosine similarity between song embedding and playlist profile embedding

#### Scenario: Semantic similarity computed
- **WHEN** matching a song to playlists
- **THEN** compute theme/mood overlap using structured analysis fields

#### Scenario: Audio feature compatibility computed
- **WHEN** matching a song to playlists
- **THEN** compare audio feature centroids (energy, danceability, valence, etc.)

#### Scenario: Genre alignment computed
- **WHEN** matching a song to playlists
- **THEN** compare song genres against playlist genre distribution

#### Scenario: Weighted score aggregation
- **WHEN** all factor scores are computed
- **THEN** aggregate using configurable weights from `matching-config.ts`

---

### Requirement: Configurable Algorithm Weights

The system SHALL allow tuning matching algorithm without code changes.

#### Scenario: Weight configuration
- **WHEN** deploying the application
- **THEN** read weights from config: `{ vector: 0.4, semantic: 0.25, audio: 0.2, genre: 0.15 }`

#### Scenario: Threshold configuration
- **WHEN** determining minimum match quality
- **THEN** use configurable threshold (default: 0.3 minimum score)

#### Scenario: Top-K configuration
- **WHEN** returning match results
- **THEN** return configurable number of top matches (default: 5)

---

### Requirement: Cache-First Matching

The system SHALL use cache-first pattern to avoid redundant computation.

#### Scenario: Cache key computation
- **WHEN** matching is requested
- **THEN** compute context hash from: playlist set hash + candidate set hash + config hash

#### Scenario: Cache hit
- **WHEN** context hash matches existing `match_context`
- **THEN** return cached `match_result` rows without recomputation

#### Scenario: Cache miss
- **WHEN** context hash is new
- **THEN** compute matches, create `match_context`, store `match_result` rows

#### Scenario: Cache invalidation
- **WHEN** song analysis changes OR playlist contents change OR config changes
- **THEN** context hash naturally differs, causing fresh computation

---

### Requirement: Playlist Profiling

The system SHALL compute aggregate profiles for destination playlists.

#### Scenario: Embedding centroid
- **WHEN** computing playlist profile
- **THEN** average all song embeddings in playlist

#### Scenario: Audio feature centroid
- **WHEN** computing playlist profile
- **THEN** average all song audio features (energy, danceability, etc.)

#### Scenario: Genre distribution
- **WHEN** computing playlist profile
- **THEN** compute genre frequency distribution across playlist songs

#### Scenario: Emotion distribution
- **WHEN** computing playlist profile
- **THEN** compute emotion frequency from song analyses (joy, sadness, energy, etc.)

#### Scenario: Profile persistence
- **WHEN** profile is computed
- **THEN** store in `playlist_profile` table with `content_hash` for invalidation

---

### Requirement: Genre Enrichment

The system SHALL enrich songs with genre metadata from Last.fm.

#### Scenario: Genre fetching
- **WHEN** song lacks genres
- **THEN** fetch top tags for song's artist from Last.fm API

#### Scenario: Genre normalization
- **WHEN** raw tags are received from Last.fm
- **THEN** normalize against 469-genre canonical whitelist

#### Scenario: Genre persistence
- **WHEN** genres are normalized
- **THEN** store on `song.genres` column (TEXT[])

#### Scenario: Rate limiting
- **WHEN** fetching from Last.fm
- **THEN** respect 5 requests/second limit

---

### Requirement: Text Extraction for Embeddings

The system SHALL extract meaningful text from structured analyses.

#### Scenario: Song text extraction
- **WHEN** embedding a song
- **THEN** extract: themes, mood descriptors, emotional journey, musical style, context

#### Scenario: Playlist text extraction
- **WHEN** embedding a playlist
- **THEN** extract: overall theme, mood, purpose, musical characteristics

#### Scenario: Consistent formatting
- **WHEN** extracting text
- **THEN** format consistently for embedding model (E5 instruction format)

---

### Requirement: Content Hashing

The system SHALL use content hashing for cache invalidation.

#### Scenario: Analysis hash
- **WHEN** storing embeddings
- **THEN** compute hash of source analysis content

#### Scenario: Hash comparison
- **WHEN** checking if re-embedding needed
- **THEN** compare stored `content_hash` with current analysis hash

#### Scenario: Deterministic hashing
- **WHEN** computing hashes
- **THEN** use deterministic algorithm (same input = same hash)

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MATCHING PIPELINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. GENRE ENRICHMENT (Phase 4f)                                     │
│     Song → Last.fm API → Normalize → Store song.genres              │
│                                                                      │
│  2. TEXT EXTRACTION                                                  │
│     Song Analysis → Extract themes/mood/style → Text for embedding  │
│                                                                      │
│  3. EMBEDDING (Already implemented in Phase 4d)                     │
│     Text → DeepInfra API → 1024-dim vector → Store song_embedding   │
│                                                                      │
│  4. PLAYLIST PROFILING (Phase 4g)                                   │
│     Destination Playlist → Aggregate songs → Store playlist_profile │
│       • Embedding centroid (avg of song embeddings)                 │
│       • Audio centroid (avg of audio features)                      │
│       • Genre distribution (frequency counts)                       │
│       • Emotion distribution (from analyses)                        │
│                                                                      │
│  5. MATCHING (Phase 4e)                                             │
│     For each (song, playlist) pair:                                 │
│       • Vector score: cosine(song_embedding, playlist_centroid)     │
│       • Semantic score: theme/mood overlap                          │
│       • Audio score: feature distance                               │
│       • Genre score: Jaccard similarity                             │
│       • Final score: weighted sum                                   │
│                                                                      │
│  6. CACHING                                                         │
│     Context hash → match_context                                    │
│     Results → match_result (song_id, playlist_id, score, rank)      │
│                                                                      │
│  7. RERANKING (Already implemented)                                 │
│     Top-N matches → DeepInfra reranker → Refined ranking            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Service Structure

### `services/matching/config.ts`
```typescript
export const MATCHING_CONFIG = {
  weights: {
    vector: 0.40,    // Embedding similarity
    semantic: 0.25,  // Theme/mood overlap
    audio: 0.20,     // Audio feature compatibility
    genre: 0.15,     // Genre alignment
  },
  thresholds: {
    minimum: 0.30,   // Minimum score to show
    confident: 0.70, // High-confidence match
  },
  limits: {
    topK: 5,         // Max matches per song
    batchSize: 50,   // Songs per batch
  },
}
```

### `services/matching/service.ts`
```typescript
export class MatchingService {
  async matchSong(songId: string, playlistIds: string[]): Promise<MatchResult[]>
  async matchBatch(songIds: string[], playlistIds: string[]): Promise<Map<string, MatchResult[]>>

  private computeVectorScore(songEmb: number[], playlistEmb: number[]): number
  private computeSemanticScore(songAnalysis: SongAnalysis, playlistAnalysis: PlaylistAnalysis): number
  private computeAudioScore(songFeatures: AudioFeatures, playlistCentroid: AudioFeatures): number
  private computeGenreScore(songGenres: string[], playlistDistribution: GenreDistribution): number
  private aggregateScores(factors: ScoreFactors): number
}
```

### `services/matching/cache.ts`
```typescript
export class MatchCachingService {
  async getOrComputeMatches(
    accountId: string,
    songIds: string[],
    playlistIds: string[]
  ): Promise<Map<string, MatchResult[]>>

  private computeContextHash(playlistIds: string[], songIds: string[], config: MatchingConfig): string
  private getCachedResults(contextHash: string): Promise<MatchResult[] | null>
  private cacheResults(contextHash: string, results: MatchResult[]): Promise<void>
}
```

### `services/matching/semantic.ts`
```typescript
export class SemanticMatcher {
  computeThemeSimilarity(songThemes: string[], playlistThemes: string[]): number
  computeMoodCompatibility(songMood: MoodProfile, playlistMood: MoodProfile): number
  computeOverallSemantic(songAnalysis: SongAnalysis, playlistAnalysis: PlaylistAnalysis): number
}
```

### `services/genre/service.ts`
```typescript
export class GenreEnrichmentService {
  async enrichSong(song: Song): Promise<string[]>
  async enrichBatch(songs: Song[]): Promise<Map<string, string[]>>
}
```

### `services/lastfm/service.ts`
```typescript
export class LastFmService {
  async getArtistTopTags(artist: string): Promise<string[]>
}
```

### `services/profiling/service.ts`
```typescript
export class PlaylistProfilingService {
  async computeProfile(playlistId: string): Promise<PlaylistProfile>
  async computeProfiles(playlistIds: string[]): Promise<Map<string, PlaylistProfile>>

  private computeEmbeddingCentroid(embeddings: number[][]): number[]
  private computeAudioCentroid(features: AudioFeatures[]): AudioFeatures
  private computeGenreDistribution(genres: string[][]): GenreDistribution
  private computeEmotionDistribution(analyses: SongAnalysis[]): EmotionDistribution
}
```

---

## Types

```typescript
interface MatchResult {
  songId: string
  playlistId: string
  score: number
  rank: number
  factors: ScoreFactors
}

interface ScoreFactors {
  vector: number
  semantic: number
  audio: number
  genre: number
}

interface PlaylistProfile {
  playlistId: string
  embedding: number[]           // 1024-dim centroid
  audioCentroid: AudioFeatures  // Avg audio features
  genreDistribution: Record<string, number>  // genre → weight
  emotionDistribution: Record<string, number> // emotion → weight
  songCount: number
  songIds: string[]
  contentHash: string
}

interface GenreDistribution {
  [genre: string]: number  // Normalized 0-1 weight
}
```

---

## Database Tables Used

| Table | Purpose |
|-------|---------|
| `song.genres` | Enriched genre array |
| `song_embedding` | Song vector embeddings |
| `song_audio_feature` | Audio characteristics |
| `song_analysis` | LLM-generated analysis |
| `playlist_profile` | Aggregated playlist vectors |
| `playlist_analysis` | LLM-generated playlist analysis |
| `match_context` | Cache key + metadata |
| `match_result` | Cached match scores |

---

## Environment Variables

```
LASTFM_API_KEY=xxx          # Last.fm API for genre enrichment
RECCOBEATS_API_URL=xxx      # ReccoBeats for audio features (optional)
```

---

## References

- [ROADMAP.md Phases 4e-4g](/docs/migration_v2/ROADMAP.md) — Implementation tasks
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md) — Service inventory
- [matching-ui spec](/openspec/specs/matching-ui/spec.md) — UI for match results
- [01-SCHEMA.md](/docs/migration_v2/01-SCHEMA.md) — Database tables

---

*Created: January 20, 2026 — Gap analysis identified missing core business logic*
