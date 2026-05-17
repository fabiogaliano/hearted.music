## MODIFIED Requirements

### Requirement: New Item Tracking

The system SHALL track when account-scoped items become "new" in `account_item_newness` to display badges.

#### Scenario: New songs synced
- **WHEN** new liked songs sync from Spotify
- **THEN** create or update an `account_item_newness` record with `is_new = true`

#### Scenario: New match suggestions generated
- **WHEN** enrichment pipeline or match snapshot refresh produces `match_result` rows for songs
- **THEN** call `markItemsNew` for songs that received at least one match suggestion
- **AND** set `is_new = true` on those `account_item_newness` records

#### Scenario: New playlists discovered
- **WHEN** new playlists sync from Spotify
- **THEN** create or update an `account_item_newness` record with `is_new = true`

### Requirement: Badge Counts

The system SHALL display counts of items in navigation, distinguishing total actionable from new.

#### Scenario: Dashboard "new songs" count (new only)
- **WHEN** rendering the dashboard "Ready to match" widget
- **THEN** show count of songs with actionable suggestions that the user has NOT yet seen
- **AND** query: join `match_result` with `account_item_newness` where `is_new = true` for the latest snapshot/result set

#### Scenario: Stats RPC returns new_suggestions
- **WHEN** calling `get_liked_songs_stats`
- **THEN** the return type SHALL include a `new_suggestions` column
- **AND** `new_suggestions` SHALL count songs with undecided `match_result` rows AND `account_item_newness.is_new = true`

### Requirement: Action-Based Clearing

The system SHALL clear "new" status via session-based batch `markSeen` when the user leaves the matching page, decoupled from individual actions. User decisions are recorded in `match_decision`, not `account_item_newness`.

#### Scenario: Add to playlist
- **WHEN** user adds song to a specific playlist
- **THEN** insert `match_decision(song_id, playlist_id, 'added')`
- **AND** `is_new` is NOT cleared immediately — clearing happens on session end

### Requirement: Matching Status Derivation

The system SHALL derive matching status from `match_result` and `match_decision` records, NOT from account-item newness action columns.

#### Scenario: Song has no suggestions
- **WHEN** a song has no `match_result` rows in the latest snapshot/result set
- **AND** the song has an `account_item_newness` row indicating candidate-side processing reached a visible state
- **THEN** the song's matching status is `no_suggestions`

#### Scenario: Song is pending
- **WHEN** a song has no `account_item_newness` row
- **THEN** the song's matching status is `pending`

## ADDED Requirements

### Requirement: Account item newness schema

The system SHALL store account-scoped item newness in `account_item_newness`.

#### Scenario: Account item newness table exists
- **WHEN** the schema is initialized
- **THEN** `account_item_newness` table exists with `account_id`, `item_type`, `item_id`, `is_new`, `viewed_at`, and timestamps
- **AND** it SHALL have a unique constraint over `(account_id, item_type, item_id)`
