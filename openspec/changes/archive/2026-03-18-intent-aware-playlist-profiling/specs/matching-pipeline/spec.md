## MODIFIED Requirements

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

### Requirement: Cache-First Matching

The system SHALL use cache-first pattern to avoid redundant computation, including pipeline-triggered reruns of the same matching inputs.

#### Scenario: Cache key computation
- **WHEN** matching is requested
- **THEN** compute context hash from playlist set hash + candidate set hash + config hash + model/version hash

#### Scenario: Deterministic pipeline context identity
- **WHEN** the enrichment pipeline matching stage prepares to run
- **THEN** it SHALL compute the same materially relevant matching hashes before creating a tracked matching job
- **AND** `playlistSetHash` SHALL be derived from playlist/profile inputs that affect the result, not playlist IDs alone
- **AND** `candidateSetHash` SHALL be derived from candidate content that affects the result, not song IDs alone
- **AND** the stage SHALL use the same hashing primitives as the cache-first matching path where practical

#### Scenario: Cache hit
- **WHEN** context hash matches existing `match_context`
- **THEN** return cached `match_result` rows without recomputation

#### Scenario: Identical pipeline rerun
- **WHEN** the pipeline matching stage finds an existing `match_context` for the same account and computed `contextHash`
- **THEN** it SHALL NOT create a duplicate `match_context`
- **AND** it SHALL return a no-op stage result instead of recomputing matches

#### Scenario: Cache miss
- **WHEN** context hash is new
- **THEN** compute matches, create `match_context`, and store `match_result` rows
- **AND** the stored context metadata SHALL use `MATCHING_ALGO_VERSION` rather than a hardcoded version string

#### Scenario: Cache invalidation
- **WHEN** song analysis changes OR playlist contents change OR playlist profile inputs change OR playlist name/description changes OR config changes OR model/version changes
- **THEN** context hash naturally differs, causing fresh computation

#### Scenario: Profile content hash includes intent text
- **WHEN** computing playlist profile content hash
- **THEN** intent text (name + description) SHALL always be included in the hash input
- **AND** the hash SHALL NOT gate intent text inclusion on whether song embeddings exist

#### Scenario: Incremental candidate set
- **WHEN** a re-sync adds new songs but existing songs are unchanged
- **THEN** the candidate set hash SHALL differ
- **AND** a fresh `match_context` MAY be created

#### Scenario: No destination playlists
- **WHEN** onboarding has not yet saved any destination playlists, or zero selected destination playlists have profiles
- **THEN** the matching stage SHALL skip execution
- **AND** report a skip reason indicating that no destination playlists have been selected yet or profiled yet

#### Scenario: No ready candidates
- **WHEN** there are no liked-song candidates ready for matching
- **THEN** the matching stage SHALL skip execution
- **AND** it SHALL NOT use `item_status` as a proxy for "matching completed"

#### Scenario: Missing prerequisites
- **WHEN** matching inputs are incomplete because required enrichment prerequisites are not ready yet
- **THEN** the matching stage SHALL skip execution instead of failing the pipeline
