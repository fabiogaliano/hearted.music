# Task 02 — Single repair gesture

## Goal

`repairConnection()` — the one function every reconnect affordance calls. Does
whatever the current verdict needs in a single user gesture: opens Spotify
login only when the token is missing, silently re-pairs in parallel, then
refreshes the shared state.

## The gesture constraint (why the shape is exactly this)

`window.open` must fire **synchronously inside the click handler** — awaiting
anything first (e.g. `pairExtension()`, a status re-check) spends the user
gesture and the popup is blocked. This is already encoded in
`useDashboardSync.ts:248-251` and `reconnect-link.ts`. Therefore repair
branches on the **last-polled** verdict (≤6s stale — same granularity the app
acts on today) instead of re-checking, and the silent re-pair runs alongside
the open, never before it.

## New file

### `src/lib/extension/connection/repair.ts`

```ts
export interface RepairConnectionInput {
  verdict: ConnectionVerdict;
  queryClient: QueryClient;
  /** Spotify login URL to arm. Callers pass their surface's URL (dashboard
   * uses the accounts.spotify.com login wrapper; inline links use
   * open.spotify.com — both flow through buildArmedSpotifyUrl). */
  spotifyLoginUrl: string;
}

/** Returns the in-flight pairing promise (already resolved when no pairing was
 * needed) so callers can drive a pending affordance. The function body itself
 * is synchronous — the promise is a *return value*, never an internal await. */
export function repairConnection(input: RepairConnectionInput): Promise<void>;
```

Returning the promise is what lets task 03's banner keep its `repairing`
disabled state: today `onReconnect` awaits `pairExtension()` directly
(`ExtensionAccountBanner.tsx:107-115`), and a `void` return would silently drop
that pending state. Callers must not `await` before `window.open` — but they
never do, because the open already happened inside the call.

Synchronous body, in order:

1. **Spotify step** — only when the verdict says the token is gone
   (`spotify-disconnected`, or `mismatch` where the fix is switching accounts):
   generate `armToken`, `void expectLoginReturn(armToken).catch(() => {})`,
   `window.open(buildArmedSpotifyUrl(spotifyLoginUrl, armToken), "_blank",
   "noopener,noreferrer")`. Reuses `reconnect-link.ts` primitives — no new
   arming logic. Also clear `authFailedAt` here (the user is acting on the
   prompt; leaving it set would pin the app to `spotify-disconnected` forever).

   **`mismatch` caveat, inherited not introduced.** Opening a login URL while
   the browser still holds a live session for the *wrong* account does not
   switch accounts — Spotify redirects straight through to `open.spotify.com`
   still signed in as that account, and the armed token re-captures the same
   wrong identity. Today's "Switch Spotify account" affordance
   (`ExtensionAccountBanner.tsx:66` → `SpotifyReconnectLink` →
   `open.spotify.com`) has exactly this hole, so routing it through
   `repairConnection` is not a regression — but it is not a fix either. To
   actually repair a mismatch the URL must be a logout
   (`accounts.spotify.com/en/logout`), which flips the extension's
   `hasSpotifySession()` gate (`dispatcher.ts:153`) and forces a real re-login.
   Decide explicitly in task 03 whether to fix this here or keep the affordance
   instructional; do not let it pass as "handled".
2. **Pairing step** — fire-and-forget, in parallel:
   `void pairExtension().finally(() => queryClient.invalidateQueries({
   queryKey: ['extension','connection'] }))`. Runs for `unpaired`,
   `spotify-disconnected`, and `unverifiable` verdicts (harmless if already
   paired — it just re-mints; and it's exactly what heals the fresh-install
   case where both credentials are empty).
3. `extension-missing` / `checking` / `ok` → no-op (callers gate the button on
   the verdict; this is a safety net, not a UI path).

Note on invariant 3 (never silently undo an explicit disconnect): repair only
ever runs from an explicit user click on a reconnect affordance — that click
*is* the user asking to reconnect, so re-pairing here is consented, unlike a
background auto-repair.

## Existing primitives reused (no changes)

- `pairExtension()` — `src/lib/extension/connect.ts:17`
- `buildArmedSpotifyUrl`, `expectLoginReturn` — `reconnect-link.ts`,
  `detect.ts:102`
- `shouldArmOnEvent` stays with `SpotifyReconnectLink` for anchor-style
  affordances (task 05 decides per surface whether to keep the anchor or a
  button calling `repairConnection`).

## Tests → `src/lib/extension/connection/__tests__/repair.test.ts`

- `spotify-disconnected` → `window.open` called with an armed URL **and**
  `pairExtension` fired; open happens without awaiting pair (assert call order
  / no `await` before open via mock timing).
- `unpaired` (Spotify fine) → **no** `window.open`; `pairExtension` + query
  invalidation.
- `mismatch` → `window.open` (switch account), pairing untouched or harmless.
- `ok` / `checking` / `extension-missing` → no-op (and the returned promise
  still resolves, so a caller's pending state can't hang).
- Invalidation fires even when `pairExtension` rejects (`finally`).
- `authFailedAt` is cleared by a repair that opens Spotify, so the verdict can
  return to `ok` once the poll confirms.

## Done when

- `bun run test` green; still purely additive.
