# Task 01 — Shared connection state (poll + push)

## Goal

One TanStack Query that owns the complete extension-connection picture, with a
push channel so any surface's auth failure updates the whole app. No consumer
migrations yet — this task only builds and tests the core.

## New files

### `src/lib/extension/connection/connection-state.ts`

```ts
export interface ExtensionConnection {
  /** PING answered. */
  installed: boolean;
  /** Usable (non-anonymous, unexpired) Spotify token captured. */
  spotifyConnected: boolean;
  /** hearted apiToken present. null = extension predates the field (unknown). */
  paired: boolean | null;
  /** Spotify identity captured by the extension. null when unavailable. */
  profile: ExtensionSpotifyProfile | null;
  /** Set when a live Spotify command came back AUTH_REQUIRED/TOKEN_EXPIRED.
   * Outranks `spotifyConnected` — see invariant 7. */
  authFailedAt: number | null;
}
```

- `extensionConnectionQueryOptions()` — `queryKey: ['extension','connection']`,
  fetcher:
  1. `isExtensionInstalled()`; if false → `{ installed: false,
     spotifyConnected: false, paired: null, profile: null, authFailedAt: null }`
  2. `getSpotifyAccountStatus()` (one `SPOTIFY_STATUS` wire call — already
     returns `connected`, `paired`, `profile` from `detect.ts:83`); if `null`,
     the PING already proved the extension is **there**, so this is a reachable
     extension that didn't answer this command — an older build predating
     `SPOTIFY_STATUS`, or a background hiccup. Return `{ installed: true,
     spotifyConnected: false, paired: null, profile: null, authFailedAt: null }`.
     **Not** the not-installed shape: collapsing the two shows "Install
     extension" to someone who has it installed (invariant 6), which regresses
     both current hooks — `useExtensionAccountConflict` calls this `unavailable`
     (`:66-69`) and `useDashboardSync` keeps `extensionInstalled: true`.
  3. Preserve a sticky `authFailedAt` across refetches: seed it from the
     previous cache entry, dropping it only when this read reports
     `connected: false` (the extension now agrees, so the flag is redundant).
     Also cleared explicitly by `repairConnection` and `reportSpotifyAuthSuccess`.
- Polling: `refetchOnWindowFocus: true`, `staleTime` a few seconds so focus
  refetches don't spam, and a **conditional** `refetchInterval` — ~6s while the
  connection is unhealthy, `false` once it is fully `ok`. A flat interval polls
  every authenticated page forever and discards the deliberate "a healthy
  session never PINGs the extension again" optimization documented in
  `useSpotifyGate`'s header. Focus refetch plus the failure push covers the
  healthy path; the interval exists to observe *recovery*, which only matters
  while broken. The interval runs only while a component subscribes — Query's
  subscriber model gives us lazy polling for free.
- Do **not** call this from a route loader: the fetcher is browser-only
  (`sendExtensionCommand` returns `null` under SSR, `transport.ts:189`), so a
  server-side run would seed the cache with a false `extension-missing`.

### `src/lib/extension/connection/verdict.ts`

Pure function — trivially unit-testable, no React:

```ts
export type ConnectionVerdict =
  | { kind: 'checking' }
  | { kind: 'extension-missing' }
  | { kind: 'spotify-disconnected' }          // token gone → user gesture needed
  | { kind: 'mismatch'; extensionProfile: ExtensionSpotifyProfile }
  | { kind: 'unpaired' }                       // explicit disconnect (paired === false)
  | { kind: 'unverifiable' }                   // paired null / profile null — old ext or hiccup
  | { kind: 'ok' };

export function deriveConnectionVerdict(
  connection: ExtensionConnection | undefined,
  linkedSpotifyId: string | null,
): ConnectionVerdict;
```

