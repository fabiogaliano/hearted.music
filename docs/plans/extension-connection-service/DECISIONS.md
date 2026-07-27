# Orchestration deviation log — extension connection service

Decisions made during execution that the plan did not spell out, with a
one-line rationale each. Appended to by every phase subagent.

Run baseline: `4ef7d715`

## Orchestrator

- **Deviation log lives here, not `claudedocs/`.** The orchestrate skill
  suggests `claudedocs/`; this project's `CLAUDE.md` forbids that directory
  and the skill's primary instruction is "next to the plan".
- **Phases run serially, not in parallel.** Tasks 03/04/05 have no logical
  dependency on each other, but each phase ends in a commit against one
  shared working tree, so concurrent implementation would interleave commits.

## Phase 01

- **`fetchExtensionConnection` exported from `connection-state.ts`.** The spec's
  test bullet ("fetcher shapes for: not installed; ... authFailedAt survives a
  refetch...") reads as unit tests against the fetcher's branching logic, not
  against a full Query lifecycle — exporting it lets tests drive it directly
  instead of fighting `staleTime`/cache timing through a real `QueryClient`.
  (Superseded below: the fetcher no longer takes a `previous` argument at all
  — see the post-review entries at the end of this section.)
- **`extensionConnectionKey` exported as a named const** (`["extension",
  "connection"] as const`) rather than inlining the literal array at both the
  query-options and push-channel call sites — same rationale as this repo's
  existing `*Keys` objects (e.g. `dashboardKeys`), avoids key-typo drift
  between `connection-state.ts` and `report-failure.ts`.
- **"Unhealthy" for `refetchInterval` purposes = `!installed ||
  !spotifyConnected || authFailedAt !== null`.** The spec says poll "while
  unhealthy," but `ExtensionConnection` (unlike `ConnectionVerdict`) has no
  `linkedSpotifyId`, so mismatch/unpaired/unverifiable aren't checkable at
  this layer — polling health is judged on the raw connection fields only,
  not the derived verdict. `paired`/`profile` don't gate the interval.
- **`reportExtensionUnreachable` merges onto the previous cache entry**
  (`prev && { ...prev, installed: false, spotifyConnected: false }`) rather
  than replacing it outright, so a first-hand "extension didn't answer"
  observation doesn't clobber `paired`/`profile` the last successful poll
  captured. Matches the `prev &&` pattern the spec gives verbatim for
  `reportSpotifyAuthFailure`.
- **`useExtensionConnection.ts` returns `{ connection, verdict, refetch }`.**
  The spec only fixes the hook's inputs/behavior ("useQuery + deriveVerdict
  ... also returns refetch"), not its return shape; exposing the raw
  `connection` alongside the verdict costs nothing and later tasks (03-05)
  will likely want fields (e.g. `profile` for a mismatch banner) the verdict
  variant already carries but a consumer might want independently.
- **No consumer call sites wired for the push channel.** The orchestrator
  brief mentioned "wires the push-on-auth-failure entry point," read as
  satisfied by `report-failure.ts` existing as the exported entry point
  itself — the task spec is explicit ("Call sites are added in tasks
  03/04/05; here just export + test them") and "Done when" requires "no
  existing file modified (purely additive)," which wiring a call site into
  any current detection hook would violate.

### Post-review fix: lost-update race on the sticky `authFailedAt` (finding 1, CRITICAL)

- **`authFailedAt` moved out of the polled query payload entirely, into its own
  module-level store (`auth-failed-store.ts`).** The original design read the
  previous cache entry synchronously at fetch start (`client.getQueryData`),
  then awaited two extension round-trips before merging it back in. A push
  landing in that window wrote to the same `['extension','connection']` cache
  entry; when the in-flight fetch resolved, TanStack Query replaced the whole
  entry with the fetcher's return value — built from the *stale* pre-push
  snapshot — silently erasing the push. Reproduced against a real
  `QueryClient`: seed healthy → start `fetchQuery` whose mocked
  `getSpotifyAccountStatus` calls `reportSpotifyAuthFailure` mid-flight → final
  cache had `authFailedAt: null`, and `isHealthy()` read healthy, so
  `refetchInterval` returned `false` and polling stopped. Read-before-await +
  merge-after-await is insufficient by construction: there is always a window
  between "fetcher returns" and "TanStack commits," and any push landing in it
  gets clobbered. Moving the flag to a store the poll's queryFn never touches
  removes the race structurally — the poll can only ever replace the
  `extension`/`connection` cache entry, never the store, so there is no shared
  mutable state left for the two writers to race over.
  - `fetchExtensionConnection` now takes no arguments and returns
    `PolledConnection` (`ExtensionConnection` minus `authFailedAt`) — a plain,
    stateless read with nothing for a concurrent write to race against.
  - `reportSpotifyAuthFailure`/`reportSpotifyAuthSuccess` write to the store
    unconditionally (no `prev &&` gating — nothing to merge onto).
    `reportSpotifyAuthFailure` also still does a best-effort `prev &&` merge to
    flip `spotifyConnected: false` on the polled cache for cosmetic purposes;
    that merge can still be raced away by a confirming poll exactly like
    before, and that is now explicitly fine — the verdict is driven by
    `authFailedAt`, not `spotifyConnected`, per invariant 7's ordering.
  - `useExtensionConnection` is the single merge point: it combines
    `useQuery(extensionConnectionQueryOptions())`'s `PolledConnection` with
    `useAuthFailedAt()` (a `useSyncExternalStore` read of the store) into the
    public `ExtensionConnection` shape every consumer (verdict, tasks 02-06)
    expects. No other file constructs a full `ExtensionConnection`.
  - `refetchInterval`'s health check reads `getAuthFailedAt()` directly from
    the store (not from `query.state.data`, which can no longer carry it), so
    a pushed failure keeps the interval alive even when the poll's own fields
    still look healthy — preserving "a sticky auth failure counts as
    unhealthy so polling continues."
  - **Public surface for tasks 02-06:** unchanged. `useExtensionConnection`,
    `ExtensionConnection` (still has `authFailedAt: number | null`),
    `extensionConnectionQueryOptions()`, `deriveConnectionVerdict`, and all
    three `report-failure.ts` exports keep their existing signatures/shapes.
    `reportSpotifyAuthSuccess(queryClient)` keeps its `QueryClient` parameter
    for call-site symmetry even though it's now unused internally (prefixed
    `_queryClient`). Only `fetchExtensionConnection`'s signature changed
    (dropped `previous`), and it isn't part of the plan's public API for later
    tasks (not referenced by 02-06).
  - **Dropped**: the original "drop `authFailedAt` once the poll itself
    reports `connected: false`" auto-clear rule from the 01 task doc. Verified
    it's not achievable race-free without reintroducing a variant of the same
    hazard (the fetcher would have to write `null` into the store as a side
    effect, and an in-flight fetch that started before a *newer* push could
    clear a failure more recent than the read that triggered the clear). The
    README's Risks section — the authoritative source — only requires clearing
    on explicit repair (task 02) and on `reportSpotifyAuthSuccess`; both remain
    intact. The task-01 doc's extra rule was an implementation detail of the
    old, racy merge-in-fetcher design, not a standalone invariant.

### Post-review fix: vacuous lazy-polling test (finding 3, MINOR)

- Replaced `connection-state.test.ts`'s "does not call the fetcher from an
  unsubscribed query" test (which only constructed query options and checked
  mocks weren't called — true even if lazy polling were fully broken) with a
  real `QueryObserver` subscribe/unsubscribe lifecycle test under fake timers,
  asserting: constructing options fetches nothing; subscribing triggers the
  initial fetch; the conditional interval actually fires a second fetch at
  6s while unhealthy and subscribed; unsubscribing stops further fetches even
  after 30s more. This needed a real DOM (`window`) — TanStack Query's
  `refetchInterval` scheduling no-ops under `environmentManager.isServer()`,
  which is `true` whenever `window` is `undefined` — so
  `connection-state.test.ts` was added to `vite.config.ts`'s `domTestFiles`
  list to route it to the jsdom project instead of the default node one.

### Finding 2 (recorded, not code-fixed): `reportSpotifyAuthFailure`'s `prev &&` no-op

- **Resolved as a side effect of the finding-1 redesign**, for the field that
  matters. The spec-mandated `prev && {...}` guard is still present for the
  cosmetic `spotifyConnected` merge onto the polled cache (a no-op when the
  connection query was never fetched), but the sticky `authFailedAt` write is
  now unconditional — it lives in its own store, not gated on any prior cache
  entry. A live command failing on a page that never mounted the connection
  query no longer loses the push: whenever the query does eventually mount and
  fetch, `useExtensionConnection` merges the fresh poll data with whatever the
  store already holds, so the pushed failure is picked up immediately instead
  of being silently dropped. The forward risk this finding flagged (mount the
  connection query at a root/layout level so the cache is always seeded) is
  therefore no longer necessary for correctness — though tasks 03-06 may still
  want a root-level mount for other reasons (e.g. avoiding a `checking` flash
  on every page that first reads the verdict).

### Second-round review fix: polling resumption made explicit (finding 1, IMPORTANT)

- **Chose option (a)-plus-(b) hybrid, weighted toward (b): added an explicit
  `queryClient.invalidateQueries({ queryKey: extensionConnectionKey })` call
  to `reportSpotifyAuthFailure`, kept the existing cosmetic `setQueryData`
  merge as pure optimistic UI, and updated the README Risks bullet.** The
  reviewer's finding was correct: resumption only worked because
  `setQueryData`'s `prev && {...}` merge happens to `dispatch` through
  query-core, which calls every subscribed observer's `onQueryUpdate` →
  `#updateTimers()` and rearms `refetchInterval` — an emergent side effect of
  a write documented as "harmless if a confirming poll later overwrites it,"
  i.e. it read as deletable. Verified the mechanism (traced
  `node_modules/@tanstack/query-core/build/modern/query.js`'s `#dispatch` and
  `queryObserver.js`'s `onQueryUpdate`): both `setQueryData` and
  `invalidateQueries` notify observers via the same `dispatch` →
  `notifyManager.batch` → `onQueryUpdate` path, and `onQueryUpdate` calls
  `#updateTimers()` unconditionally for every dispatch type, including
  `"invalidate"` — so `invalidateQueries` rearms the interval exactly as
  fast (synchronously, before its own refetch even resolves) as the old
  `setQueryData` merge did.
  - Picked `invalidateQueries` over making the `setQueryData` merge
    unconditional (pure option (a)) because its entire purpose is
    self-evident from the call site — nobody reviewing `report-failure.ts`
    can mistake `invalidateQueries({ queryKey: extensionConnectionKey })`
    for cosmetic dead weight the way a `setQueryData` field-merge invites.
    That was the deciding factor: the brief asked for whichever mechanism is
    *hardest to accidentally break*, and "the name of the call states its own
    purpose" beats "the comment says it's important" — comments rot, call
    sites that only work because of what they're named don't.
  - This is safe now in a way it wasn't when the README's Risks section
    originally rejected a confirming refetch: that objection was about
    `authFailedAt` living *inside* the polled cache entry, where a refetch
    reporting `hasToken: true` would overwrite it. Post finding-1 (lost-update
    race fix), `authFailedAt` lives entirely in `auth-failed-store.ts`, which
    the poll's `queryFn` structurally cannot write — so `invalidateQueries`
    can only ever refresh `spotifyConnected`/`paired`/`profile`, fields the
    verdict already ignores once `authFailedAt` is set (verdict.ts rule 3 is
    an `OR`, not an `AND`). Updated the README's Risks wording to record this
    (see `docs/plans/extension-connection-service/README.md`'s
    "Push-on-failure is silently undone by its own confirming refetch"
    bullet) so a future reader doesn't see the new `invalidateQueries` call
    and think it reopens a closed risk.
  - Kept the `setQueryData` merge (now reworded as explicitly optimistic/
    non-load-bearing) rather than deleting it: it gives an instant
    `spotifyConnected: false` read for any future direct consumer of the raw
    field, ahead of the invalidate's refetch resolving. Costs nothing and no
    longer carries a misleading comment.
  - Added a regression test that drives a real, subscribed `QueryObserver`
    through idle-and-healthy (`refetchInterval: false`) → push → a second
    fetch firing without waiting out any interval
    (`connection-state.test.ts`, `"resumes an idle poll on a push (finding 1
    regression guard)"`), plus updated `report-failure.test.ts`'s "issues no
    refetch" test (which asserted the *opposite* of the new, correct
    behavior) to assert `invalidateQueries` is called with the connection
    key. **Verified both fail without the fix**: temporarily deleted the
    `invalidateQueries` line, ran `bun run test -- src/lib/extension/connection`,
    got 2 failures — the new QueryObserver test failed with "expected
    `isExtensionInstalled` to be called 2 times, but got 1" (the push landed
    but no second fetch ever fired), and the updated report-failure test
    failed with "expected `invalidateQueries` to be called ... Number of
    calls: 0". Restored the line; both pass again; full suite reconfirmed
    green (384 files / 4187 tests).
  - `report-failure.test.ts` now calls `reportSpotifyAuthFailure`, which
    (after the finding-3 fix below) has an SSR guard keyed on `typeof window`.
    That file ran in the `node` Vitest project (no `window`), which would have
    silently no-op'd every `setAuthFailedAt` call in it. Moved it into
    `vite.config.ts`'s `domTestFiles` alongside `connection-state.test.ts`.

