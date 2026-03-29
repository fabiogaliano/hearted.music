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

The system SHALL use cache-first context hashing to avoid redundant computation and to deduplicate refresh-owned snapshot publication.

#### Scenario: Cache key computation
- **WHEN** matching metadata is prepared
- **THEN** compute context hash from target playlist set hash + candidate set hash + config hash + model/version hash

#### Scenario: Deterministic refresh context identity
- **WHEN** the target-playlist refresh workflow prepares snapshot publication
- **THEN** it SHALL compute materially relevant matching hashes before attempting to publish a new snapshot
- **AND** `playlistSetHash` SHALL be derived from target playlist/profile inputs that affect the result, not playlist IDs alone
- **AND** `candidateSetHash` SHALL be derived from candidate content that affects the result, not song IDs alone
- **AND** the workflow SHALL use the same hashing primitives as the cache-first matching path where practical

#### Scenario: Cache hit during refresh
- **WHEN** the refresh workflow finds an existing latest `match_context` for the same account and computed `contextHash`
- **THEN** it SHALL NOT create a duplicate `match_context`
- **AND** it SHALL return a no-op publish result instead of rewriting `match_result`

#### Scenario: Cache miss during refresh
- **WHEN** the computed `contextHash` is new
- **THEN** the refresh workflow SHALL compute matches and atomically publish `match_context` and `match_result`
- **AND** the stored context metadata SHALL use `MATCHING_ALGO_VERSION` rather than a hardcoded version string

#### Scenario: Cache invalidation
- **WHEN** song analysis changes OR target playlist contents change OR target playlist profile inputs change OR target playlist name/description changes OR config changes OR model/version changes
- **THEN** the context hash SHALL differ, causing fresh publication

#### Scenario: Profile content hash includes intent text
- **WHEN** computing playlist profile content hash
- **THEN** intent text (name + description) SHALL always be included in the hash input
- **AND** the hash SHALL NOT gate intent text inclusion on whether song embeddings exist

#### Scenario: Incremental candidate set
- **WHEN** a re-sync adds new liked songs but existing candidates are unchanged
- **THEN** the candidate set hash SHALL differ
- **AND** a fresh snapshot MAY be published after candidate enrichment drains

#### Scenario: No target playlists
- **WHEN** the account has zero current target playlists
- **THEN** the refresh workflow SHALL publish an explicit empty snapshot
- **AND** it SHALL NOT leave the previous snapshot current

#### Scenario: No ready candidates
- **WHEN** there are no current data-enriched liked-song candidates ready for matching
- **THEN** the refresh workflow SHALL publish a snapshot with zero matches for the current target playlist set
- **AND** it SHALL NOT use `item_status` as a proxy for published matching currency

#### Scenario: Unmatched songs terminology
- **WHEN** a song has zero matches above the score threshold (0.3)
- **THEN** the song SHALL be reported as `noMatch` (not `failed`)
- **AND** `BatchMatchResult.noMatch` SHALL contain the song ID

#### Scenario: Missing prerequisites
- **WHEN** some liked songs are missing required enrichment prerequisites
- **THEN** the refresh workflow SHALL exclude those songs from the current candidate set instead of failing
- **AND** the next enrichment-drain refresh SHALL re-evaluate them once their prerequisites exist

---

### Requirement: Playlist Profiling

The system SHALL compute aggregate profiles for destination playlists, blending song-derived content signals with playlist intent signals (name and description).

#### Scenario: Embedding centroid
- **WHEN** computing playlist profile
- **THEN** average all song embeddings in playlist to produce a song centroid

#### Scenario: Intent embedding
- **WHEN** computing playlist profile
- **AND** playlist has name text (always present) and optionally description text
- **THEN** embed the intent text (name + description joined with " — ") using `EmbeddingService.embedText()` with `passage:` prefix
- **AND** produce an intent embedding vector

