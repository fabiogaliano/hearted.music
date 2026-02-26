# Matching Pipeline Specification

> Core song-to-playlist matching algorithm that enables sorting liked songs into destination playlists.

**Target**: `src/lib/capabilities/matching/`, `capabilities/genre/`, `capabilities/profiling/`, `integrations/lastfm/`, `integrations/reccobeats/`, `ml/embedding/`

---

## Purpose

Define the matching pipeline that computes which playlists each liked song should be sorted into. This is the core business logic of the application - without it, songs can be analyzed but never sorted.

---
## Requirements
### Requirement: Three-Signal Matching

The system SHALL compute match scores using three complementary signals: embedding similarity, audio feature compatibility, and genre alignment.

#### Scenario: Embedding similarity computed
- **WHEN** matching a song to playlists
- **THEN** compute cosine similarity between song embedding and playlist profile embedding
- **AND** use `cosineSimilarity()` from `capabilities/matching/semantic.ts`

#### Scenario: Audio feature compatibility computed
- **WHEN** matching a song to playlists
- **THEN** compare song audio features against playlist audio centroid using weighted Euclidean distance
- **AND** weight individual features via `AudioFeatureWeights` config

#### Scenario: Genre alignment computed
- **WHEN** matching a song to playlists
- **THEN** compare song genres against playlist genre distribution

#### Scenario: Weighted score aggregation
- **WHEN** all factor scores are computed
- **THEN** aggregate using configurable weights: `{ embedding: 0.5, audio: 0.3, genre: 0.2 }`

#### Scenario: Adaptive weights for missing data
- **WHEN** a song is missing one or more data sources (embedding, audio features, genres)
- **THEN** redistribute missing factor weight proportionally to available factors via `computeAdaptiveWeights()`

---

### Requirement: Configurable Algorithm Weights

The system SHALL allow tuning matching algorithm without code changes.

#### Scenario: Weight configuration
- **WHEN** deploying the application
- **THEN** read weights from `DEFAULT_MATCHING_WEIGHTS`: `{ embedding: 0.5, audio: 0.3, genre: 0.2 }`

#### Scenario: Threshold configuration
- **WHEN** determining minimum match quality
- **THEN** use configurable threshold (default: 0.3 minimum score)
- **AND** use veto threshold (default: 0.2) for poor matches

#### Scenario: Top-K configuration
- **WHEN** returning match results
- **THEN** return configurable number of top matches (default: 10)

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

#### Scenario: Profile persistence
- **WHEN** profile is computed
- **THEN** store in `playlist_profile` table with `content_hash` for invalidation

---

### Requirement: Genre Enrichment

The system SHALL enrich songs with top 3 ranked genres from Last.fm.

#### Scenario: Genre fetching
- **WHEN** song lacks genres
- **THEN** fetch top tags for song's artist from Last.fm API

#### Scenario: Top 3 selection
- **WHEN** raw tags are received from Last.fm
- **THEN** select top 3 tags by count after normalization
- **AND** preserve order: index 0 = primary, index 1 = secondary, index 2 = tertiary

#### Scenario: Genre normalization
- **WHEN** raw tags are received from Last.fm
- **THEN** normalize against 469-genre canonical whitelist
- **AND** skip tags that don't match the whitelist

#### Scenario: Genre persistence
- **WHEN** genres are normalized
- **THEN** store ordered array on `song.genres` column (TEXT[], max 3 elements)

#### Scenario: Rate limiting
- **WHEN** fetching from Last.fm
- **THEN** respect 5 requests/second limit

---

### Requirement: Embedding Text Composition

The system SHALL build a single embedding text per song by concatenating descriptive analysis fields and genre metadata. See [analysis-schema spec](/openspec/specs/analysis-schema/spec.md) for composition details.

#### Scenario: Song embedding text
- **WHEN** embedding a song
- **THEN** compose text from flat analysis fields: headline, compound_mood, mood_description, interpretation, themes, journey moods, sonic_texture, and genres

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

### Requirement: Matching module locations

The system SHALL organize matching pipeline modules under the capability, integration, and ML folders.

#### Scenario: Matching service location
- **WHEN** matching modules are created or updated
- **THEN** they are located under `src/lib/capabilities/matching`

#### Scenario: Genre and profiling locations
- **WHEN** genre or profiling modules are created or updated
- **THEN** they are located under `src/lib/capabilities/genre` and `src/lib/capabilities/profiling`

#### Scenario: Embedding utilities location
- **WHEN** embedding helpers are used by matching
- **THEN** they are located under `src/lib/ml/embedding`

