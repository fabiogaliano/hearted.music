# target-playlist-match-refresh Specification

> Single workflow and job type responsible for publishing match snapshots (`match_context` + `match_result`) for an account's target playlist set.

---

## Purpose

TBD - Define the target-playlist match refresh workflow that owns all snapshot publication, coalesces concurrent triggers, controls target-playlist-only lightweight enrichment, and re-reads current database state on each pass.

---

## Requirements

### Requirement: Refresh workflow owns snapshot publication
The system SHALL use `match_snapshot_refresh` as the only workflow and durable job type allowed to publish `match_context` and `match_result` for an account, while library-processing owns follow-on scheduling.

#### Scenario: Library-processing ensures refresh when state is stale
- **WHEN** sync, onboarding, or a worker outcome leaves `matchSnapshotRefresh` stale in `library_processing_state`
- **THEN** the system SHALL create or reuse an account-scoped `match_snapshot_refresh` job
- **AND** it SHALL do so through library-processing job ensuring rather than direct refresh trigger policy scattered across callers

#### Scenario: Single active refresh job exists per account
- **WHEN** an account already has a pending or running `match_snapshot_refresh` job for the current stale request marker
- **THEN** the system SHALL NOT create a second active refresh job for that account
- **AND** the active job association SHALL be tracked through library-processing state and job uniqueness rather than `rerunRequested` orchestration in `job.progress`

#### Scenario: Liked-song enrichment never publishes snapshots
- **WHEN** the liked-song enrichment pipeline completes a chunk or settles its current request marker
- **THEN** it SHALL NOT write `match_context` or `match_result`
- **AND** it MAY only report outcomes back to library-processing so refresh ownership stays singular

---

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

---

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

---

### Requirement: Refresh controls target-playlist-only lightweight enrichment
The system SHALL optionally run lightweight enrichment for target-playlist songs that are not currently liked songs before profiling target playlists, based on an execution hint derived when the job is ensured.

#### Scenario: Ensure-time state requests target-playlist-song enrichment
- **WHEN** current database state shows that target-playlist refresh needs target-playlist-only song enrichment
- **THEN** the ensured `match_snapshot_refresh` job SHALL carry `needsTargetSongEnrichment = true`
- **AND** the refresh workflow SHALL run the lightweight target-playlist-song enrichment path before loading target playlist profiles

#### Scenario: Metadata-only target changes skip target-playlist-song enrichment
- **WHEN** refresh was requested only because target playlist metadata changed
- **THEN** the ensured `match_snapshot_refresh` job SHALL carry `needsTargetSongEnrichment = false`
- **AND** the refresh workflow SHALL skip target-playlist-song enrichment for that pass

#### Scenario: Liked-song removal skips target-playlist-song enrichment
- **WHEN** refresh was requested because liked songs were removed from the candidate set
- **THEN** the ensured `match_snapshot_refresh` job SHALL carry `needsTargetSongEnrichment = false`
- **AND** the refresh workflow SHALL publish against the current target playlist set without running target-playlist-song enrichment

#### Scenario: Song belongs to both target playlists and liked songs
- **WHEN** a song is currently liked by the account and also belongs to a target playlist
- **THEN** the lightweight target-playlist-song selector SHALL exclude that song
- **AND** candidate-side enrichment for that song SHALL remain owned by the liked-song enrichment pipeline

---

### Requirement: Refresh re-reads current state on each pass
The system SHALL execute each `match_snapshot_refresh` job as a single pass against current database state, treating any ensure-time execution hint as optional input and leaving repeated passes to library-processing.

#### Scenario: Mid-flight change requests a later pass through the scheduler
- **WHEN** another refresh-triggering change arrives while a `match_snapshot_refresh` job is already running
- **THEN** the in-flight job SHALL remain a single pass
- **AND** library-processing SHALL ensure a later stale refresh job after settlement instead of setting `rerunRequested = true`

#### Scenario: Ensure-time hint differs from current database state
- **WHEN** execution starts with an ensure-time hint such as `needsTargetSongEnrichment`
- **THEN** the refresh workflow SHALL still determine the actual target playlist set and candidate set from current database rows at execution time
- **AND** it SHALL treat the hint only as optional guidance for extra execution work
