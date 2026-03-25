## ADDED Requirements

### Requirement: Refresh workflow owns snapshot publication
The system SHALL use `target_playlist_match_refresh` as the only workflow and job type allowed to publish `match_context` and `match_result` for an account.

#### Scenario: Sync or onboarding requests refresh
- **WHEN** sync, target playlist selection, manual action, or enrichment drain determines that the published suggestion set may have changed
- **THEN** the system SHALL create or reuse an account-scoped `target_playlist_match_refresh` job
- **AND** the job progress SHALL persist a `TargetPlaylistRefreshPlan`

#### Scenario: Single active refresh coalesces triggers
- **WHEN** an account already has a pending or running `target_playlist_match_refresh` job
- **THEN** the system SHALL NOT create a second active refresh job
- **AND** the existing job SHALL record `rerunRequested = true` when another refresh-triggering change arrives

#### Scenario: Liked-song enrichment never publishes snapshots
- **WHEN** the liked-song enrichment pipeline completes a chunk or drains its queue
- **THEN** it SHALL NOT write `match_context` or `match_result`
- **AND** it MAY only request `target_playlist_match_refresh` follow-on work

### Requirement: Refresh publishes full current snapshots
The system SHALL publish snapshots that represent the full current target playlist set and the full current set of data-enriched liked-song candidates.

#### Scenario: Target playlists exist
- **WHEN** a refresh job executes and one or more current target playlists exist
- **THEN** the system SHALL load the current target playlist profiles and all current data-enriched liked songs for the account
- **AND** it SHALL publish one full snapshot for that combined state rather than a partial chunk snapshot

#### Scenario: No target playlists remain
- **WHEN** a refresh job executes and the current target playlist set is empty
- **THEN** the system SHALL write an explicit empty snapshot
- **AND** it SHALL NOT run target-playlist profiling, matching, or lightweight target-playlist-song enrichment

#### Scenario: No data-enriched liked songs are available
- **WHEN** a refresh job executes and target playlists exist but zero data-enriched liked songs are currently eligible as candidates
- **THEN** the system SHALL still publish a snapshot for the current target playlist set
- **AND** that snapshot SHALL contain zero published matches

#### Scenario: Target playlist removal refreshes against remaining targets
- **WHEN** a refresh job executes after a target playlist was removed or toggled off and one or more target playlists still remain
- **THEN** the system SHALL recompute the snapshot against only the remaining current target playlists
- **AND** it SHALL NOT retain published matches that depend on the removed target playlist from the previous snapshot

### Requirement: Refresh publication is atomic and deduplicated
The system SHALL publish snapshot state atomically and skip writes when the current published state is unchanged.

#### Scenario: Equivalent snapshot already published
- **WHEN** the refresh workflow computes a `contextHash` equivalent to the latest published snapshot for the account
- **THEN** it SHALL NOT create a new `match_context`
- **AND** it SHALL NOT insert duplicate `match_result` rows

#### Scenario: Publish failure during snapshot write
- **WHEN** a snapshot write fails after refresh computation starts
- **THEN** the previous latest snapshot SHALL remain the published truth
- **AND** the failed refresh SHALL NOT expose a half-written latest snapshot

#### Scenario: Successful publish marks new suggestions
- **WHEN** a refresh publish creates a new snapshot with suggestions
- **THEN** the system SHALL write `match_context` and `match_result` together
- **AND** it SHALL mark liked songs with published suggestions as `is_new`

### Requirement: Refresh controls target-playlist-only lightweight enrichment
The system SHALL optionally run lightweight enrichment for target-playlist songs that are not currently liked songs before profiling target playlists.

#### Scenario: Plan requests target-playlist-song enrichment
- **WHEN** `TargetPlaylistRefreshPlan.shouldEnrichTargetPlaylistSongs` is true
- **THEN** the refresh workflow SHALL select songs that belong to current target playlists but are not currently liked by the account
- **AND** it SHALL run the lightweight target-playlist-song enrichment path before loading target playlist profiles

#### Scenario: Plan skips target-playlist-song enrichment
- **WHEN** `TargetPlaylistRefreshPlan.shouldEnrichTargetPlaylistSongs` is false
- **THEN** the refresh workflow SHALL skip the lightweight target-playlist-song enrichment step
- **AND** it SHALL continue with current cached or recomputed target playlist profiles

#### Scenario: Metadata-only target changes skip target-playlist-song enrichment
- **WHEN** the refresh plan was built from target playlist metadata-only changes
- **THEN** `TargetPlaylistRefreshPlan.shouldEnrichTargetPlaylistSongs` SHALL be false
- **AND** the refresh workflow SHALL reuse cached profiles when valid and recompute only stale or missing profiles

#### Scenario: Liked-song removal skips target-playlist-song enrichment
- **WHEN** the refresh plan was built because liked songs were removed from the candidate set
- **THEN** `TargetPlaylistRefreshPlan.shouldEnrichTargetPlaylistSongs` SHALL be false
- **AND** the refresh workflow SHALL publish against the current target playlist set without running target-playlist-song enrichment

#### Scenario: Song belongs to both target playlists and liked songs
- **WHEN** a song is currently liked by the account and also belongs to a target playlist
- **THEN** the lightweight target-playlist-song selector SHALL exclude that song
- **AND** candidate-side enrichment for that song SHALL remain owned by the liked-song enrichment pipeline

### Requirement: Refresh re-reads current state on each pass
The system SHALL treat the persisted refresh plan as a hint and re-read current database state at execution time.

#### Scenario: Mid-flight change requests follow-up pass
- **WHEN** another refresh-triggering change arrives while a refresh job is already running
- **THEN** the active job SHALL record `rerunRequested = true`
- **AND** the worker SHALL run one additional refresh pass against current database state after the in-flight pass finishes

#### Scenario: Persisted plan differs from current database state
- **WHEN** execution starts with a stored `TargetPlaylistRefreshPlan`
- **THEN** the refresh workflow SHALL use the plan only to choose optional work such as target-playlist-song enrichment
- **AND** it SHALL determine the actual target playlist set and candidate set from current database rows
