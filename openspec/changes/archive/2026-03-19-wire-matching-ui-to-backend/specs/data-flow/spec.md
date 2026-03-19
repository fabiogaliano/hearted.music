## MODIFIED Requirements

### Requirement: Server Functions for Mutations

The system SHALL use TanStack Start server functions for data mutations. Matching actions SHALL write to `match_decision`, not `item_status`. All matching-related server functions SHALL reside in `src/lib/server/matching.functions.ts`.

#### Scenario: Server function definition
- **WHEN** creating a server mutation
- **THEN** use `createServerFn()` with Zod validation

#### Scenario: Type safety
- **WHEN** calling server functions
- **THEN** input and output types are inferred

#### Scenario: Error handling
- **WHEN** server function fails
- **THEN** error is typed and catchable

#### Scenario: addSongToPlaylist writes match_decision
- **WHEN** user adds song to a specific playlist
- **THEN** `addSongToPlaylist` server function SHALL insert `match_decision(song_id, playlist_id, 'added')`
- **AND** SHALL NOT write to `item_status.action_type`
- **AND** SHALL reside in `src/lib/server/matching.functions.ts`

#### Scenario: dismissSong batch-declines
- **WHEN** user dismisses a song with suggestions for playlists A, B, C
- **THEN** `dismissSong` server function SHALL batch insert `match_decision(decision='dismissed')` for each shown playlist
- **AND** accept an array of playlist IDs as input
- **AND** SHALL reside in `src/lib/server/matching.functions.ts`

#### Scenario: next has no server function
- **WHEN** user clicks Next Song
- **THEN** no server function is called
- **AND** navigation state is managed in client-side UI state only

#### Scenario: getMatchingSession server function
- **WHEN** the matching page initializes
- **THEN** call `getMatchingSession` server function in `src/lib/server/matching.functions.ts`
- **AND** it SHALL return `{ contextId, totalSongs }` or `null`
- **AND** use `createServerFn()` with Zod validation and `requireAuthSession()`

#### Scenario: getSongMatches server function
- **WHEN** the matching page needs data for a specific song
- **THEN** call `getSongMatches` server function in `src/lib/server/matching.functions.ts`
- **AND** it SHALL accept `{ contextId, offset }` as input
- **AND** return `{ song, matches }` or `null`
- **AND** use `createServerFn()` with Zod validation and `requireAuthSession()`

#### Scenario: File organization
- **WHEN** organizing matching server functions
- **THEN** `addSongToPlaylist`, `dismissSong`, `getMatchingSession`, and `getSongMatches` SHALL all reside in `src/lib/server/matching.functions.ts`
- **AND** these functions SHALL be moved from `src/lib/server/liked-songs.functions.ts`

### Requirement: Route-Level Data Loading

The system SHALL load data at the route level, not in components.

#### Scenario: Loader pattern
- **WHEN** navigating to a route
- **THEN** loader fetches required data before render

#### Scenario: Suspense boundary
- **WHEN** data is loading
- **THEN** route-level Suspense shows loading state

#### Scenario: Error boundary
- **WHEN** loader fails
- **THEN** route-level ErrorBoundary handles error

#### Scenario: Matching route loader
- **WHEN** navigating to `/match`
- **THEN** the route loader SHALL call `getMatchingSession` to preload context and total count
- **AND** follow the same pattern as the liked-songs route loader (`ensureQueryData`)
