# Task 04 — Playlist studio gate on shared state

## Goal

`useSpotifyGate` keeps its public contract (`gateState`, `recheck`,
`reportGateFailure`) but becomes a thin selector over the shared connection —
deleting its private PING/SPOTIFY_STATUS checks and hand-rolled
focus/visibility listeners.

## Files changed

### `src/features/playlists/create/useSpotifyGate.ts`

- Read `useExtensionConnection(null)` — the gate doesn't do identity checks,
  so pass `linkedSpotifyId: null`; it only needs installed/spotifyConnected.
- Map verdict → `SpotifyGateState`:
  - `checking` → `checking` (but see anti-flicker below)
  - `extension-missing` → `extension-unavailable`
  - `spotify-disconnected` → `reconnect-required`
  - everything else → `ok`
- **Anti-flicker (invariant 4):** once `ok` has been reached, a background
  refetch putting the query into a transient fetching state must not downgrade
  to `checking`. TanStack Query already gives this: `data` stays populated
  during refetches, so the verdict only changes on a *different result*, never
  on "fetching". Add a test pinning it.
- Focus/visibility rechecks: delete the manual `focus`/`visibilitychange`
  listeners and debounce — `refetchOnWindowFocus` on the shared query covers
  it. The "stop checking once ok" optimization inverts (the shared query keeps
  its lazy interval while subscribed); acceptable — one lightweight wire call
  every ~6s while the studio is open, and it's the same query every other
  surface shares.
- `recheck()` → `refetch()` on the shared query.
- `reportGateFailure(failure)`:
  - `reconnect-required` → `reportSpotifyAuthFailure(queryClient)` (push —
    now the *whole app* learns, not just this screen). This is the surface that
    most needs invariant 7: the gate was `ok` at submit and auth died
    mid-flight, so `hasToken` is precisely the thing that lied. Without the
    sticky `authFailedAt`, the next poll re-reports `hasToken: true` and the
    gate snaps back to `ok` with the publish still broken.
  - `extension-unavailable` → `reportExtensionUnreachable(queryClient)`, **not**
    a bare invalidate. `reportGateFailure` exists to force a state observed
    first-hand, synchronously; an invalidate is async, so the gate would keep
    rendering `ok` off stale data until the refetch lands — losing the whole
    point of the method (see its docstring at `useSpotifyGate.ts:41-45`).
  - The monotonic request-id guard becomes unnecessary (Query serializes
    fetches); delete it.

### Consumers (`StudioScreen.tsx`, `CreateBar.tsx`, `ReconnectPrompt.tsx`)

- No contract change expected. If `ReconnectPrompt`'s reconnect link is
  anchor-based `SpotifyReconnectLink`, leave it in this task; unifying the
  affordance component happens in 05.

### `src/lib/extension/create-playlist-from-draft.ts`

- Steps 1–2 (its own `isExtensionInstalled` + `getSpotifyConnectionStatus`
  preflight, lines 117-127) stay — it's a point-in-time preflight inside an
  async command flow, not a UI subscription. But its failure paths flow
  through `usePublishPlaylist.reportGateFailure`, which now pushes to shared
  state — so a mid-flight auth failure updates every surface. No direct edit
  here beyond confirming the wiring.

## Tests

- Rework the existing `src/features/playlists/create/__tests__/useSpotifyGate.test.ts`
  (203 lines — treat it as the behavior spec, not a greenfield) against a
  mocked connection query: verdict mapping, `ok` never downgrades on refetch,
  `reportGateFailure('reconnect-required')` flips the shared state (assert
  another consumer of the same QueryClient sees it) and **survives a following
  poll that still reports `hasToken: true`**.
- Its focus/visibility-recheck cases lose their subject when the manual
  listeners go; re-express them as `refetchOnWindowFocus` behavior rather than
  deleting the coverage.

## Done when

- Studio gate behavior indistinguishable to the user; zero direct
  `getSpotifyConnectionStatus`/`isExtensionInstalled` calls left in
  `useSpotifyGate`; `bun run test` green.