#### Scenario: Intent-content blending
- **WHEN** both song centroid and intent embedding are available
- **THEN** L2-normalize both vectors before blending
- **AND** compute weighted average: `(1 - intentWeight) * songCentroid + intentWeight * intentEmbedding`
- **AND** L2-normalize the result
- **AND** use the blended vector as the profile's embedding centroid

#### Scenario: Intent weight computation
- **WHEN** computing the blend weight
- **THEN** compute `intentWeight` from song count and description presence using a smooth decay formula
- **AND** intent weight SHALL be higher for playlists with fewer songs (new/sparse playlists)
- **AND** intent weight SHALL be boosted when description text is present (richer signal)
- **AND** intent weight SHALL never reach zero — a minimum floor of 0.15 (name-only) or 0.30 (with description) SHALL be enforced

#### Scenario: Intent-only profile (no songs)
- **WHEN** computing playlist profile
- **AND** playlist has no songs with embeddings
- **AND** intent text exists
- **THEN** the intent embedding SHALL be the profile's embedding centroid (no blending needed)

#### Scenario: No intent text (edge case)
- **WHEN** computing playlist profile
- **AND** no intent text is available
- **THEN** fall back to pure song centroid (existing behavior unchanged)

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

The system SHALL organize matching pipeline modules under bounded-context domains, workflows, integrations, and platform folders.

#### Scenario: Song matching service location
- **WHEN** song-matching modules are created or updated
- **THEN** they are located under `src/lib/domains/taste/song-matching/*`

#### Scenario: Genre and profiling locations
- **WHEN** genre-tagging or playlist-profiling modules are created or updated
- **THEN** they are located under `src/lib/domains/enrichment/genre-tagging/*` and `src/lib/domains/taste/playlist-profiling/*`

#### Scenario: Analysis and embedding locations
- **WHEN** analysis or embedding helpers are used by matching
- **THEN** they are located under `src/lib/domains/enrichment/content-analysis/*` and `src/lib/domains/enrichment/embeddings/*`

#### Scenario: Enrichment workflow location
- **WHEN** the matching-related enrichment pipeline is referenced
- **THEN** its orchestration modules are located under `src/lib/workflows/enrichment-pipeline/*`

#### Scenario: External provider locations
- **WHEN** Last.fm, ReccoBeats, or LLM provider integrations are referenced by the matching stack
- **THEN** they are located under `src/lib/integrations/lastfm/*`, `src/lib/integrations/reccobeats/*`, and `src/lib/integrations/llm/*`

### Requirement: Matching Exclusion Set

The matching stage SHALL accept an exclusion set and skip already-decided (song, playlist) pairs during scoring.

#### Scenario: Load exclusion set before matching
- **WHEN** preparing to run `matchBatch`
- **THEN** load `match_decision` rows (added + dismissed) for the account
- **AND** load `playlist_song` rows (songs already in playlists) for the account
- **AND** pass the combined exclusion set to the matching stage

#### Scenario: Skip excluded pairs
- **WHEN** scoring song X against playlist A
- **AND** `(X, A)` is in the exclusion set
- **THEN** do NOT compute a score
- **AND** do NOT create a `match_result` row

#### Scenario: Exclusion reduces computation
- **WHEN** user has dismissed song X (which dismissed it for playlists A, B) and song X is already in playlist C
- **THEN** only score song X against playlists D, E, etc. (non-excluded playlists)

---

### Requirement: Matching Stage Returns Song IDs

The matching stage SHALL return which songs received suggestions and which did not, not just aggregate counts.

#### Scenario: Matched songs identified
- **WHEN** matching completes
- **THEN** return an array of song IDs that received at least one `match_result` (score >= threshold)

#### Scenario: Unmatched songs identified
- **WHEN** matching completes
- **THEN** return an array of song IDs that received zero `match_result` rows (all scores below threshold or all pairs excluded)

#### Scenario: Matching skipped indicator
- **WHEN** matching is skipped (no playlists or no candidates)
- **THEN** return a flag indicating matching was skipped

---

### Requirement: Pipeline Writes item_status

The enrichment pipeline orchestrator SHALL write `item_status` for batch songs only to record candidate-side processing state, not published matching currency.

