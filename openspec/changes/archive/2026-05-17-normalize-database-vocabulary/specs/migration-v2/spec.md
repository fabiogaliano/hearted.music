## MODIFIED Requirements

### Requirement: Domain Language Naming

The system SHALL use user-friendly domain terminology throughout the codebase and database schema.

#### Scenario: Per-item job failure naming is explicit
- **WHEN** tracking failures for songs or playlists attempted inside a job
- **THEN** use `job_item_failure` rather than `job_failure`
- **AND** job-row terminal status SHALL remain on the `job` table

#### Scenario: Account item newness naming is explicit
- **WHEN** tracking whether an account has new or viewed songs/playlists
- **THEN** use `account_item_newness` rather than `item_status`
- **AND** user matching decisions SHALL remain in `match_decision`

#### Scenario: Extension token naming is explicit
- **WHEN** storing bearer tokens used by the Chrome extension API
- **THEN** use `extension_api_token` rather than a general `api_token` table name

### Requirement: Newness Tracking

The system SHALL track "new" status for items in `account_item_newness` to display badges in the UI.

#### Scenario: New songs synced
- **WHEN** new liked songs are synced from Spotify
- **THEN** create `account_item_newness` records with `is_new = true`

#### Scenario: View-based clearing
- **WHEN** user views a new item for 2+ seconds
- **THEN** set `viewed_at` and clear `is_new`

#### Scenario: Account item newness table exists
- **WHEN** the schema is initialized
- **THEN** `account_item_newness` table exists with account_id, item_type, item_id, is_new, viewed_at, and timestamps

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules owned by bounded contexts instead of repository classes.

#### Scenario: Newness module provides account item newness tracking
- **WHEN** services need to track new or viewed items
- **THEN** import from `src/lib/domains/library/liked-songs/status-queries.ts`

### Requirement: Job Failure Tracking

The system SHALL track item-level failures for job attempts in `job_item_failure`.

#### Scenario: Job item failure row created
- **WHEN** a job stage fails for a song or playlist item
- **THEN** create `job_item_failure` with `job_id`, `item_type`, `item_id`, `stage`, `failure_code`, `error_message`, and lifecycle metadata
