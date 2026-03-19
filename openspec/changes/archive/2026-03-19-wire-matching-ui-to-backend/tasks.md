## 1. Server Functions

- [x] 1.1 Create `src/lib/server/matching.functions.ts` with `getMatchingSession` server function — gets latest `match_context`, counts undecided songs, returns `{ contextId, totalSongs }` or `null`.
- [x] 1.2 Add `getSongMatches` server function to `matching.functions.ts` — accepts `{ contextId, offset }`, returns Nth undecided song (ordered `is_new DESC`, best score DESC) with song details, analysis, match results, and playlist metadata. Returns `null` when offset exceeds available songs.
- [x] 1.3 Move `addSongToPlaylist` and `dismissSong` from `src/lib/server/liked-songs.functions.ts` to `src/lib/server/matching.functions.ts`. Update all imports.

## 2. Stats RPC Migration

- [x] 2.1 Create migration to update `get_liked_songs_stats` — add `new_suggestions` column counting songs with undecided `match_result` rows AND `item_status.is_new = true`. Requires `DROP FUNCTION` + `CREATE OR REPLACE` (return type change).
  - `supabase/migrations/`
- [x] 2.2 Regenerate Supabase types with `supabase gen types typescript --local > src/lib/data/database.types.ts`.
- [x] 2.3 Update `LikedSongsStatsRow` type in `src/lib/domains/library/liked-songs/queries.ts` if needed.

## 3. Query Hooks

- [x] 3.1 Create `src/features/matching/queries.ts` — define `matchingKeys` (session, song), `matchingSessionQueryOptions(accountId)`, and `songMatchesQueryOptions(contextId, offset)` following the liked-songs pattern.
- [x] 3.2 Add prefetch logic — when current song loads, prefetch offset+1 and offset+2 via `queryClient.prefetchQuery`.

## 4. Component Refactor

- [x] 4.1 Update `src/features/matching/types.ts` — change all ID types from `number` to `string`. Update `Playlist`, `MatchingState`, `addedTo` record types. Remove dependency on `LandingSongDetail` for the real data path.
- [x] 4.2 Refactor `src/features/matching/Matching.tsx` to accept song and playlist data via props instead of loading mock data internally. Landing page passes mock data, `/match` route passes real data. Remove hardcoded `PLAYLISTS` and `loadLandingSongsManifest` from the authenticated path.
- [x] 4.3 Update landing page usage of `Matching.tsx` to pass mock data as props (preserve existing behavior).

## 5. Route Wiring

- [x] 5.1 Add route loader to `src/routes/_authenticated/match.tsx` — call `getMatchingSession` via `ensureQueryData` following the liked-songs route pattern.
- [x] 5.2 Create authenticated matching page component that uses `matchingSessionQueryOptions` and `songMatchesQueryOptions` to load real data and passes it to the refactored `Matching.tsx`.
- [x] 5.3 Wire action handlers — `onAdd` calls `addSongToPlaylist`, `onDismiss` calls `dismissSong`, `onNext` advances offset only (no server call).

## 6. Session Lifecycle

- [x] 6.1 Create `useMatchingSession` hook — tracks presented song IDs in a `Set`, calls `markSeen(accountId, "song", [...ids])` on unmount via `useEffect` cleanup.
- [x] 6.2 Add `beforeunload` handler to fire `markSeen` on tab close.
- [x] 6.3 Integrate `useMatchingSession` into the authenticated matching page — add each displayed song ID to the presented set.

## 7. Empty State

- [x] 7.1 Add empty state component — shown when `getMatchingSession` returns `null` or `totalSongs === 0`. Simple message explaining no suggestions are available.

## 8. Completion Screen

- [x] 8.1 Update completion screen to derive stats from `match_decision` rows written during the session instead of local state.
  - `src/features/matching/sections/CompletionScreen.tsx`

## 9. Verification

- [x] 9.1 Run full test suite — `bun run test` — ensure no regressions from import changes (task 1.3).
- [x] 9.2 Verify landing page still renders matching demo with mock data.
- [x] 9.3 Verify `/match` route loads real data when match results exist, shows empty state when they don't.
