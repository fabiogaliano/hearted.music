# Task 05 — Liked songs & matching: push-on-failure, shared prompt

## Goal

Kill the per-entity reconnect flags. When an add-to-playlist fails auth on any
song or match card, the failure pushes into the shared connection state and
every surface reacts consistently; recovery is the shared query flipping back
— not a private 3s poll per component.

## Current shape being replaced

`useSpotifyReconnectState(entityKey)` (`src/lib/extension/useSpotifyReconnectState.ts`)
- local `reconnectNeeded` flag scoped to a song/playlist id
- while set, polls `getSpotifyConnectionStatus()` every 3s to auto-clear
- consumers: `useSongPlaylistSuggestions.ts:38` (liked songs),
  `QueueCardContent.tsx` via `useSpotifyReconnectState` (matching)

Two problems: the rest of the app never learns about the failure, and each
flagged row runs its own recovery poll.

## Files changed

### `src/features/liked-songs/hooks/useSongPlaylistSuggestions.ts`

- Drop `useSpotifyReconnectState`. In `onAdd`, when
  `outcomeFromCommandResponse(result)` is `reconnect-required`:
  `reportSpotifyAuthFailure(queryClient)` and return (song row stays
  actionable — unchanged semantics at `useSongPlaylistSuggestions.ts:54-66`).
- `reconnectNeeded` for the panel derives from the shared verdict
  (`spotify-disconnected`). The per-song scoping disappears **deliberately**:
  a dead token is global truth, so showing the prompt on whichever song panel
  is open is more honest than only on the one that happened to fail.
- Auto-clear: shared query refetch (interval/focus/repair-invalidate) replaces
  the private 3s poll.

### `src/features/matching/QueueCardContent.tsx` + `components/MatchesSection.tsx`

- Same substitution: failures push via `reportSpotifyAuthFailure`; the
  reconnect UI reads the shared verdict. `QueueCardContent` has **two**
  `outcomeFromCommandResponse` call sites (`:109` and `:152`), not one — both
  route to the push. The hook is consumed at `:321-322` and the flag reaches
  the view at `:688`.
- Wherever these flows get an `ok` back from a Spotify command, call
  `reportSpotifyAuthSuccess(queryClient)` — that is what bounds a sticky
  `authFailedAt` so it can't outlive the outage.

### Unified affordance

- Extend `SpotifyReconnectLink` (or wrap it) so the activation handler *also*
  fires the silent-pair half — i.e. route it through `repairConnection` while
  keeping the anchor semantics (`shouldArmOnEvent` middle-click handling
  stays). One component, used by the banner (task 03 may adopt it), the studio
  `ReconnectPrompt`, and these inline prompts. Labels stay per-surface props.

### Delete (here or in 06 once nothing imports it)

- `src/lib/extension/useSpotifyReconnectState.ts`

## Behaviors to preserve

- A failed add never marks the song "added" (existing bail-before-DB-write
  order in `onAdd` — Spotify write first, `addSongToPlaylist` server function
  only on success).
- `error` outcomes (non-auth) keep their current handling; only
  `reconnect-required` routes to the push.
- DB writes in these flows ride the app session — **no pairing logic is added
  here** (see README: a pairing failure cannot occur in these flows).

## Tests

- Update `useSongPlaylistSuggestions` tests: auth-failure calls
  `reportSpotifyAuthFailure`; panel `reconnectNeeded` mirrors shared verdict;
  successful add unchanged.
- Matching: same pattern for `QueueCardContent`'s reconnect state.
- Delete `useSpotifyReconnectState` tests with the hook (coverage parity via
  the shared-state tests from 01).

## Done when

- No `useSpotifyReconnectState` imports remain; an auth failure in liked songs
  makes the dashboard banner appear on next visit without any new poll; `bun
  run test` green.
