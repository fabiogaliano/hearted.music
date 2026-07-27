# Task 03 — Dashboard migration (fixes the two-reconnects bug)

## Goal

The banner becomes the dashboard's **only** reconnect surface, covering all
three cases (Spotify expired, unpaired, wrong account) with one button backed
by `repairConnection()`. The Recent Activity line ("Never · …") shows status
only — the "Reconnect Spotify" button and the `account-*` CTA states disappear
from `DashboardSyncControl`. `useDashboardSync` stops running its own
detection poll and reads the shared connection.

## Files changed

### `src/features/dashboard/Dashboard.tsx`

- Replace `useExtensionAccountConflict(linkedSpotifyId)` with
  `useExtensionConnection(linkedSpotifyId)`.
- Pass the full `verdict` to the banner (not just conflicts) and to
  `DashboardSyncStatus`.

### `src/features/dashboard/components/ExtensionAccountBanner.tsx`

Becomes the home for every actionable verdict:

| Verdict | Copy (keep existing tone) | Action |
|---|---|---|
| `mismatch` | existing "signed in as X, library belongs to Y" | "Switch Spotify account" → `repairConnection` |
| `unpaired` | existing "extension no longer connected" | "Reconnect" → `repairConnection` (silent pair; opens Spotify too if token also gone — the fresh-install case resolves in **one click**) |
| `spotify-disconnected` | new: session expired, syncing paused | "Reconnect Spotify" → `repairConnection` |
| `unverifiable` | new: can't verify the account (extension may need an update) | no button (invariant 6) |
| `ok` / `checking` / `extension-missing` | render nothing | — |

**Pre-link accounts (`linkedSpotifyId === null`) must still render nothing.**
`useExtensionAccountConflict` short-circuits to `not-required` before it checks
anything (`:50-53`), so today the banner is invisible to a user who hasn't
linked Spotify — deliberately: "before first sync, onboarding owns the connect
UX and a banner is noise" (`:35-37`). The new verdict deliberately evaluates
`extension-missing`/`spotify-disconnected` *before* the `linkedSpotifyId ===
null` rule (task 01, so the studio gate can share it), which means a pre-link
dashboard would now surface a full bordered "Reconnect Spotify" banner. The
dashboard route passes `account?.spotify_id ?? null`, so this state is
reachable. Gate the banner on `linkedSpotifyId !== null` to preserve today's
behavior.

That gate has a consequence for the "banner is the only reconnect home" rule:
it holds **for linked accounts only**. A pre-link user with no banner and a
status-only control would have no reconnect affordance at all. So keep
`spotify-reconnect-required` in `DashboardSyncUiState` and let the control
render it when `linkedSpotifyId === null`; for linked accounts the control
collapses to `paused` and the banner owns the action. One CTA on screen either
way — which is the actual goal, not "the banner literally always".

- `onReconnect` calls `repairConnection({ verdict, queryClient,
  spotifyLoginUrl })` **synchronously** in the click handler (invariant 1) and
  drives the existing `repairing` disabled state off the promise it returns
  (task 02), then relies on the invalidation inside repair (drop the manual
  `recheck`). Note today's handler is `async` and `await`s `pairExtension()`
  *before* anything else — fine now because the unpaired path opens no window,
  but it is exactly the shape invariant 1 forbids once the same button also
  has to open Spotify. That merge is the point of this task.
- Keep the view/container split so Ladle stories keep driving every state;
  update `ExtensionAccountBanner.stories.tsx` for the new verdicts.

### `src/features/dashboard/hooks/useDashboardSync.ts`

- **Delete** the private detection poll (`isExtensionInstalled` +
  `getSpotifyConnectionStatus` effect, lines 113-132) — read
  `useExtensionConnection` instead. `DETECT_POLL_MS` goes away.
