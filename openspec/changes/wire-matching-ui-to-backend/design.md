## Context

The matching page (`/match`) renders a card-based flow: one song at a time, with playlist suggestions ranked by match score. Users add, dismiss, or skip songs. The UI exists as a working prototype in `src/features/matching/` but all data is hardcoded (landing page mock songs + static playlists) and all actions are local React state.

The backend is fully built from the matching architecture redesign:
- `match_context` + `match_result` tables store scoring results
- `match_decision` table stores permanent user decisions (added/dismissed)
- Server functions `addSongToPlaylist` and `dismissSong` exist in `src/lib/server/liked-songs.functions.ts` (to be moved to `matching.functions.ts`)
- Query functions for match results exist in `src/lib/domains/taste/song-matching/queries.ts`
- `markSeen` exists in `src/lib/domains/library/liked-songs/status-queries.ts`

The `Matching.tsx` component is also used on the landing page with mock data. The landing page must continue to work with mock data while `/match` uses real data.

Current files:
- `src/routes/_authenticated/match.tsx` — route, no loader
- `src/features/matching/Matching.tsx` — loads mock data, hardcoded playlists
- `src/features/matching/hooks/useMatchingState.ts` — local state only
- `src/features/matching/types.ts` — types use `number` IDs, `LandingSongDetail` type
- `src/features/matching/components/` — display components (SongSection, MatchesSection, DetailsPanel)
- `src/features/matching/sections/` — layout components (MatchingHeader, MatchingSession, CompletionScreen)

## Goals / Non-Goals

**Goals:**
- Wire matching page to real `match_result` data from the latest `match_context`
- Persist user actions (add/dismiss) via existing server functions
- Load one song at a time with prefetch-next for instant transitions
- Clear `is_new` for all presented songs when matching session ends
- Add empty state when no match results exist
- Keep landing page demo working with mock data
- Add `new_suggestions` count to stats RPC for dashboard badge

**Non-Goals:**
- Changing the matching algorithm or scoring
- Adding real-time updates (WebSocket/SSE) to the matching page
- Implementing undo for match decisions
- Adding the actual Spotify playlist write (adding track via API)
- Redesigning the matching UI layout or visual design

## Decisions

### 1. Refactor `Matching.tsx` to be data-agnostic

**Decision**: Refactor `Matching.tsx` to accept song and playlist data via props instead of loading mock data internally. The landing page passes mock data; the `/match` route passes real data from server functions. One component, two data sources. Display sub-components (`MatchingSession`, `SongSection`, `MatchesSection`) stay shared.

**Alternatives considered**:
- *Duplicate the component*: Creates divergence between landing and authenticated versions. Bug fixes need to happen in two places.
- *Create a `MatchingPage.tsx` wrapper*: Less risk (no changes to landing page), but two orchestrator components doing similar things.

### 2. Two server functions: `getMatchingSession` + `getSongMatches`

**Decision**: Split data loading into init (context + count) and per-song (matches + metadata).

`getMatchingSession(accountId)`:
- Gets latest `match_context` for the account
- Counts songs with undecided `match_result` rows (total for progress bar)
- Returns `{ contextId, totalSongs }` or `null` if no context/results

`getSongMatches(contextId, offset)`:
- Gets the Nth undecided song from `match_result` (ordered by `is_new DESC`, then best score DESC)
- Loads song details (name, artists, album art, genres, audio features)
- Loads song analysis (if exists)
- Loads match results for that song (playlist ID, score, rank, factors)
- Loads playlist metadata for each matched playlist (name, description, track count)
- Returns `{ song, matches: [{ playlist, score, factors }] }` or `null` if no more songs

**Alternatives considered**:
- *Single function returning all songs + matches*: Could be hundreds of songs × multiple playlists each. Too much data upfront.
- *Client-side composition of existing queries*: Multiple round trips per song (getMatchResults, then getSong, then getPlaylists). Chatty and slow.

**Ordering**: Songs are ordered by `is_new DESC` (new songs first), then by best match score DESC. The offset skips songs that already have `match_decision` rows for all their `match_result` playlists.

### 3. Prefetch-next pattern for instant transitions

**Decision**: When the current song loads, prefetch the next song's data in the background using `queryClient.prefetchQuery`. When the user advances (add/dismiss/next), the next song renders instantly.

**Query key structure**:
```
["matching", "session", accountId]           → getMatchingSession
["matching", "song", contextId, offset]      → getSongMatches
```

After an action (add/dismiss), the offset advances and the next query key is already cached from prefetch. The previous song's cache entry can be garbage collected.

### 4. Session-based `markSeen` on unmount

**Decision**: Track all song IDs presented during the session in a `Set`. On component unmount (navigation, close), batch `markSeen(accountId, "song", [...presentedSongIds])`. This is decoupled from individual actions.

**Alternatives considered**:
- *Clear `is_new` per action (inside server functions)*: Conflates "user decided" with "user saw." A user can see a song and skip it — still counts as "seen."
- *Clear on viewport intersection*: Over-engineered for a card-based flow where the user explicitly sees each card.

**Implementation**: A `useEffect` cleanup function that fires `markSeen` with the accumulated set. Also fires via `beforeunload` for tab closes. The `markSeen` call is fire-and-forget — failure doesn't affect the session.

### 5. Types use string UUIDs, not numbers

**Decision**: The current `types.ts` uses `number` for IDs (e.g., `Playlist.id: number`, `addedTo: Record<number, number[]>`). Real data uses UUID strings. Update all ID types to `string`.

### 6. `new_suggestions` count via SQL modification

**Decision**: Add a `new_suggestions` column to the `get_liked_songs_stats` return type. This counts songs with undecided `match_result` rows that also have `item_status.is_new = true`. Implemented as one additional `COUNT(*) FILTER (WHERE ...)` in the existing function.

**Migration**: New migration to `DROP FUNCTION` + `CREATE OR REPLACE` (return type changes require drop).

### 7. Server functions in new `matching.functions.ts`

**Decision**: Create `src/lib/server/matching.functions.ts` for all matching-related server functions. Move `addSongToPlaylist` and `dismissSong` from `liked-songs.functions.ts` to the new file alongside `getMatchingSession` and `getSongMatches`.

**Rationale**: These functions write to `match_decision`, not `liked_song`. Grouping by domain (matching vs liked-songs) keeps each file focused.

### 8. Empty state when no suggestions exist

**Decision**: When `getMatchingSession` returns `null` (no context) or `totalSongs === 0` (no undecided matches), show an empty state in `MatchingPage.tsx`. The empty state explains why there are no suggestions and what to do (sync more songs, wait for pipeline).

The sidebar badge shows 0 or hides the count — the nav link stays visible so users can discover the feature.

## Risks / Trade-offs

**[Risk] Offset-based pagination with concurrent decisions** → If the user has the matching page open in two tabs, offset-based fetching could skip or duplicate songs. Mitigated by: single-user pre-production app, and the offset query skips already-decided songs server-side.

**[Risk] `markSeen` on unmount may not fire** → Browser can kill the tab before `beforeunload` completes. Mitigated by: stale `is_new = true` is harmless (read path composes with `match_result`, as established in the matching redesign review). Songs just show as "new" again next visit.

**[Risk] Prefetch cache invalidation after action** → After add/dismiss, the next song at offset N might change (because the decided song is now excluded from the query). Mitigated by: the offset query always excludes fully-decided songs server-side, so offset N always returns the Nth *undecided* song regardless of prior decisions.

**[Trade-off] Two server calls per song transition** → Action call (add/dismiss) + next song fetch. Accepted because: prefetch means the next song data is already cached, so only the action call is on the critical path.
