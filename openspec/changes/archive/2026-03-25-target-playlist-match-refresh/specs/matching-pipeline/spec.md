## MODIFIED Requirements

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

### Requirement: Batch Selection Considers Per-User Processing

The enrichment pipeline batch selector SHALL choose liked songs based on missing shared enrichment artifacts and per-account pipeline processing state only, without treating snapshot publication as a pipeline responsibility.

#### Scenario: Song needs data enrichment
- **WHEN** a liked song is missing any of the 4 shared data artifacts (audio features, genres, analysis, embedding)
- **THEN** the song SHALL be selected for pipeline processing regardless of `item_status`

#### Scenario: Song needs per-account pipeline completion only
- **WHEN** a liked song already has all 4 shared data artifacts
- **AND** the song has no `item_status` row for the account
- **THEN** the song SHALL still be selected so the pipeline can record account-scoped processing completion
- **AND** shared enrichment stages MAY skip for that song because the artifacts already exist
- **AND** the selector SHALL NOT treat this case as pipeline-owned matching work

#### Scenario: Song fully pipeline-processed
- **WHEN** a liked song has all 4 shared data artifacts
- **AND** the song has an `item_status` row for the account
- **THEN** the song SHALL NOT be selected for pipeline processing

#### Scenario: Queue chaining ignores snapshot publication state
- **WHEN** the pipeline determines whether more liked-song work remains for the account
- **THEN** the `hasMoreSongs` probe SHALL consider only remaining candidate-side enrichment or missing per-account pipeline-processing state
- **AND** it SHALL NOT infer more work from missing `match_context`, missing `match_result`, or unpublished refresh state