- Deleting that effect also orphans the `extensionInstalled` state that gates
  the progress poller: `useExtensionSyncStatus({ enabled: extensionInstalled
  === true })` (lines 108-111). Re-point it at `connection?.installed === true`.
  Miss this and either GET_STATUS never starts (progress silently dies) or it
  polls with no extension present. Invariant 5 is about the *cadence*, not the
  gate — the gate has to move.
- `deriveState` input becomes `{ phase, verdict, sync, … }`:
  - `verdict: checking` → `checking`
  - `extension-missing` → `install-required` (the Install CTA **stays** in the
    control — it's setup, not reconnect)
  - `spotify-disconnected` / `mismatch` / `unpaired` / `unverifiable` → a
    single new `{ kind: 'paused' }` state (the banner owns the action)
  - `ok` → existing ready/triggering/syncing/cooldown/... logic unchanged
- Remove `account-checking`, `account-unavailable`, `account-conflict` from
  `DashboardSyncUiState`; remove `reconnectSpotify` (superseded by
  `repairConnection`). `spotify-reconnect-required` **stays** for the pre-link
  case above, but is now reachable only when `linkedSpotifyId === null`.
- `failSync` (the "did Spotify die mid-sync?" probe, lines 167-182): on a dead
  session, call `reportSpotifyAuthFailure(queryClient)` instead of setting a
  local `needs-spotify` phase — the shared state flips, the banner appears,
  the control shows `paused`. The `needs-spotify` phase and its
  auto-clear effect (lines 268-272) go away; recovery is the connection query
  flipping back to `ok`.
  **It must also `setPhase("idle")`.** `failSync` is only ever reached from
  `trigger()`, which set `phase = "triggering"` on entry; if the dead-session
  branch stops writing a phase, the control is stuck rendering `triggering`
  ("starting…") forever. The push alone doesn't fix that — `deriveState` checks
  `phase` before it looks at readiness. Keep the probe itself (its comment at
  lines 169-172 explains why the lagging poll can't be trusted at failure
  time); only the state it writes changes.
- The silent 401/403 → `pairExtension()` → retry inside `trigger()` (lines
  191-202) **stays exactly as is** — it's the pairing self-heal working as
  designed.

### `src/features/dashboard/components/DashboardSyncControl.tsx`

- Remove the `account-*` branches; add `paused` →
  `<StatusText>sync paused</StatusText>` (the copy `account-conflict` uses
  today at `:111-112`, so linked-account users see no change here).
- Keep the `spotify-reconnect-required` branch for the pre-link case.
- Result: for a linked account the control renders only statuses plus two CTAs
  (Install, Sync).
- Update `DashboardSyncControl.stories.tsx`.

### `src/features/dashboard/components/DashboardSyncStatus.tsx`

- Prop surface follows: takes the verdict (or the already-derived state)
  instead of `accountCheck`.

## Behaviors to preserve

- Fast GET_STATUS cadence while syncing (`ACTIVE_POLL_MS`) — untouched
  (invariant 5).
- Success linger, cooldown countdown, already-running lockout — untouched.
- Fresh-install: `paired: null` from a **just-installed current** extension
  briefly reads `unverifiable` until the first pairing; onboarding owns that
  UX (`linkedSpotifyId` null → verdict `ok` covers pre-link accounts).

## Tests

- `useDashboardSync.test.tsx` — rewrite detection-related cases against the
  injected verdict; keep trigger/cooldown/retry cases as-is (behavior spec).
- `DashboardSyncControl.test.tsx` — replace removed-state cases with `paused`.
- `useExtensionAccountConflict.test.ts` — superseded; its scenarios move to
  `verdict.test.ts` (task 01) — verify coverage parity before deleting in 06.
- New banner tests: one-click fresh-install repair (unpaired + token gone →
  one gesture does both), mismatch-wins ordering, unverifiable has no button.

## Done when

- On the dashboard, no verdict ever renders a reconnect button outside the
  banner; "Never · sync paused" appears with the banner explaining why.
- `bun run test` green.
