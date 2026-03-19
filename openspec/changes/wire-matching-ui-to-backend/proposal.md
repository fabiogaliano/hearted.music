## Why

The matching page (`/match`) is a fully functional UI prototype with zero backend connection. Action buttons (add, dismiss, next) only update local React state, data comes from static JSON landing assets, and nothing persists to the database. Meanwhile, the entire backend infrastructure exists — `match_result`, `match_decision`, server functions, query functions — all built and tested in the matching architecture redesign. The UI and backend need to be wired together.

## What Changes

- Replace hardcoded mock data with real `match_result` data from the latest `match_context`
- Add `getMatchingSession` server function to initialize the matching page (context + total song count)
- Add `getSongMatches` server function to fetch one song + its playlist matches on demand (with prefetch-next pattern)
- Wire action buttons to existing server functions: add → `addSongToPlaylist`, dismiss → `dismissSong`
- Add session-based `markSeen` — batch clear `is_new` for all presented songs when session ends (unmount/navigation), decoupled from individual actions
- Add empty state when no match results exist
- Separate landing page demo from authenticated matching page — `Matching.tsx` currently loads landing mock data, the `/match` route needs real data while the landing page keeps the demo
- Add `new_suggestions` count to `get_liked_songs_stats` RPC for dashboard badge (songs with undecided suggestions AND `is_new = true`)
- Add route loader + TanStack Query hooks following the liked-songs page pattern
- Completion screen derives stats from persisted `match_decision` rows instead of local state

## Capabilities

### New Capabilities

- `matching-session`: Server-side data loading for the matching page. Covers `getMatchingSession` (init context + count), `getSongMatches` (per-song match results with prefetch), and session lifecycle (`markSeen` batch on end).

### Modified Capabilities

- `matching-ui`: Wire action buttons to server functions, replace mock data with real queries, add empty state, separate landing demo from authenticated page.
- `newness`: Add `new_suggestions` count to stats RPC (songs with undecided suggestions filtered by `is_new = true`). Add session-based `markSeen` batch clearing pattern.
- `data-flow`: Add `getMatchingSession` and `getSongMatches` server functions following existing patterns (`createServerFn`, Zod validation, `requireAuthSession`).

## Impact

- **Routes**: `src/routes/_authenticated/match.tsx` — add loader, search params
- **Features**: `src/features/matching/` — new query hooks, refactor data flow, separate landing vs authenticated
- **Server functions**: `src/lib/server/liked-songs.functions.ts` or new `matching.functions.ts` — add `getMatchingSession`, `getSongMatches`
- **SQL**: `get_liked_songs_stats` — add `new_suggestions` count
- **No schema changes** — all tables exist from the matching architecture redesign
