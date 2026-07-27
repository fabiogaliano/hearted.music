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

- **`setAuthFailedAt(null)` called directly from `auth-failed-store.ts`, not
  via `reportSpotifyAuthSuccess(queryClient)`.** Both clear the same field;
  `reportSpotifyAuthSuccess` exists for symmetry with the other two
  `report-failure.ts` exports and takes an unused `queryClient` param purely
  for call-site shape. Calling the store setter directly avoids passing a
  `queryClient` argument through a function that ignores it, and keeps
  `repair.ts`'s only `report-failure.ts`-adjacent dependency limited to the
  store it actually needs.
- **Pairing step gated per-verdict with a literal `unpaired | spotify-disconnected
  | unverifiable` check, not a "verdict !== mismatch" catch-all.** The spec
  names exactly these three verdicts; a catch-all would also silently fire
  pairing for `ok`/`checking`/`extension-missing`, which the spec's step 3
  explicitly calls a no-op path. Spelling out the three keeps the no-op list
  the single source of truth for "nothing happens here."
  - Note `unverifiable` fires the pairing step, not the Spotify-login step
    (`paired !== true` with a healthy `spotifyConnected` — a login popup would
    be wrong for a token that's already fine).
- **Return type `Promise<void>` achieved via `.then(() => undefined)` after
  `.finally(...)`**, not by declaring `repairConnection` `async`. An `async`
  function body still compiles to "no `await`" here, but a plain function
  returning promise chains makes the "never an internal await" constraint
  visible at the type/shape level, not just by convention — matches how the
  spec phrases it ("the promise is a return value, never an internal await").
  A rejecting `pairExtension()` still propagates as a rejection through
  `.then` (only `.catch`/second-arg would swallow it); left un-swallowed since
  the spec doesn't ask for that and task 03 (which consumes the return value
  for a `repairing` UI state) is better placed to decide whether to display a
  pairing-failed state or not.
- **Test for invariant 1 asserts a synchronous call-order log, not just
  "`window.open` was called".** Calls `repairConnection(...)` without
  awaiting, then immediately (same microtask) asserts `window.open` already
  fired before `pairExtension` had a chance to. A version with `await
  pairExtension()` inserted before `window.open` would leave `open-called`
  absent from the log at that checkpoint, so the test fails specifically on
  the ordering the invariant protects, not on end-state call counts.
