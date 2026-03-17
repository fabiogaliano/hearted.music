## ADDED Requirements

### Requirement: Matching targets destination playlists only

The matching stage SHALL only match songs against playlists marked as destinations.

#### Scenario: Destination playlist filtering
- **WHEN** the matching stage selects playlists to match against
- **THEN** it SHALL query playlists where `is_destination = true`
- **AND** it SHALL exclude playlists without a computed `playlist_profile`

#### Scenario: No destination playlists
- **WHEN** onboarding has not yet saved any destination playlists, or zero selected destination playlists have profiles
- **THEN** the matching stage SHALL skip execution
- **AND** report a skip reason indicating that no destination playlists have been selected yet or profiled yet

---

### Requirement: Match context per pipeline run

Each pipeline run SHALL create a new `match_context` to track the matching configuration snapshot.

#### Scenario: Context creation
- **WHEN** the matching stage runs
- **THEN** it SHALL create a `match_context` row with the current algorithm version, weights, and hashes

#### Scenario: Latest context used for queries
- **WHEN** downstream consumers (e.g., the matching UI) query match results
- **THEN** they SHALL use the most recent `match_context` for the account (ordered by `created_at` descending)

---

## MODIFIED Requirements

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

#### Scenario: Incremental candidate set
- **WHEN** a re-sync adds new songs but existing songs are unchanged
- **THEN** the candidate set hash SHALL differ (new songs included)
- **AND** a fresh `match_context` SHALL be created
- **AND** existing match results for unchanged songs MAY be recomputed (acceptable for v1)