#### Scenario: All completed batch songs get item_status
- **WHEN** the orchestrator finishes the shared enrichment stages for a batch song
- **THEN** it SHALL create or update `item_status` for that song
- **AND** the row SHALL indicate pipeline processing completion for the account

#### Scenario: Pipeline processing does not depend on target playlists
- **WHEN** an enrichment chunk completes for an account with zero target playlists
- **THEN** the orchestrator SHALL still write `item_status` for completed batch songs
- **AND** it SHALL not wait for target-playlist refresh to publish a snapshot first

#### Scenario: Pipeline does not mark published new suggestions
- **WHEN** the enrichment pipeline finishes a chunk
- **THEN** it SHALL NOT set `is_new = true` based on chunk-level matching output
- **AND** it SHALL leave published suggestion newness to the refresh-owned snapshot write path

#### Scenario: Refresh publish marks new suggestions
- **WHEN** a target-playlist refresh publishes suggestions for liked songs
- **THEN** that publish path SHALL mark those songs as new in account-visible state
- **AND** `item_status` row existence SHALL continue to reflect pipeline processing state rather than snapshot ownership

---

### Requirement: Batch Selection Considers Per-User Processing

The enrichment pipeline batch selector SHALL use DB-side full-pipeline and data-enrichment selectors to choose liked songs based on missing shared enrichment artifacts and per-account pipeline processing state only, without giant app-side exclusion lists or snapshot responsibilities.

#### Scenario: Full-pipeline selector returns songs missing shared artifacts
- **WHEN** a liked song is missing any of the 4 shared data artifacts (audio features, genres, analysis, embedding)
- **THEN** the full-pipeline selector SHALL return that song for pipeline processing regardless of `item_status`
- **AND** selection SHALL happen in the database rather than by loading all processed IDs into application memory first

#### Scenario: Full-pipeline selector returns songs missing per-account pipeline completion only
- **WHEN** a liked song already has all 4 shared data artifacts
- **AND** the song has no `item_status` row for the account
- **THEN** the full-pipeline selector SHALL still return that song so the pipeline can record account-scoped processing completion
- **AND** shared enrichment stages MAY skip for that song because the artifacts already exist

#### Scenario: Full-pipeline selector skips fully pipeline-processed songs
- **WHEN** a liked song has all 4 shared data artifacts
- **AND** the song has an `item_status` row for the account
- **THEN** the full-pipeline selector SHALL NOT return that song for pipeline processing
- **AND** the selector SHALL not treat missing snapshot publication as pipeline-owned work

#### Scenario: Data-enrichment selector preserves refresh candidate semantics
- **WHEN** target-playlist refresh loads current liked-song candidates
- **THEN** the data-enrichment selector SHALL return liked songs that satisfy the 4 shared data-artifact requirements
- **AND** it SHALL NOT require account-scoped `item_status` for that refresh candidate set

#### Scenario: Selector execution avoids giant app-side exclusion lists
- **WHEN** the system selects the next liked songs needing enrichment or refresh eligibility
- **THEN** it SHALL use SQL, RPCs, or equivalent DB-native filtering to select those songs directly
- **AND** it SHALL NOT construct giant application-side `.not("song_id", "in", ...)` exclusion lists from already-processed IDs

#### Scenario: Terminal failures are filtered without app-side UUID lists
- **WHEN** liked songs have terminal enrichment failures recorded for the account
- **THEN** the full-pipeline selector SHALL exclude those songs through DB-side filtering or an equivalent DB-native join
- **AND** it SHALL avoid reintroducing large app-side exclusion lists for that failure state

#### Scenario: Queue chaining ignores snapshot publication state
- **WHEN** the pipeline determines whether more liked-song work remains for the account
- **THEN** the `hasMoreSongs` probe SHALL use the same full-pipeline selector semantics for remaining candidate-side work
- **AND** it SHALL NOT infer more work from missing `match_context`, missing `match_result`, or unpublished refresh state

---

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
