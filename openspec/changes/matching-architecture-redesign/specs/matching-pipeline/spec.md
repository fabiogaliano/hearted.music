## ADDED Requirements

### Requirement: Matching Exclusion Set

The matching stage SHALL accept an exclusion set and skip already-decided (song, playlist) pairs during scoring.

#### Scenario: Load exclusion set before matching
- **WHEN** preparing to run `matchBatch`
- **THEN** load `match_decision` rows (added + dismissed) for the account
- **AND** load `playlist_track` rows (songs already in playlists) for the account
- **AND** pass the combined exclusion set to the matching stage

#### Scenario: Skip excluded pairs
- **WHEN** scoring song X against playlist A
- **AND** `(X, A)` is in the exclusion set
- **THEN** do NOT compute a score
- **AND** do NOT create a `match_result` row

#### Scenario: Exclusion reduces computation
- **WHEN** user has dismissed song X (which dismissed it for playlists A, B) and song X is already in playlist C
- **THEN** only score song X against playlists D, E, etc. (non-excluded playlists)

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

### Requirement: Pipeline Writes item_status

The enrichment pipeline orchestrator SHALL write `item_status` for all batch songs after matching completes.

#### Scenario: All batch songs get item_status
- **WHEN** the orchestrator finishes processing a batch (stages A-D + matching)
- **THEN** create or update `item_status` for every song in the batch

#### Scenario: Songs with suggestions marked as new
- **WHEN** a song received at least one `match_result`
- **THEN** call `markItemsNew` for that song
- **AND** set `is_new = true` on the `item_status` record

#### Scenario: Songs without suggestions still tracked
- **WHEN** a song received zero `match_result` rows
- **THEN** still create an `item_status` row (marking the song as pipeline-processed)
- **AND** set `is_new = false`

#### Scenario: Matching skipped still writes item_status
- **WHEN** matching was skipped (no playlists)
- **THEN** still create `item_status` rows for all batch songs
- **AND** set `is_new = false`

### Requirement: Batch Selection Considers Per-User Processing

The batch selection SHALL check both shared data artifacts and per-user `item_status` to determine which songs need processing.

#### Scenario: Song needs data enrichment
- **WHEN** a song is missing any of the 4 shared data artifacts (audio features, genres, analysis, embedding)
- **THEN** the song SHALL be selected for pipeline processing regardless of `item_status`

#### Scenario: Song needs matching for this user
- **WHEN** a song has all 4 shared data artifacts
- **AND** the song has no `item_status` row for this user
- **THEN** the song SHALL be selected for pipeline processing (stages A-D will skip, matching will run)

#### Scenario: Song fully processed
- **WHEN** a song has all 4 shared data artifacts
- **AND** the song has an `item_status` row for this user
- **THEN** the song SHALL NOT be selected for pipeline processing

#### Scenario: hasMoreSongs when matching skipped
- **WHEN** matching was skipped (no playlists)
- **THEN** the `hasMoreSongs` probe SHALL only check for songs missing shared data artifacts
- **AND** SHALL NOT count songs that only need matching (to prevent infinite chaining)

## MODIFIED Requirements

### Requirement: Cache-First Matching

The matching pipeline SHALL use cache-first matching with context hash deduplication. The `matchBatch` return type SHALL use `unmatched` instead of `failed` for songs with no suggestions.

#### Scenario: No ready candidates
- **WHEN** there are no liked-song candidates ready for matching
- **THEN** the matching stage SHALL skip execution
- **AND** it SHALL NOT use `item_status` as a proxy for "matching completed"

#### Scenario: Unmatched songs terminology
- **WHEN** a song has zero matches above the score threshold (0.3)
- **THEN** the song SHALL be reported as `unmatched` (not `failed`)
- **AND** `BatchMatchResult.unmatched` SHALL contain the song ID