### Second-round review fix: SSR guard on the auth-failed store (finding 3, MINOR)

- **Added both the defensive comment and a runtime guard** to
  `auth-failed-store.ts`, matching `connection-state.ts:7-9`'s browser-only
  framing but describing the actual hazard for a mutable singleton (not a
  `null`-returning SSR read like `connection-state.ts`'s fetcher, but a
  cross-request leak in TanStack Start's long-lived server process):
  `setAuthFailedAt` now no-ops when `typeof window === "undefined"`.
  `getAuthFailedAt` was deliberately left unguarded — with writes blocked
  server-side, the value can never become non-null there, so reads stay safe
  without their own check, and `useAuthFailedAt`'s `getServerSnapshot` was
  already hardcoded to `null` regardless.
  - The guard is genuinely "cheap and non-invasive" for production code (one
    early-return, same pattern as `transport.ts:55,189` and
    `stale-chunk.ts:40,64` elsewhere in this codebase) but it silently broke
    `report-failure.test.ts`, which runs `reportSpotifyAuthFailure` (→
    `setAuthFailedAt`) under Vitest's `node` project where `window` is
    undefined — every assertion that a failure was recorded would have
    started failing. Fixed by moving that test file into the `dom` project
    (see above) rather than skipping the guard; the file already needs a real
    store to test against, so paying jsdom's setup cost for it is a fair
    trade for closing a real forward trap.

## Phase 02

## Phase 03

## Phase 04

## Phase 05

## Phase 06