#### Scenario: External provider locations
- **WHEN** Last.fm or ReccoBeats integrations are referenced
- **THEN** they are located under `src/lib/integrations/lastfm` and `src/lib/integrations/reccobeats`

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MATCHING PIPELINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. GENRE ENRICHMENT                                                │
│     Song → Last.fm API → Normalize → Store song.genres              │
│                                                                      │
│  2. EMBEDDING TEXT COMPOSITION                                      │
│     Flat Analysis Fields + Genres → Single text → Embedding         │
│                                                                      │
│  3. EMBEDDING                                                       │
│     Text → DeepInfra API → 1024-dim vector → Store song_embedding   │
│                                                                      │
│  4. PLAYLIST PROFILING                                              │
│     Destination Playlist → Aggregate songs → Store playlist_profile │
│       • Embedding centroid (avg of song embeddings)                 │
│       • Audio centroid (avg of audio features)                      │
│       • Genre distribution (frequency counts)                       │
│                                                                      │
│  5. MATCHING (3 signals)                                            │
│     For each (song, playlist) pair:                                 │
│       • Embedding score: cosine(song_embedding, playlist_centroid)  │
│       • Audio score: weighted feature distance                      │
│       • Genre score: distribution overlap                           │
│       • Final score: adaptive weighted sum                          │
│                                                                      │
│  6. CACHING                                                         │
│     Context hash → match_context                                    │
│     Results → match_result (song_id, playlist_id, score, rank)      │
│                                                                      │
│  7. RERANKING                                                       │
│     Top-N matches → DeepInfra reranker → Refined ranking            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Service Structure

### `capabilities/matching/config.ts`
```typescript
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  embedding: 0.5,
  audio: 0.3,
  genre: 0.2,
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  weights: DEFAULT_MATCHING_WEIGHTS,
  audioWeights: DEFAULT_AUDIO_FEATURE_WEIGHTS,
  minScoreThreshold: 0.3,
  maxResultsPerSong: 10,
  skipVectorScoring: false,
  vetoThreshold: 0.2,
}

export function computeAdaptiveWeights(availability: DataAvailability): MatchingWeights
```

### `capabilities/matching/service.ts`
```typescript
export class MatchingService {
  async matchSong(song: MatchingSong, profiles: MatchingPlaylistProfile[], embedding?: number[]): Promise<Result<MatchResult[], MatchingError>>
  async matchBatch(songs: MatchingSong[], profiles: MatchingPlaylistProfile[], ...): Promise<BatchMatchResult>
}
```

### `capabilities/matching/scoring.ts`
```typescript
export function computeAudioFeatureScore(songFeatures: MatchingAudioFeatures, playlistCentroid: Record<string, number>, weights: AudioFeatureWeights): number
```

### `capabilities/matching/cache.ts`
```typescript
export class MatchCachingService {
  async getOrComputeMatches(accountId: string, songIds: string[], playlistIds: string[]): Promise<Map<string, MatchResult[]>>
}
```

### `capabilities/matching/semantic.ts`
```typescript
export function cosineSimilarity(a: number[], b: number[]): number
```

### `capabilities/genre/service.ts`
```typescript
export class GenreEnrichmentService {
  async enrichSong(song: Song): Promise<string[]>
  async enrichBatch(songs: Song[]): Promise<Map<string, string[]>>
}
```

### `integrations/lastfm/service.ts`
```typescript
export class LastFmService {
  async getArtistTopTags(artist: string): Promise<string[]>
}
```

### `capabilities/profiling/service.ts`
```typescript
export class PlaylistProfilingService {
  async getProfile(playlistId: string): Promise<Result<ComputedPlaylistProfile | null, ProfilingError>>
  async computeProfile(playlistId: string, songs: ...): Promise<Result<ComputedPlaylistProfile, ProfilingError>>
  async invalidateProfile(playlistId: string): Promise<void>
}
```

---

## Types

```typescript
interface ScoreFactors {
  embedding: number
  audio: number
  genre: number
}

interface MatchResult {
  songId: string
  playlistId: string
  score: number
  rank: number
  factors: ScoreFactors
  confidence: number
  fromCache: boolean
}

interface MatchingWeights {
  embedding: number  // default 0.5
  audio: number      // default 0.3
  genre: number      // default 0.2
}

interface MatchingPlaylistProfile {
  playlistId: string
  embedding: number[] | null
  audioCentroid: Record<string, number>
  genreDistribution: Record<string, number>
  method?: "learned_from_songs" | "from_description"
}

interface MatchingSong {
  id: string
  spotifyId: string
  name: string
  artists: string[]
  genres: string[] | null
  audioFeatures?: MatchingAudioFeatures | null
}

interface DataAvailability {
  hasEmbedding: boolean
  hasGenres: boolean
  hasAudioFeatures: boolean
}
```

---

## Database Tables Used

| Table                | Purpose                         |
| -------------------- | ------------------------------- |
| `song.genres`        | Enriched genre array            |
| `song_embedding`     | Song vector embeddings          |
| `song_audio_feature` | Audio characteristics           |
| `song_analysis`      | LLM-generated analysis          |
| `playlist_profile`   | Aggregated playlist vectors     |
| `playlist_analysis`  | LLM-generated playlist analysis |
| `match_context`      | Cache key + metadata            |
| `match_result`       | Cached match scores             |

---

## Environment Variables

```
LASTFM_API_KEY=xxx          # Last.fm API for genre enrichment
RECCOBEATS_API_URL=xxx      # ReccoBeats for audio features (optional)
```

---

## References

- [analysis-schema spec](/openspec/specs/analysis-schema/spec.md) — Upstream analysis output contract
- [matching-ui spec](/openspec/specs/matching-ui/spec.md) — UI for match results
- [lyrics spec](/openspec/specs/lyrics/spec.md) — Lyrics retrieval feeding analysis input

---

*Created: January 20, 2026*
*Updated: February 26, 2026 — Simplified to 3 scoring signals (embedding, audio, genre), removed emotion distribution from profiling*