Ordering rules (from `useExtensionAccountConflict.ts:57-88`, preserved):
1. `undefined` (query not settled) → `checking`
2. `!installed` → `extension-missing`
3. `!spotifyConnected || authFailedAt !== null` → `spotify-disconnected`
   (invariant 7: a live command failure beats the poll's local-expiry check)
4. `linkedSpotifyId === null` → `ok` (identity check not required pre-link)
   — note this rule sits *after* 2 and 3 deliberately, so the studio gate can
   pass `null` and still get `extension-missing`/`spotify-disconnected`.
5. `profile && profile.spotifyId !== linkedSpotifyId` → `mismatch`
   (**mismatch outranks unpaired** — invariant 2)
6. `paired === false` → `unpaired`
7. `paired !== true || profile === null` → `unverifiable` (invariant 6:
   never conflate with `unpaired`)
8. → `ok`

### `src/lib/extension/connection/useExtensionConnection.ts`

Thin hook: `useQuery(extensionConnectionQueryOptions())` +
`deriveConnectionVerdict(data, linkedSpotifyId)`. Also returns `refetch` for
"check again" affordances.

### `src/lib/extension/connection/report-failure.ts`

The push channel:

```ts
export function reportSpotifyAuthFailure(queryClient: QueryClient): void;
export function reportSpotifyAuthSuccess(queryClient: QueryClient): void;
export function reportExtensionUnreachable(queryClient: QueryClient): void;
```

- `reportSpotifyAuthFailure`: `setQueryData(['extension','connection'], prev =>
  prev && { ...prev, spotifyConnected: false, authFailedAt: Date.now() })` —
  instant, app-wide. **No `invalidateQueries` here.** The original plan called
  for an immediate "authoritative" refetch; that is exactly wrong (invariant 7).
  `SPOTIFY_STATUS` reports `hasToken` from a *local* validity check, so a token
  Spotify has rejected still reads `true` — the confirming refetch would flip
  `spotifyConnected` back and erase the prompt in ~200 ms, before the user can
  click it. The sticky `authFailedAt` is what makes the push survive; polls may
  update the other fields freely.
- `reportSpotifyAuthSuccess`: clears `authFailedAt` — call it wherever a
  Spotify command returns `ok`, so a stale sticky flag can't outlive the
  problem. This is the counterweight that keeps the failure bounded.
- `reportExtensionUnreachable`: `setQueryData(… { installed: false,
  spotifyConnected: false })` for first-hand "the extension didn't answer"
  observations (task 04's `reportGateFailure('extension-unavailable')`).
  Invalidation alone can't serve that case — it's async, so the surface keeps
  rendering the stale `installed: true` until the refetch lands, losing the
  synchronous force-a-state semantics `reportGateFailure` has today.

Call sites are added in tasks 03/04/05; here just export + test them.

## Behaviors to preserve

- One PING + `SPOTIFY_STATUS` pair per poll tick app-wide (replaces the
  dashboard's two independent pairs at 4s and 6s).
- `paired: null` stays distinguishable from `paired: false` end-to-end.
- PING-then-`SPOTIFY_STATUS` stays two wire calls on purpose. Deriving
  `installed` from `getSpotifyAccountStatus() !== null` alone would halve the
  traffic but would misreport an installed-but-old extension as missing —
  invariant 6 is worth the extra round trip.

## Tests → `src/lib/extension/connection/__tests__/`

- `verdict.test.ts` — table-driven over the ordering rules; explicit cases for
  mismatch+unpaired both true (mismatch wins), `paired: null` → `unverifiable`,
  `linkedSpotifyId: null` short-circuit.
- `connection-state.test.ts` — fetcher shapes for: not installed; installed but
  `getSpotifyAccountStatus()` null (**asserts `installed: true`** — the
  invariant-6 regression guard); full status passthrough; `authFailedAt`
  survives a refetch that still reports `connected: true`, and is dropped when
  the read reports `connected: false`.
- `report-failure.test.ts` — failure sets `authFailedAt` + flips
  `spotifyConnected`; **no refetch is issued**; a subsequent poll returning
  `hasToken: true` does *not* resurrect `ok` (the regression this whole field
  exists to prevent); `reportSpotifyAuthSuccess` clears it.

## Done when

- `bun run test` green; no existing file modified (purely additive).
