# Extension Connection Service

Make the extension connection a first-class app service: one shared state, one
repair gesture, one UI vocabulary — replacing the six parallel detection
implementations that each see only a slice of the truth.

## Problem

The extension is the app's data plane (sync, playlist create, add-to-playlist,
match decisions), but no single owner answers "can this app talk to Spotify
right now, as the right person?". Today five places re-derive it privately:

| Implementation | Sees | Blind to |
|---|---|---|
| `useDashboardSync` detection poll (4s) | installed, spotifyConnected | paired, profile |
| `useExtensionAccountConflict` poll (6s) | installed, paired, profile, mismatch | (only consumer of the full picture) |
| `useSpotifyGate` (playlist studio) | installed, spotifyConnected | paired, profile |
| `useSpotifyReconnectState` (liked songs, matching) | spotifyConnected, per-entity flag | everything else; state is local to one song/playlist row |
| Onboarding `InstallExtensionStep` | installed, spotifyConnected | paired (pairing happens later in its own flow) |
| Settings `ExtensionStatusRow` | installed (once, on mount — never re-checks) | everything else; goes stale for the life of the page |

Consequences observed in production use:

- Dashboard shows **two sequential reconnects** after a fresh extension install
  (banner "Reconnect" for pairing, then sync control "Reconnect Spotify").
- A failed add-to-playlist marks **one song row** reconnect-needed while every
  other surface still believes the connection is healthy.
- Three overlapping pollers run on the dashboard alone, two of them issuing the
  same `SPOTIFY_STATUS` wire command at different cadences.

## Architecture

Three pieces, all under `src/lib/extension/connection/` (no barrel exports —
consumers import each module directly):

1. **One connection state, poll + push** (`01-connection-state.md`)
   A shared TanStack Query (`['extension','connection']`) whose fetcher runs
   `isExtensionInstalled()` → `getSpotifyAccountStatus()` and returns the full
   picture: `{ installed, spotifyConnected, paired, profile }`. Polled lazily
   (interval only while subscribed + `refetchOnWindowFocus`). **Pushed**: any
   Spotify command failing `AUTH_REQUIRED`/`TOKEN_EXPIRED` anywhere writes into
   this state so the whole app learns instantly.

2. **One repair gesture** (`02-repair-action.md`)
   `repairConnection()`: synchronously (inside the click gesture) opens the
   armed Spotify login **only if** the token is missing; in parallel — never
   awaited before the `window.open` — silently `pairExtension()`; then
   invalidates the connection query.

3. **One UI vocabulary** (applied per surface in tasks 03–05)
   Every reconnect affordance renders from the same verdict and calls the same
   repair. The dashboard banner is the dashboard's only reconnect home; the
   studio gate and the inline liked-songs/matching prompts are the same logic
   in different placements. Sync/status lines show status only, never a
   reconnect button.

### Auth systems (for orientation — only two are in scope)

| Credential | Used for | Repair |
|---|---|---|
| Spotify session token | all Spotify reads/writes via extension | user gesture: open Spotify login (armed URL) |
| hearted pairing `apiToken` | extension → backend sync upload **only** | silent `pairExtension()` |
| App session cookie | server functions (DB writes) | app auth; out of scope |

Server-function DB writes (`acknowledgePlaylistCreate`, `addSongToPlaylist`,
…) ride the app session, **not** the pairing — a pairing failure cannot occur
in the playlist/matching flows, so no re-pair logic is added there.

## Invariants (every task must preserve these)

1. **`window.open` fires synchronously inside the click gesture.** Awaiting
   anything before it spends the user gesture and the popup is blocked. This is
   why repair branches on *already-known* state instead of re-checking first.
2. **Mismatch outranks unpaired.** Pairing is silently repairable; a wrong
   Spotify session is not. When both are true, surface the mismatch.
3. **An explicit popup-side disconnect is never silently undone.** `paired ===
   false` is the one pairing state that reaches the user (banner button);
   `paired === null` (old extension / field missing) is "unverifiable", not
   "unpaired".
4. **Studio gate anti-flicker.** A settled `ok` never downgrades to `checking`
   on a background re-check.
5. **Sync progress cadence untouched.** `useExtensionSyncStatus` (GET_STATUS,
   1.5s while syncing) is a separate concern — sync *progress*, not connection
   — and is not migrated.
6. **Old-extension tolerance.** `paired: null` / `profile: null` must degrade
   to a paused-with-explanation state, never to a hard conflict or a wrong
   reconnect CTA. A PING that answers but a `SPOTIFY_STATUS` that doesn't is
   **installed**, not missing — it must never produce an "Install extension" CTA.
