## ADDED Requirements

### Requirement: Re-match Operation

The system SHALL provide a re-match operation that runs matching on all data-enriched songs without going through the full enrichment pipeline (stages A-D).

#### Scenario: Re-match triggered by playlist change
- **WHEN** sync completes and `playlistSetHash` differs from the latest `match_context.playlist_set_hash` for the account
- **THEN** run a re-match pass on all data-enriched songs for the account

#### Scenario: Re-match skipped when playlists unchanged
- **WHEN** sync completes and `playlistSetHash` matches the latest `match_context.playlist_set_hash`
- **THEN** do NOT run re-matching
- **AND** do NOT create a new enrichment job for this purpose

#### Scenario: Re-match scope includes all data-enriched songs
- **WHEN** running a re-match pass
- **THEN** include ALL songs that have completed data enrichment (4 shared artifacts exist)
- **AND** load the exclusion set (match_decisions + playlist_songs) before scoring
- **AND** skip excluded (song, playlist) pairs at scoring time

### Requirement: Re-match is Separate from Pipeline

The re-match operation SHALL NOT go through the enrichment pipeline's batch selection or stage execution.

#### Scenario: No data re-enrichment
- **WHEN** running a re-match pass
- **THEN** do NOT run audio features, genre tagging, song analysis, or song embedding stages
- **AND** only run playlist profiling and matching

#### Scenario: Does not delete item_status
- **WHEN** re-match completes
- **THEN** do NOT delete existing `item_status` rows
- **AND** SHALL update `is_new = true` via `markItemsNew` for songs that receive new match suggestions
- **AND** `item_status` row existence reflects pipeline processing state, not matching currency

#### Scenario: Creates new match context
- **WHEN** re-match produces results
- **THEN** create a new `match_context` row with the current context hash
- **AND** create `match_result` rows for all non-excluded, above-threshold (song, playlist) pairs

### Requirement: Playlist Change Detection

The system SHALL detect playlist profile changes by comparing hash values.

#### Scenario: Compute current playlist set hash
- **WHEN** checking for playlist changes
- **THEN** compute `playlistSetHash` from current playlist profiles using the same hashing logic as `computeMatchContextMetadata`

#### Scenario: Compare against latest context
- **WHEN** current `playlistSetHash` is computed
- **THEN** look up the latest `match_context` for the account
- **AND** compare `playlist_set_hash` values

#### Scenario: First sync with playlists (no prior context)
- **WHEN** no `match_context` exists for the account
- **AND** playlists exist
- **THEN** treat as a change (run matching as part of the initial pipeline)

### Requirement: Re-match Trigger Integration

The re-match operation SHALL be triggered from the sync flow when playlist changes are detected.

#### Scenario: Sync triggers re-match check
- **WHEN** `requestEnrichment(accountId)` is called after sync
- **THEN** check for playlist profile changes before or after creating the enrichment job

#### Scenario: Re-match runs as background job
- **WHEN** playlist changes are detected
- **THEN** the re-match operation SHALL run as a background job via the worker
- **AND** use the same job infrastructure (claim, heartbeat, completion) as enrichment jobs
