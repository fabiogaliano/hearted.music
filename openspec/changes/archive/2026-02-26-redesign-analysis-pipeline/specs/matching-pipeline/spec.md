# Matching Pipeline Specification (Delta)

> Changes to the matching pipeline from the `redesign-analysis-pipeline` change. This delta applies on top of the base spec at `openspec/specs/matching-pipeline/spec.md`.

---

## MODIFIED Requirements

### Requirement: Multi-Factor Matching

The system SHALL compute match scores using 3 complementary signals: embedding similarity, audio feature distance, and genre overlap. Default weights: embedding 0.50, audio 0.30, genre 0.20 (configurable).

#### Scenario: Embedding similarity computed
- **WHEN** matching a song to playlists
- **THEN** compute cosine similarity between the song embedding and the playlist profile embedding centroid

#### Scenario: Audio feature distance computed
- **WHEN** matching a song to playlists
- **THEN** compute weighted Euclidean distance between song audio features and playlist audio feature centroid

#### Scenario: Genre overlap computed
- **WHEN** matching a song to playlists
- **THEN** compare song genres against playlist genre distribution

#### Scenario: Weighted score aggregation
- **WHEN** all 3 factor scores are computed
- **THEN** aggregate using configurable weights: `{ embedding: 0.50, audio: 0.30, genre: 0.20 }`

---

### Requirement: Playlist Profiling

The system SHALL compute aggregate profiles for destination playlists using embedding centroid, audio feature centroid, and genre distribution.

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

### Requirement: Text Extraction for Embeddings

The system SHALL build a single embedding text per song composed from the analysis schema fields and genre metadata. Multiple `EmbeddingKind` variants are removed in favor of one unified text per song.

#### Scenario: Lyrical song text extraction
- **WHEN** embedding a lyrical song
- **THEN** compose text from: `headline`, `compound_mood`, `mood_description`, `interpretation`, theme names, theme descriptions, journey moods, `sonic_texture`, and genres (from Last.fm)

#### Scenario: Instrumental song text extraction
- **WHEN** embedding an instrumental song
- **THEN** compose text from: `headline`, `compound_mood`, `mood_description`, `sonic_texture`, and genres (from Last.fm)

#### Scenario: Consistent formatting
- **WHEN** extracting text
- **THEN** format consistently for embedding model (E5 instruction format)

#### Scenario: Single embedding per song
- **WHEN** embedding a song
- **THEN** produce exactly one embedding vector from the unified text
- **AND** do NOT produce separate embeddings for theme, mood, or context variants

---

## REMOVED Requirements

### Requirement: Flow Scoring

**REMOVED**

The system previously computed mood coherence scores using `GOOD_MOOD_TRANSITIONS` and `RELATED_MOODS` lookup tables via `computeFlowScore()`.

**Reason**: Embedding similarity captures mood coherence in continuous vector space without brittle lookup tables. A song's compound mood, mood description, and journey moods are all embedded, so cosine similarity between song and playlist embeddings inherently reflects mood compatibility.

**Migration**:
- Remove `computeFlowScore()` function
- Remove `GOOD_MOOD_TRANSITIONS` constant
- Remove `RELATED_MOODS` constant
- Remove `flow` field from `ScoreFactors` type

---

### Requirement: Context Scoring

**REMOVED**

The system previously compared `listening_contexts` (12 numeric scores per song) between songs and playlist profiles via `computeContextScore()`.

**Reason**: Embedding similarity captures situational fit through descriptive text. The analysis fields (mood description, sonic texture, headline) encode listening context implicitly, making explicit numeric context profiles redundant.

**Migration**:
- Remove `computeContextScore()` function
- Remove `listening_contexts` field from `MatchingSongAnalysis` type
- Remove listening context profiles from playlist profiling
- Remove `context` field from `ScoreFactors` type

---

### Requirement: Thematic String Matching

**REMOVED**

The system previously computed theme overlap using substring matching between song themes and playlist themes via `computeThematicScore()`.

**Reason**: Embedding similarity captures thematic overlap through the embedded theme names and descriptions. Substring matching is brittle (misses synonyms, partial matches) while embedding cosine similarity handles semantic proximity naturally.

**Migration**:
- Remove `computeThematicScore()` function
- Remove `semantic` field from `ScoreFactors` type
- Remove `SemanticMatcher` class from `capabilities/matching/semantic.ts`, keep standalone `cosineSimilarity()` function (still used by `MatchingService` for embedding vector comparison)

---

### Requirement: Emotion Distribution in Playlist Profiling

**REMOVED**

The system previously computed emotion frequency distribution from song analyses as part of playlist profiles.

**Reason**: Emotion distribution relied on structured mood enums that no longer exist in the new analysis schema. Compound moods are freeform strings, not enumerable categories. Embedding centroids already capture the aggregate emotional character of a playlist.

**Migration**:
- Remove `computeEmotionDistribution()` from `PlaylistProfilingService`
- Remove `emotionDistribution` field from `PlaylistProfile` type

---

## References

- [Base spec](/openspec/specs/matching-pipeline/spec.md) -- Original matching pipeline specification
- [Proposal](/openspec/changes/redesign-analysis-pipeline/proposal.md) -- Change proposal
- [analysis-schema spec](/openspec/changes/redesign-analysis-pipeline/specs/analysis-schema/spec.md) -- New analysis schema this delta depends on

---

*Created: February 7, 2026 -- redesign-analysis-pipeline change*
