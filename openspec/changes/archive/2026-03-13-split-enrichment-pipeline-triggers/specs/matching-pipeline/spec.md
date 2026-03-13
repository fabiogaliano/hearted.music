## MODIFIED Requirements

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
- **WHEN** song analysis changes OR playlist contents change OR playlist profile inputs change OR config changes OR model/version changes
- **THEN** context hash naturally differs, causing fresh computation

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