- **New test file added to `vite.config.ts`'s `domTestFiles` list.**
  `repair.ts` calls `window.open` and `setAuthFailedAt` (which no-ops without
  a real `window`, per `auth-failed-store.ts`'s SSR guard from phase 01);
  `repair.test.ts` needed jsdom for the same reason
  `report-failure.test.ts`/`connection-state.test.ts` did.

## Phase 03

- **`deriveState` checks `phase` before the verdict, uniformly — the old
  "account-conflict overrides even an in-flight phase" quirk is dropped.**
  The old `deriveState` checked `accountCheck.kind === "conflict"` (and, when
  installed+connected, `checking`/`unavailable`) *before* any phase branch, so
  a conflict could interrupt an `error`/`triggering`/etc. mid-flight. The spec's
  instruction for `failSync` — "It must also `setPhase("idle")`... the push
  alone doesn't fix that — `deriveState` checks `phase` before it looks at
  readiness" — only makes sense if phase uniformly outranks the verdict in the
  new `deriveState`; otherwise the push (`reportSpotifyAuthFailure`, which
  flips the shared verdict to `spotify-disconnected`) would already unstick a
  `triggering` phase on its own, and the explicit `setPhase("idle")` call would
  be redundant. So `deriveState` now checks `error → cooldown → success →
  already-running → triggering` first, then falls through to the
  verdict-derived `checking / install-required / paused|spotify-reconnect-
  required / ready|syncing`, exactly mirroring the old phase-then-fallback
  skeleton but with every "verdict-like" case (not just conflict) demoted to
  the fallback.
  - **Test expectation changed as a direct consequence:** `useDashboardSync.test.tsx`'s
    old `"blocks an error retry when an account conflict appears"` asserted
    that a conflict rerender flips an in-flight `error` state straight to
    `account-conflict` and blocks the pending retry. Replaced with
    `"phase (an in-flight error) is checked before the verdict, so a verdict
    change alone can't override it — retry still works and re-triggers"`,
    which asserts the opposite: the `error` state survives a verdict rerender
    to `unpaired`, and clicking retry still calls `requestExtensionSync` again.
    This is the direct, unavoidable flip side of the ordering change above —
    without it, `failSync`'s `setPhase("idle")` requirement wouldn't be
    load-bearing, so I'm confident this is what the spec intends rather than
    an oversight.
- **The pre-link `spotify-reconnect-required` CTA (kept in the sync control
  per spec) now delegates to `repairConnection` instead of a bespoke
  `expectLoginReturn`/`buildArmedSpotifyUrl`/`window.open` sequence.** The spec
  only explicitly routes the *banner's* three actionable verdicts through
  `repairConnection`, but the pre-link control CTA is still a reconnect
  affordance calling the exact same `spotify-disconnected` verdict path — using
  the shared primitive here removes ~10 duplicated lines from
  `useDashboardSync.ts` and means there's only one place `window.open`/arming
  logic for Spotify reconnects lives outside `repair.ts` and
  `SpotifyReconnectLink`/`reconnect-link.ts`. Consequence: this CTA now also
  silently re-pairs (since `spotify-disconnected` is in `repairConnection`'s
  `needsPairing` set), which the old `reconnectSpotify` deliberately did not do
  (its comment said "not re-pair"). Harmless (re-pairing is idempotent) and
  arguably a fix in its own right (the fresh-install pre-link case now also
  resolves in one click), but it *is* a behavior change from the old code, so
  I changed `useDashboardSync.test.tsx`'s corresponding test
  (`"prompts to reconnect Spotify..."` → `"pre-link: prompts to reconnect
  Spotify from the control itself, and a click repairs in one gesture"`) to
  assert `pairExtension` **is** called, where the old test asserted it was
  **not**.
- **`repairConnection`'s rejection (carried forward from phase 02's review) is
  caught at both of its two call sites, not centralized in `repair.ts`
  itself.** Phase 02 left the returned promise able to reject on purpose,
  deferring the decision to this task. Both the banner's `onReconnect` and the
  sync control's pre-link `onAction` now attach a `.catch(() => {})` (banner
  also has a `.finally(() => setRepairing(false))` to guarantee the disabled
  state never sticks). Chose call-site handling over swallowing inside
  `repair.ts` because the two callers need different follow-through (the
  banner drives a `repairing` UI flag; the control's CTA is fire-and-forget) —
  centralizing would either force a UI concern into a connection-layer
  primitive or lose the control call site's need to avoid an unhandled
  rejection. Verified with a dedicated test
  (`ExtensionAccountBanner.test.tsx`'s `"does not leave the button stuck
  disabled when pairExtension rejects"`) that mocks `pairExtension` to reject
  and asserts the button returns to its enabled, non-"Reconnecting…" state.
- **"Switch Spotify account" now calls `repairConnection` (a plain button)
  instead of rendering `SpotifyReconnectLink` (an anchor).** Matches the
  spec's table exactly ("mismatch → 'Switch Spotify account' →
  `repairConnection`"). Per the open decision the plan explicitly left to this
  task: **kept current behavior, did not add a logout URL.**
  `repairConnection`'s mismatch branch opens the same
  `accounts.spotify.com/.../login` wrapper used for `spotify-disconnected`
  (not `open.spotify.com` the way the old `SpotifyReconnectLink` did) — it
  still can't force a different Spotify account if the browser already holds a
  live session for the wrong one (Spotify redirects straight through, per
  `02-repair-action.md`'s inherited-caveat note), so the button is
  functionally still "instructional" for that hole, matching the plan's
  "pre-existing, not introduced here" framing. Not building a logout-based fix
  is a deliberate scope decision, not an oversight: the plan explicitly frames
  it as optional ("Decide explicitly... whether to fix this here or keep the
  affordance instructional") and a logout redirect is a bigger behavioral
  change (it would sign the user out of Spotify entirely in that tab) that
  deserves its own review, not a drive-by inside this migration.
- **New copy for `spotify-disconnected` and `unverifiable`** (the spec asked
  for new copy but didn't dictate wording): "Your Spotify session expired, so
  syncing is paused." / "Reconnect Spotify" for the former (mirrors the
  existing `unpaired` copy's structure); "We can't verify your Spotify account
  right now — this can happen with an older version of the extension. Syncing
  is paused until it's confirmed." with no button for the latter (invariant
  6 — explicitly nothing to repair with a click).
- **`useDashboardSync`'s new `verdict`/`linkedSpotifyId` params default to
  `{ kind: "ok" }` / `null`.** Not required by any real caller (`DashboardSyncStatus`
  always passes both explicitly) — kept purely so trigger/cooldown/retry tests
  that don't care about connection state can still call
  `useDashboardSync(ACCOUNT_ID)` without boilerplate, mirroring the old
  `DEFAULT_ACCOUNT_CHECK` pattern.
- **`extensionInstalled` (the `useExtensionSyncStatus` `enabled` gate, orphaned
  by the detection-poll deletion) is derived from `verdict.kind`, not passed as
  a separate prop.** `verdict.kind !== "checking" && verdict.kind !==
  "extension-missing"` is exactly `connection?.installed === true` by
  construction (verdict.ts's rules 1–2 return `checking`/`extension-missing`
  precisely when the connection is unsettled/absent, and every other verdict
  requires `connection.installed` to be true to be reached at all) — passing
  `connection.installed` through as a fourth hook parameter would duplicate
  information the verdict already encodes and widen the hook's surface for no
  behavioral gain.
- **Dashboard.stories.tsx's `ReadyExtensionStub` SPOTIFY_STATUS response
  updated to include `paired: true` and a `profile` matching
  `simulateDashboard`'s `linkedSpotifyId` ("story-spotify-id").** Not
  spec-mandated, but without it the shared verdict now resolves to
  `unverifiable` (paired/profile both missing from the stub) instead of `ok`,
  so `ReadyWhileEnrichmentRunning` — an integration story explicitly meant to
  show an all-healthy dashboard — would unexpectedly render the new banner.
  The old `useExtensionAccountConflict` treated the same missing fields as
  `unavailable` (banner hidden), so this stub was accidentally "correct" only
  because the old hook's coarser states happened not to surface it; the new,
  more precise verdict exposes the gap. Fixed by completing the stub's fake
  response rather than special-casing the story.
- **New tests added, not required by name but requested in spirit:**
  `ExtensionAccountBanner.test.tsx` (verdict → copy/button mapping, one-click
  fresh-install repair for both `unpaired` and `spotify-disconnected`,
  mismatch never pairs, unverifiable has no button, pre-link suppression, the
  repair-rejection recovery) and
  `src/features/dashboard/__tests__/reconnect-affordance.test.tsx` — the
  explicit two-reconnects regression guard the task calls for, rendering
  `ExtensionAccountBanner` and `DashboardSyncStatus` together under the same
  injected verdict and asserting exactly one reconnect-shaped button ever
  appears (and none once the verdict is `ok`).
- **Left in place for phase 06:** `useExtensionAccountConflict.ts` and its
  test (`src/lib/extension/__tests__/useExtensionAccountConflict.test.ts`) are
  now unused by the dashboard but not deleted — the task doc explicitly defers
  that ("superseded; verify coverage parity before deleting in 06"). Also
  `SpotifyReconnectLink`/`reconnect-link.ts`'s `armReconnectOnActivation` path
  is untouched (still used by matching/liked-songs/playlists surfaces — task
  05's territory), and `DashboardProps`'s comment referencing "the extension
  account-conflict banner" is now slightly dated terminology but still
  accurate in substance, left as-is to avoid unrelated churn.

### Post-review fix: verdict-vs-phase ordering over-generalized (finding 1, IMPORTANT)

- **Root cause:** the task doc's instruction — "`failSync` must also
  `setPhase("idle")`, or `deriveState` (which checks `phase` before it looks
  at readiness) leaves the control stuck rendering `triggering` forever" —
  was read as license to make *every* phase check unconditionally outrank the
  verdict, uniformly. That's a bigger change than the plan asked for: the old
  `deriveState` (`git show 2d08f070`) only let one thing skip ahead of the
  phase branches — `accountCheck.kind === "conflict"` (today's `mismatch`),
  checked before any phase, plus `checking`/`unavailable` when the raw
  connectivity already looked fine. A stale `error`/`cooldown`/
  `already-running`/`success` phase could still mask an unpaired/mismatched/
  disconnected account under that design; the migration removed that masking
  entirely instead of preserving it, which is what let a stale `error` phase
  render its own Retry button directly alongside the banner's Reconnect for
  the same broken connection — two affordances, and the Retry one doomed
  (retrying a connection that's known broken can't succeed).
- **Chosen ordering rule:** `deriveState` now checks, in order: (1) is the
  verdict broken (`!== "ok"`, `!== "checking"`, `!== "extension-missing"`)
  *and* is the account linked (`linkedSpotifyId !== null`)? If so, return
  `paused` unconditionally — before any phase branch. (2) Otherwise, the
  existing phase ladder (`error → cooldown → success → already-running →
  triggering`). (3) Otherwise, the verdict-derived fallback
  (`checking`/`extension-missing`/pre-link `spotify-reconnect-required`/
  `ready`/`syncing`). Rule (1)'s verdict set is exactly the set the dashboard
  banner (`ExtensionAccountBanner`, per `03-dashboard.md`'s table) renders its
  own Reconnect CTA for — `mismatch` / `unpaired` / `spotify-disconnected` /
  `unverifiable` — so "outranks phase" is scoped to precisely the verdicts
  that would otherwise collide with the banner's button. `extension-missing`
  is deliberately excluded from rule (1): the banner never renders for it (it
  keeps the control's own "Install extension" CTA, a *setup* affordance, not
  a reconnect one), so there is no second affordance for a stale phase to
  collide with there, and excluding it also matches the old code (raw
  "not installed" was checked *after* the phase ladder, at the very bottom).
  This can't reproduce the two-affordance bug because the only banner-owned
  verdicts are exactly the ones that now short-circuit before the control can
  render anything with a button (`error` is the only phase state with one);
  it can't reproduce a doomed retry because `onAction`'s `"error"` case is
  simply never reached while the verdict is broken — `deriveState` returns
  `paused` instead, whose `onAction` branch is a no-op.
- **`failSync`'s `setPhase("idle")` requirement is superseded, not dropped —
  because finding 2 (below) deletes the function it lived in.** Finding 2
  removes the `reportSpotifyAuthFailure` push this call site made (no
  reliable signal to gate it on), and without a push there's no shared-verdict
  escape hatch for rule (1) above to route through — so the literal
  `setPhase("idle")` instruction (written for a design where the shared
  verdict, not the local phase, would carry the resolution) doesn't have
  anywhere to attach. What's preserved is the *invariant* the instruction was
  protecting — "never leave the control stuck rendering `triggering`
  forever" — which now holds structurally: every path out of `trigger()`
  (including the former `failSync` cases) calls `fail()`, which always sets a
  terminal, non-stuck phase (`error`), never leaves `triggering` in place
  un-resolved. Setting phase to `idle` specifically would have been actively
  wrong here anyway — with no push, `idle` resolves straight back to `ready`,
  silently hiding a real sync failure from the user.
- **Test consequence:** replaced `useDashboardSync.test.tsx`'s
  `"pushes a shared auth failure and resets phase to idle..."` test (finding
  2 deleted the behavior it covered) with two tests — one asserting a
  dead-session sync failure now surfaces as a plain retryable `error` with no
  push, one asserting a successful sync calls `reportSpotifyAuthSuccess`.
  Replaced the `"phase (an in-flight error) is checked before the verdict..."`
  test — which asserted the exact bug this finding reports (a verdict change
  to `unpaired` failing to override a stale `error` phase) — with
  `"a broken verdict on a linked account outranks a stale error phase..."`,
  which asserts the opposite and is the explicit verdict×phase regression
  guard the finding asked for: renders `error`, rerenders with verdict
  `unpaired`, asserts the state collapses to `paused` and a click doesn't
  call `requestExtensionSync` again: then rerenders back to verdict `ok` and
  confirms the original stale `error` phase (never reset, since this path
  doesn't go through the deleted push) resurfaces and retry still works —
  proving rule (1) only *masks* the phase while the verdict is broken, it
  doesn't destroy it.

### Post-review fix: unbounded sticky auth failure (finding 2, IMPORTANT)

- **Removed the push entirely rather than reclassifying it.** The task doc
  asked `failSync` to call `reportSpotifyAuthFailure` whenever a fresh
  `getSpotifyConnectionStatus()` probe read `hasToken: false` after a sync
  failure. That probe is the exact same local `hasToken` check invariant 7
  documents as unreliable for the *poll* (`token !== null && isTokenValid() &&
  !isAnonymous`, `dispatcher.ts:160`) — re-running it at failure time doesn't
  make it authoritative, it's a second read of the same blind-spot signal.
  Checked whether `TRIGGER_SYNC`'s wire contract carries anything better:
  `ExtensionSyncRequestResult`'s `source: "extension"` failure branch
  (`shared/extension-sync-contract.ts`) is a free-text `error: string` thrown
  from `performSync()` (`extensions/src/background/service-worker.ts:508-511`)
  — including `throw new Error("No valid token")`, which is itself just the
  same local `isTokenValid()` check, not a live Spotify-side rejection. There
  is no `AUTH_REQUIRED`/`TOKEN_EXPIRED`-style structured code anywhere in this
  contract (unlike `CommandResponse`/`SpotifyErrorCode`, which
  `spotify-action-outcome.ts`/`spotify-reconnect.ts` already classify
  correctly for the command shape playlist/matching actions use). So per the
  finding's own fallback ("if classification genuinely cannot be made
  reliably at this call site, do not push here at all — a missing push is far
  less harmful than a false sticky one"): **no push from this call site.**
  Deleted `failSync` outright (it existed only to run the probe + branch
  between push and `fail()`) and call `fail(message, "retry")` directly from
  both of `trigger()`'s failure branches (backend and extension-sourced).
  `reportSpotifyAuthFailure` now has zero call sites anywhere in the repo
  (confirmed by grep) — expected and correct: genuine pushes belong at
  command call sites that carry a real `errorCode`, which is tasks 04/05's
  territory, not this one.
- **Wired `reportSpotifyAuthSuccess`** at `trigger()`'s success path
  (immediately after `invalidateDashboard()`), the one "a Spotify command
  succeeded" moment in this hook's scope — a completed `TRIGGER_SYNC` read
  liked songs/playlists through the extension's live Spotify token, so it's
  legitimate evidence the token is good. This is also the first production
  call site for `reportSpotifyAuthSuccess` (previously zero, confirmed by
  grep — the exact gap the finding flagged: the README's Risks section
  promises `authFailedAt` "cleared on... the next Spotify command that
  succeeds," but nothing ever called the function that clears it). Did *not*
  wire it off `useExtensionSyncStatus`'s `GET_STATUS` poll — that reads
  `hasToken` from the same local, unauthoritative check this finding is about
  removing reliance on, so treating it as "success evidence" would just
  reintroduce the same class of false signal on the clearing side.
  Deliberately scoped to phase 03 only, per the brief — no call site added to
  the `useExtensionSyncStatus`/`useExtensionConnection` poll layer (phase 01)
  or to playlist/matching command paths (phases 04/05); those will wire their
  own genuinely-classified success/failure pushes against structured
  `errorCode`s.
- **Test consequence:** removed `mockGetSpotifyConnectionStatus`/
  `mockReportSpotifyAuthFailure` from `useDashboardSync.test.tsx` (the
  production code no longer calls either) and added
  `mockReportSpotifyAuthSuccess`. Added two tests: a dead-session sync
  failure now asserts a plain `error`/`retry` state with the raw message
  surfaced, and a successful sync asserts `reportSpotifyAuthSuccess` was
  called exactly once.

## Phase 04

## Phase 05

## Phase 06
