## MODIFIED Requirements

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules instead of repository classes.

#### Scenario: Data access pattern
- **WHEN** accessing database from services
- **THEN** import functions from `data/*.ts` modules (not repository classes)

#### Scenario: Module organization
- **WHEN** organizing data access code
- **THEN** create domain-focused modules: `songs.ts`, `playlists.ts`, `analysis.ts`, `vectors.ts`, `matching.ts`, `jobs.ts`, `accounts.ts`, `newness.ts`, `preferences.ts`

#### Scenario: Playlists module provides complete playlist access
- **WHEN** services need to query or modify playlists
- **THEN** use `data/playlists.ts` functions: `getPlaylistById`, `getPlaylistBySpotifyId`, `getPlaylists`, `upsertPlaylists`, `deletePlaylist`

#### Scenario: Playlists module provides destination queries
- **WHEN** services need to find destination playlists for sorting
- **THEN** use `data/playlists.ts` functions: `getDestinationPlaylists`, `setPlaylistDestination`

#### Scenario: Playlists module provides playlist-song operations
- **WHEN** services need to manage songs within playlists
- **THEN** use `data/playlists.ts` functions: `getPlaylistSongs`, `upsertPlaylistSongs`, `removePlaylistSongs`

#### Scenario: Jobs module provides complete job access
- **WHEN** services need to query or modify jobs
- **THEN** use `data/jobs.ts` functions: `getJobById`, `getActiveJob`, `getLatestJob`, `createJob`

#### Scenario: Jobs module provides status transitions
- **WHEN** services need to update job status
- **THEN** use `data/jobs.ts` functions: `markJobRunning`, `markJobCompleted`, `markJobFailed`

#### Scenario: Jobs module provides progress tracking
- **WHEN** services need to report job progress
- **THEN** use `data/jobs.ts` function: `updateJobProgress(id, { total, done, succeeded, failed, cursor? })`

#### Scenario: All query functions return Result types
- **WHEN** implementing data layer functions
- **THEN** return `Result<T, DbError>` for single items and `Result<T[], DbError>` for collections

### Requirement: Sync Checkpoint Tracking

The system SHALL persist sync checkpoints in `job.progress` for incremental sync of liked songs and playlists.

#### Scenario: Checkpoint recorded
- **WHEN** a sync completes
- **THEN** store the last cursor or timestamp in `job.progress` for that account and sync type

#### Scenario: Sync resumes from checkpoint
- **WHEN** a sync starts and a checkpoint exists
- **THEN** continue from the stored cursor or timestamp in the latest sync job

#### Scenario: Checkpoint retrieved via jobs module
- **WHEN** services need the last sync checkpoint
- **THEN** use `getLatestJob(accountId, type)` and read `progress.cursor` from the result
