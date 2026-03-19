# Match Decisions Specification

> Permanent user decisions about match suggestions stored with per-(song, playlist) granularity.

---

## Purpose

TBD - Define the match_decision table and decision types that track user actions (add, dismiss) on match suggestions, providing an exclusion set for future matching and enabling actionable suggestion queries.

---

## Requirements

### Requirement: Match Decision Table

The system SHALL store permanent user decisions about match suggestions in a `match_decision` table with per-(song, playlist) granularity.

```sql
CREATE TABLE match_decision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,  -- 'added' | 'dismissed'
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, song_id, playlist_id)
);

CREATE INDEX idx_match_decision_account ON match_decision(account_id);
CREATE INDEX idx_match_decision_song ON match_decision(account_id, song_id);
```

#### Scenario: User adds song to playlist
- **WHEN** user clicks "Add" for song X on playlist A
- **THEN** upsert `match_decision(account_id, song_id=X, playlist_id=A, decision='added')`

#### Scenario: User dismisses song (batch decline)
- **WHEN** user clicks "Dismiss" on a song showing suggestions for playlists A, B, C
- **THEN** batch insert `match_decision` with `decision='dismissed'` for each of (X, A), (X, B), (X, C)

#### Scenario: Next is not persisted
- **WHEN** user clicks "Next Song"
- **THEN** no `match_decision` row is created
- **AND** the song reappears on next visit to the matching page

---

### Requirement: Decision Types

The system SHALL support exactly two permanent decision types.

#### Scenario: Added decision
- **WHEN** `decision = 'added'`
- **THEN** the song has been placed in this playlist by the user
- **AND** this (song, playlist) pair SHALL NOT be suggested again

#### Scenario: Declined decision
- **WHEN** `decision = 'dismissed'`
- **THEN** the user explicitly rejected this song for this playlist
- **AND** this (song, playlist) pair SHALL NOT be suggested again

#### Scenario: No song-level permanent exclusion
- **WHEN** a user declines song X for playlists A, B, C
- **AND** playlist D is added later
- **THEN** song X SHALL be evaluated against playlist D (no `match_decision` exists for D)

---

### Requirement: Exclusion Set for Matching

The system SHALL load existing decisions and playlist membership before matching to skip already-decided pairs at scoring time.

#### Scenario: Load exclusion set
- **WHEN** preparing to run matching for an account
- **THEN** load all `match_decision` rows (added + declined) for the account
- **AND** load all `playlist_song` rows (songs already in playlists) for the account
- **AND** combine into an exclusion set of `(song_id, playlist_id)` pairs

#### Scenario: Skip excluded pairs during scoring
- **WHEN** scoring song X against playlist A
- **AND** `(X, A)` is in the exclusion set
- **THEN** skip scoring entirely — no `match_result` row SHALL be created

#### Scenario: Only actionable suggestions in match_result
- **WHEN** matching completes
- **THEN** all `match_result` rows represent actionable suggestions (no previously decided or already-present pairs)

---

### Requirement: Actionable Suggestions Query

The system SHALL derive actionable suggestions from `match_result` for the latest `match_context`.

#### Scenario: Sidebar badge count (total actionable)
- **WHEN** computing the sidebar "Match Songs" badge count
- **THEN** count distinct `song_id` values in `match_result` for the latest `match_context` of the account
- **AND** this count includes both new and previously seen/skipped songs

#### Scenario: Dashboard badge count (new only)
- **WHEN** computing the dashboard "X new songs" count
- **THEN** count distinct `song_id` values in `match_result` for the latest `match_context`
- **AND** filter to songs where `item_status.is_new = true`

#### Scenario: Matching page song list ordering
- **WHEN** rendering the matching page song queue
- **THEN** query `match_result` for the latest `match_context`
- **AND** order new songs first (`item_status.is_new DESC`), then by score descending

#### Scenario: Playlist suggestions for a song
- **WHEN** showing playlist suggestions for song X
- **THEN** return `match_result` rows for song X in the latest context, ordered by score descending
