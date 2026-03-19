## ADDED Requirements

### Requirement: Session Initialization

The system SHALL provide a `getMatchingSession` server function that returns the current matching context and total count of undecided songs for an account.

#### Scenario: Account has undecided match results
- **WHEN** calling `getMatchingSession` for an account with a `match_context` and undecided `match_result` rows
- **THEN** return `{ contextId, totalSongs }` where `totalSongs` is the count of distinct songs with at least one `match_result` not covered by a `match_decision`

#### Scenario: No match context exists
- **WHEN** calling `getMatchingSession` for an account with no `match_context`
- **THEN** return `null`

#### Scenario: All songs fully decided
- **WHEN** calling `getMatchingSession` for an account where every `match_result` has a corresponding `match_decision`
- **THEN** return `{ contextId, totalSongs: 0 }`

### Requirement: Song Match Loading

The system SHALL provide a `getSongMatches` server function that returns one song with its playlist match results at a given offset, ordered by newness then best score.

#### Scenario: Load song at offset
- **WHEN** calling `getSongMatches(contextId, offset)` with a valid offset
- **THEN** return the Nth undecided song (0-indexed) with its match results
- **AND** each match result SHALL include playlist metadata (name, description, track count), score, rank, and factors
- **AND** song data SHALL include name, artists, album art, genres, audio features, and analysis (if exists)

#### Scenario: Song ordering
- **WHEN** determining the order of undecided songs
- **THEN** order by `is_new DESC` (new songs first), then by best single playlist match score DESC

#### Scenario: Skip fully decided songs
- **WHEN** a song has `match_decision` rows covering all its `match_result` playlists
- **THEN** that song SHALL be excluded from the offset calculation
- **AND** offset N SHALL always return the Nth undecided song regardless of prior decisions in the session

#### Scenario: Offset beyond available songs
- **WHEN** calling `getSongMatches` with an offset >= total undecided songs
- **THEN** return `null`

### Requirement: Prefetch Next Songs

The client SHALL prefetch upcoming songs in the background for instant transitions when the user advances.

#### Scenario: Prefetch on current song load
- **WHEN** a song at offset N loads successfully
- **THEN** prefetch songs at offset N+1 and N+2 using `queryClient.prefetchQuery`

#### Scenario: Query key structure
- **WHEN** caching song match data
- **THEN** use query key `["matching", "song", contextId, offset]`
- **AND** use query key `["matching", "session", accountId]` for session initialization

#### Scenario: User advances after prefetch
- **WHEN** the user advances (add, dismiss, or next) and offset N+1 is already cached
- **THEN** the next song SHALL render without a loading state

### Requirement: Session Lifecycle

The system SHALL track which songs were presented during a matching session and batch-clear their `is_new` status when the session ends.

#### Scenario: Track presented songs
- **WHEN** a song is displayed to the user during the matching session
- **THEN** add its ID to the session's presented songs set

#### Scenario: Clear on unmount
- **WHEN** the matching page unmounts (navigation, route change)
- **THEN** call `markSeen(accountId, "song", [...presentedSongIds])` with all accumulated song IDs
- **AND** the call SHALL be fire-and-forget (failure does not block navigation)

#### Scenario: Clear on tab close
- **WHEN** the browser tab is closed while the matching page is active
- **THEN** fire `markSeen` via `beforeunload` event handler

#### Scenario: Failure to clear
- **WHEN** `markSeen` fails or does not fire (e.g., power loss)
- **THEN** songs retain `is_new = true` — this is harmless because the read path derives status from `match_result`/`match_decision` composition