7. **A live command failure outranks `hasToken`.** The extension's `hasToken`
   is a *local* check — `token !== null && isTokenValid() && !isAnonymous`
   (`dispatcher.ts:160`). A token Spotify itself rejects (revoked, scope
   changed, server-side session kill) is still locally unexpired, so
   `SPOTIFY_STATUS` keeps reporting `hasToken: true`. A pushed auth failure is
   therefore **better evidence than the poll** and must be sticky — never
   overwritten by the next status read (see `authFailedAt`, task 01).

## Task sequence

Each task ships independently with green `bun run test`.

| # | File | Delivers |
|---|---|---|
| 1 | `01-connection-state.md` | Shared connection query + verdict derivation + push-on-failure |
| 2 | `02-repair-action.md` | `repairConnection()` single repair gesture |
| 3 | `03-dashboard.md` | Banner covers all three reconnect cases in one button; sync control shows status only (fixes the two-reconnects bug) |
| 4 | `04-studio-gate.md` | `useSpotifyGate` becomes a thin selector over shared state |
| 5 | `05-liked-songs-matching.md` | Replace per-entity reconnect flags with shared state + push |
| 6 | `06-cleanup.md` | Delete superseded detection paths; onboarding reads shared state |

## Risks

- **Push-on-failure is silently undone by its own confirming refetch.** The
  original mitigation here ("the next poll flips it back, and the push triggers
  an immediate refetch to confirm") is backwards — see invariant 7. Because
  `hasToken` can't see a Spotify-side rejection, an authoritative refetch
  returns `spotifyConnected: true` and erases the failure within ~200 ms, i.e.
  the reconnect prompt never survives long enough to click. Resolved by making
  the push sticky (`authFailedAt`) rather than by refetching harder.
- **The inverse: a stale sticky failure that never clears.** Bounded by
  clearing `authFailedAt` on explicit repair and on the next Spotify command
  that succeeds. Fully automatic clearing would need the extension to expose
  token identity on `SPOTIFY_STATUS` (it only does so on `GET_STATUS`, as
  `tokenExpiresAtMs`) — out of scope here, noted for a later extension bump.
- **Query-based polling changes timing semantics** vs. hand-rolled intervals
  (subscriber-driven start/stop). Task 01's tests pin the cadence contract.
- **Always-on polling replaces today's "stop once healthy" optimization.**
  `useSpotifyGate` deliberately stops PINGing once `ok`; a flat
  `refetchInterval` reinstates a forever-poll on every authenticated page. Task
  01 keeps the interval only while the connection is unhealthy and leans on
  `refetchOnWindowFocus` + the push for the healthy path.

## Revision log

**2026-07-27 — reviewed against the codebase before implementation.** Every
line reference in the original draft checked out, and the motivating
two-reconnects bug was confirmed by tracing `deriveState`: an unpaired fresh
install hits `accountCheck.kind === "conflict"` first (`useDashboardSync.ts:371`)
so the control shows "sync paused" under the banner's Reconnect; once pairing
succeeds the check degrades to `unavailable`, `spotifyConnected` is still
false, and the control falls through to `spotify-reconnect-required` — a second
button. Changes made:

- Added invariant 7 and `authFailedAt`. The push-on-failure design was
  self-defeating: its own confirming refetch erased the failure.
- Task 01's fetcher no longer reports an installed-but-unanswering extension as
  not-installed (would have shown "Install extension" to existing users).
- `repairConnection` returns the pairing promise; task 03 needs it for
  `repairing`.
- `refetchInterval` made conditional so the healthy path stops polling.
- Task 03: `useExtensionSyncStatus`'s `enabled` gate and `failSync`'s phase
  reset — both orphaned by deletions the draft called for.
- Pre-link (`linkedSpotifyId === null`) banner suppression, and the resulting
  narrowing of "the banner is the only reconnect home" to linked accounts.
- Task 04: `extension-unavailable` needs a synchronous push, not an invalidate.
- Settings' `ExtensionStatusRow` added as the sixth detection path.

Open decision left for task 03: whether "Switch Spotify account" should point
at a logout URL. It cannot fix a mismatch as written — but that hole is
pre-existing, not introduced here.
- **Dashboard migration touches the most-tested surface** (`useDashboardSync`
  has extensive tests). Treat existing tests as the behavior spec; update
  expectations only where this plan explicitly changes behavior.
