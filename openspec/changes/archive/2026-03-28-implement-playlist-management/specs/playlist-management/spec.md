## ADDED Requirements

### Requirement: `/playlists` preserves the warm-pastel two-pane information architecture
The system SHALL render `/playlists` inside the authenticated shell as a warm-pastel playlist-management surface with a sticky target rail and a browseable library column, preserving the prototype’s layout, headings, and UX priorities as closely as practical.

#### Scenario: Synced playlists render in split view
- **WHEN** an authenticated user with synced playlists opens `/playlists`
- **THEN** the route shows a left “Matching Playlists” column for current target playlists
- **AND** it shows a right “Available Library” column for the remaining synced playlists
- **AND** it remains inside the existing authenticated sidebar/layout defined by `src/routes/_authenticated/route.tsx` and `src/routes/_authenticated/-components/Sidebar.tsx`

#### Scenario: No target playlists shows prototype empty-state guidance
- **WHEN** the account has synced playlists but zero current target playlists
- **THEN** the left column shows an empty state equivalent to the prototype’s “No active playlists yet” guidance
- **AND** the route continues to let the user browse the library and add matching playlists from the right column

#### Scenario: No synced playlists shows honest source-of-truth guidance
- **WHEN** the account has zero synced playlists in app data
- **THEN** `/playlists` shows sync or reconnect guidance instead of a blank management layout
- **AND** the route does not imply that playlist browsing is available before extension sync has populated playlist rows

### Requirement: Playlist detail inspection mirrors the prototype while adapting to real synced data
The system SHALL let users inspect a library playlist in a detail surface that keeps the prototype’s large-cover, editorial-detail presentation while adapting track and metadata display to the current synced data model.

#### Scenario: Selecting a playlist opens the detail surface
- **WHEN** the user selects a playlist from the available-library column
- **THEN** the route opens a detail surface with the playlist cover, title, description area, track count, matching toggle, and track preview
- **AND** the detail surface remains visually anchored to the right-column browsing context rather than replacing the entire page

#### Scenario: Synced playlist tracks populate the preview
- **WHEN** synced playlist-track data is available for the selected playlist
- **THEN** the detail surface shows an ordered preview based on that synced track data
- **AND** the preview reflects the playlist’s current app-side track membership rather than mock content

#### Scenario: Track preview is unavailable or empty
- **WHEN** the selected playlist has no synced track rows yet or has zero tracks
- **THEN** the detail surface shows an honest unavailable or empty-playlist state
- **AND** it does not fabricate track content that the current app has not synced

### Requirement: Target playlist actions feel immediate inside the route
The system SHALL let users add or remove matching playlists with immediate visible feedback that keeps the prototype’s lightweight browsing flow.

#### Scenario: Adding a playlist updates the visible route state immediately
- **WHEN** the user adds an available playlist to matching from the library row or detail surface
- **THEN** the playlist appears in the matching-playlists rail during that route session without requiring a separate save screen
- **AND** the visible controls update to reflect that the playlist is now part of matching

#### Scenario: Removing a playlist updates the visible route state immediately
- **WHEN** the user removes a playlist from matching from the rail or detail surface
- **THEN** the playlist leaves the matching-playlists rail during that route session
- **AND** the visible controls update to reflect that it is again part of the available library

#### Scenario: Repeated toggles honor the latest user intent
- **WHEN** the same playlist is added and removed multiple times during one `/playlists` session
- **THEN** the route state reflects the latest user action
- **AND** the route does not require the user to leave and re-enter `/playlists` to see the final intended state

### Requirement: Target-affecting changes are coalesced for one exit-time refresh
The system SHALL stage target-affecting playlist-management changes during the active `/playlists` session and flush one downstream refresh request when the user leaves the route.

#### Scenario: Membership changes are staged instead of refreshing immediately
- **WHEN** the user performs one or more target-membership changes during a mounted `/playlists` session
- **THEN** the route records that downstream published matches are now stale
- **AND** it SHALL NOT start downstream matching refresh after each individual action while the route remains mounted

#### Scenario: Target-affecting metadata edits join the same staged refresh
- **WHEN** the user edits playlist metadata that affects a playlist that is in the target set at flush time
- **THEN** that edit contributes to the same staged downstream refresh request for the session
- **AND** it does not create a separate immediate refresh request of its own

#### Scenario: Navigation away flushes one refresh request
- **WHEN** the user navigates away from `/playlists` or the React route unmounts
- **THEN** the route flushes at most one downstream refresh request for the accumulated target-affecting changes from that session
- **AND** that navigation-away or unmount path is the primary reliable refresh-trigger path

### Requirement: Spotify-owned metadata edits are extension-backed and honest
The system SHALL treat Spotify-owned playlist metadata editing as a browser-runtime extension write flow with explicit reconnect, pending-reconciliation, and failure states.

#### Scenario: Extension-backed edit succeeds
- **WHEN** the user saves a supported playlist metadata edit while the extension write path is available
- **THEN** the route updates the visible playlist state immediately for that session
- **AND** it records that backend reconciliation is still required until app data reflects the write
- **AND** it does not imply that downstream matching refresh has already run

#### Scenario: Extension path is unavailable
- **WHEN** the user attempts a Spotify-owned metadata edit and the extension is unavailable, disconnected, or otherwise unable to accept commands
- **THEN** the route blocks the save
- **AND** it shows install, reconnect, or retry guidance instead of pretending the edit was persisted

#### Scenario: Extension-backed edit fails
- **WHEN** the extension write path returns a failed command result for a metadata edit
- **THEN** the route preserves the user’s draft or retry context
- **AND** it shows a deterministic failed state
- **AND** it does not mark the playlist as successfully updated in Spotify or in the synced app data
