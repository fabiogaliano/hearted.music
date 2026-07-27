# Task 06 — Cleanup and onboarding alignment

## Goal

Delete everything the service supersedes, verify coverage parity, and point
onboarding's detection at the shared state without changing its UX.

## Deletions (after grepping for zero remaining imports)

- `src/lib/extension/useExtensionAccountConflict.ts` + its `__tests__`
  (scenarios must already be covered by `verdict.test.ts` — diff the two test
  files case-by-case before deleting; port any gap first)
- `src/lib/extension/useSpotifyReconnectState.ts` (if not removed in 05)
- Dead exports in `useDashboardSync.ts` (`reconnectSpotify` internals,
  removed state kinds) and any orphaned `ExtensionAccountCheck` types
- Stories/fixtures referencing removed states
  (`src/stories/fixtures/index.ts`, banner/control stories)

## Onboarding (`InstallExtensionStep.tsx`)

- Replace its private `isExtensionInstalled`/`getSpotifyConnectionStatus`
  detection with `useExtensionConnection(null)` reads. **UX unchanged** —
  onboarding keeps its own step sequence, copy, and the "allow sync" pairing
  step (`handleAccept` → `pairExtension` + `triggerExtensionSync` stays).
  This is read-path unification only; if it turns out to require reshaping
  the step machine, stop and split it into its own task instead of forcing it.

## Settings (`src/features/settings/components/ExtensionStatusRow.tsx`)

The sixth detection path, missed by the original task list. It calls
`isExtensionInstalled()` **once on mount** and never again (`:32-42`), so the
Connections row goes stale for the life of the page — install the extension
while Settings is open and it still says "not detected". Swap it for
`useExtensionConnection(null)`: `checking` → "Looking for the extension…",
`extension-missing` → "not detected", everything else → "connected". Copy and
markup unchanged; it gets focus-refresh for free.

## Final sweeps

- `rg "getSpotifyConnectionStatus|isExtensionInstalled" src/` — remaining
  callers should be exactly: the connection fetcher, `create-playlist-from-draft`
  preflight (kept by design, task 04), and `failSync`'s probe (task 03 keeps
  the probe and changes only the state it writes). `ExtensionSetupTrail.tsx`
  and `IconComparison.stories.tsx` also match this pattern but are false
  positives — `isExtensionInstalled` is a *prop name* there, not the import.
- `rg "getSpotifyAccountStatus" src/` — only the connection fetcher.
- `rg "spotify-reconnect-required|account-unavailable|account-conflict" src/`
  — zero hits.
- One dashboard visit issues exactly: connection query polls + GET_STATUS
  polls. Nothing else talks to the extension on an interval — and with the
  conditional `refetchInterval` (task 01) a healthy dashboard settles to
  GET_STATUS only, plus a connection refetch on focus.

## Manual verification script (with the real extension)

1. Fresh unpacked install, linked account → banner shows one Reconnect; one
   click opens Spotify + pairs; after login, banner clears, control shows Sync.
2. Kill the Spotify session (log out of Spotify) → banner "Reconnect Spotify"
   on dashboard; studio gate and liked-songs prompt show the same state.
3. Popup-side disconnect → banner "Reconnect" (no Spotify tab opened — token
   still live).
4. Old-extension simulation (mock `paired: null`) → paused + explanation, no
   button, no conflict.
5. Fail an add-to-playlist auth (expire token mid-session) → prompt appears in
   the panel *and* the dashboard reflects it on next visit.
6. **Sticky-push check (invariant 7).** Revoke the app's access from Spotify's
   account page *without* letting the token expire locally, then attempt an
   add. The prompt must stay on screen through at least two poll ticks —
   `SPOTIFY_STATUS` will keep answering `hasToken: true` and the pre-revision
   design would have erased the prompt within ~200 ms.
7. Pre-link account (`spotify_id` null) on the dashboard → no banner; the sync
   control still offers Reconnect Spotify.

## Done when

- All sweeps clean, `bun run test` green, manual script passes, plan folder
  updated with any deviations discovered during implementation.
