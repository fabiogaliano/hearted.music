## ADDED Requirements

### Requirement: Matching Status Derivation

The system SHALL derive matching status from `item_status` records, making `item_status` the single source of truth for both newness tracking and matching status.

#### Scenario: Song is pending
- **WHEN** a liked song has no `item_status` record (or `actioned_at IS NULL`)
- **THEN** the song's matching status is `pending`

#### Scenario: Song is matched via playlist
- **WHEN** a liked song has an `item_status` record with `action_type = 'added_to_playlist'`
- **THEN** the song's matching status is `matched`

#### Scenario: Song is ignored
- **WHEN** a liked song has an `item_status` record with `action_type = 'skipped'` or `action_type = 'dismissed'`
- **THEN** the song's matching status is `ignored`

#### Scenario: SQL functions use item_status for filtering
- **WHEN** `get_liked_songs_page` filters by `matched` or `pending`
- **THEN** it SHALL JOIN on `item_status` and filter by presence/absence of actioned records

#### Scenario: SQL functions use item_status for counting
- **WHEN** `get_liked_songs_stats` counts matched and pending songs
- **THEN** it SHALL JOIN on `item_status` and count based on `actioned_at` and `action_type`

## MODIFIED Requirements

### Requirement: Action-Based Clearing

The system SHALL clear "new" status when user takes action. These actions also establish matching status.

#### Scenario: Add to playlist
- **WHEN** user adds song to playlist
- **THEN** set `actioned_at`, `action_type = 'added_to_playlist'`, clear `is_new`
- **AND** the song's matching status becomes `matched`

#### Scenario: Skip song
- **WHEN** user skips a song
- **THEN** set `actioned_at`, `action_type = 'skipped'`, clear `is_new`
- **AND** the song's matching status becomes `ignored`

#### Scenario: Dismiss notification
- **WHEN** user dismisses a new item notification
- **THEN** set `actioned_at`, `action_type = 'dismissed'`, clear `is_new`
- **AND** the song's matching status becomes `ignored`
