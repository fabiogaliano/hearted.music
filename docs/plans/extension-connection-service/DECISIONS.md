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

- **`useSpotifyGate` is now a pure selector plus two thin wrappers, nothing
  else.** All detection, cadence, and focus/visibility handling was deleted
  from the hook body — it reads `useExtensionConnection(null)` and maps
  `verdict.kind` to `SpotifyGateState` with a `switch` (see
  `gateStateForVerdict`), wraps `refetch` back to the existing
  `Promise<void>` `recheck()` contract, and routes `reportGateFailure` to
  `reportSpotifyAuthFailure`/`reportExtensionUnreachable`. No local state, no
  request-id ref, no effects — matches the task's "thin selector" framing
  literally rather than leaving any transitional detection code behind.
- **Passing `linkedSpotifyId: null` collapses the verdict space the gate can
  ever see.** Traced `deriveConnectionVerdict`: with `linkedSpotifyId ===
  null` it returns `ok` immediately after the `spotifyConnected`/
  `authFailedAt` check, before the `mismatch`/`unpaired`/`unverifiable`
  branches run — so in practice `gateStateForVerdict` only ever receives
  `checking`, `extension-missing`, `spotify-disconnected`, or `ok`. Kept the
  `switch` exhaustive over the *full* `ConnectionVerdict` union anyway (with
  a `default: verdict satisfies never` guard, mirroring
  `usePublishPlaylist.ts`'s existing idiom) rather than narrowing the
  parameter type, so a future verdict kind is a compile error here instead
  of silently falling through to `ok`.
- **Invariant 4 needed no bespoke code, only a bespoke test.** The spec
  itself says this ("TanStack Query already gives this... Add a test pinning
  it"), but confirmed it by tracing: `useExtensionConnection`'s `verdict` is
  derived from `query.data` alone, never `query.isFetching`, and
  `useQuery`'s `data` stays populated with the previous result for the
  entire duration of a refetch. The pin is
  `useSpotifyGate.test.tsx`'s "a settled ok never downgrades to checking
  while a background refetch is in flight" test: hangs the connection
  fetch's `getSpotifyAccountStatus` call mid-flight via a deferred promise,
  calls `recheck()`, and asserts `gateState` is still `"ok"` before the
  fetch resolves. A second test in the same block resolves that same
  in-flight refetch to an unhealthy result and asserts the gate lands
  directly on `reconnect-required` — proving the transition skips `checking`
  even when the *new* data is unhealthy, not just when it's healthy.
- **`extension-unavailable` → `reportExtensionUnreachable`, confirmed
  synchronous by testing it under a frozen `isExtensionInstalled` mock.** Set
  `mockIsExtensionInstalled` to return a promise that never resolves right
  before calling `reportGateFailure("extension-unavailable")`, then asserted
  the gate still reaches `extension-unavailable` — if the code path depended
  on any refetch landing, this test would hang/timeout instead of passing.
  (The assertion itself still needs `waitFor`, not a bare synchronous
  expect — see next bullet — but nothing in the awaited window is the frozen
  mock resolving.)
- **Test-file consequence I didn't anticipate going in: TanStack Query's
  `notifyManager` schedules observer re-renders via `setTimeout(…, 0)`, not
  synchronously.** Two tests originally asserted `gateState` immediately
  after a plain (non-awaited) `act(() => { ... })` wrapping a `setQueryData`-
  based push (the "resolves unhealthy" anti-flicker test and the
  `extension-unavailable` synchronous-push test above) and both failed with
  the *previous* `gateState` still showing. Root-caused via
  `notifyManager.js`: `defaultScheduler = systemSetTimeoutZero`, so a cache
  write's observer notification is deferred a macrotask even for a
  synchronous `setQueryData` call. Fixed by swapping the trailing bare
  `expect` for `await waitFor(() => expect(...))` in both tests — this does
  not weaken what's being proven (the *production* code path is still the
  synchronous `setQueryData` write; the `waitFor` only accounts for React's
  own re-render timing, not for the push depending on any additional async
  work).
- **Test file needed `.tsx`, not `.ts`.** The plan's existing test file
  (`useSpotifyGate.test.ts`) had no JSX; testing this phase properly requires
  a `QueryClientProvider` wrapper (see next bullet), which is JSX. Renamed
  via `git mv` to `useSpotifyGate.test.tsx`, matching the convention already
  used by `useDashboardSync.test.tsx`/`useLikedSongsList.test.tsx` for the
  same reason.
- **Reworked the test file to mock at the `detect.ts` seam and drive a real
  `QueryClient`, not to mock `useExtensionConnection` itself.** The task doc
  says "against a mocked connection query," which reads two ways: mock the
  hook's return value, or mock the query's own dependencies and let the real
  query run. Chose the latter (same seam `connection-state.test.ts` mocks:
  `isExtensionInstalled`/`getSpotifyAccountStatus`) because invariant 4 and
  the refetchOnWindowFocus re-expression are both claims about *real*
  TanStack Query behavior (data persistence across a refetch; focus-driven
  refetch gated by `staleTime`) — asserting them against a hand-stubbed
  verdict would prove nothing about the actual selector composed with the
  actual query. Cost: tests need a `QueryClientProvider` wrapper and, for the
  focus test, `@tanstack/react-query`'s exported `focusManager` (imported
  directly rather than dispatching raw DOM events — traced
  `FocusManager`'s default `setup` in `focusManager.js` and confirmed it
  listens for `visibilitychange` on `window`, not `focus`; the *old* deleted
  hook listened to both `focus`/`visibilitychange` directly, so calling
  `focusManager.setFocused(false)`/`setFocused(true)` to force a listener
  notification is more direct than reverse-engineering which raw event the
  library's internal listener actually responds to, and is the pattern
  TanStack Query's own test suite uses).
- **Added a "does not re-check on focus while the query is still fresh"
  test** alongside the "re-checks... once stale" one. Not asked for
  explicitly, but the stale-gated test alone doesn't prove the `staleTime`
  gate is actually doing anything (it could pass even if focus refetched
  unconditionally) — the negative case is the one that would catch a
  regression to `refetchOnWindowFocus: "always"` or `staleTime: 0`.
- **Did not wire `reportSpotifyAuthSuccess` anywhere in this phase.** Task
  04's spec only maps `reportGateFailure`'s two failure kinds to pushes; it
  never mentions a success push, and per CLAUDE.md ("build only what's
  asked, no speculative features") plus phase 03's own note in this log
  ("those [reportSpotifyAuthSuccess call sites] will wire their own
  genuinely-classified success/failure pushes... — phase 04/05's territory"),
  left it for wherever a phase 04/05 change actually observes a live Spotify
  command succeed with a structured result (e.g. `create-playlist-from-
  draft.ts`'s command outcomes) — no such call site was touched in this
  phase since the spec explicitly says steps 1–2 there stay as-is and no
  other edit was needed.
- **`repairConnection` rejection handling: nothing new to add in this
  phase.** Task 04 doesn't call `repairConnection` from `useSpotifyGate`
  itself — `ReconnectPrompt`/`ExtensionUnavailablePrompt` only take
  `recheck`, and the actual Spotify-login affordance is
  `SpotifyReconnectLink` (untouched, out of scope per the spec's "leave it
  in this task" note). Confirmed no new `repairConnection` call site was
  introduced by this phase, so the `.catch(() => {})` discipline documented
  in `02-repair-action.md`/demonstrated in `ExtensionAccountBanner.tsx` has
  nothing new to apply to here.

### Post-review fix: `useSpotifyGate(null)` silently skipped mismatch detection (findings 1+2, CRITICAL — wrong-account data integrity)

- **The plan's stated rationale for passing `null` was factually wrong, and the
  original phase-04 log entry above ("Passing `linkedSpotifyId: null` collapses
  the verdict space the gate can ever see") repeated that error instead of
  catching it.** Both the task doc (`04-studio-gate.md`: "the gate doesn't do
  identity checks (no linked Spotify account to compare against)") and my own
  first-pass comment in `useSpotifyGate.ts` asserted there was no linked
  Spotify id available to compare against. That's false: `account.spotify_id`
  is already resolved server-side into the `_authenticated` route's context
  (`src/routes/_authenticated/route.tsx`, destructured as `account` and used
  by that very layout for PostHog identify calls) and Dashboard.tsx already
  threads the identical field (`account?.spotify_id ?? null`) into
  `<Dashboard linkedSpotifyId=…>` for its own mismatch banner
  (`src/routes/_authenticated/dashboard.tsx:45`). The studio route
  (`playlists.new.studio.tsx`) simply never read `account` from its own
  `Route.useRouteContext()` and never threaded it down — a wiring gap, not a
  structural limitation. Recorded prominently here per the review's explicit
  request, since this directly contradicts what task 04's spec and my own
  phase-04 log entry claimed.
- **Consequence traced end-to-end before fixing:** with `linkedSpotifyId ===
  null`, `deriveConnectionVerdict` (`verdict.ts:33`) returns `{ kind: "ok" }`
  immediately after the `spotifyConnected`/`authFailedAt` check — before the
  `mismatch`/`unpaired`/`unverifiable` branches ever run. So if the browser
  extension was signed into a Spotify account different from
  `account.spotify_id`, the studio gate reported `ok`, `CreateBar` rendered an
  enabled Create button, `createPlaylistFromDraft` → `createPlaylistAcknowledged`
  → the extension's `CREATE_PLAYLIST` command created the playlist on
  Spotify under whichever account the extension's live token belonged to (not
  `account.spotify_id`), and the follow-up DB acknowledge/rootlist-add rides
  the app session for the *intended* account — landing an orphaned playlist on
  the wrong Spotify account with no DB row, surfaced to the user only as a
  generic error toast (or, worse, indistinguishable from success if
  `createPlaylistAcknowledged`'s ack happened to succeed against a mismatched
  `userId`/playlist owner — not verified further since the fix removes the
  path entirely rather than characterizing every downstream failure mode).
- **Fix: threaded `account.spotify_id`/`account.display_name` through
  `playlists.new.studio.tsx` → `StudioScreen` → `useSpotifyGate(linkedSpotifyId)`
  → `useExtensionConnection(linkedSpotifyId)`**, so `deriveConnectionVerdict`
  now actually reaches its mismatch/unpaired/unverifiable branches for the
  studio the same way it already did for the dashboard. No changes needed to
  `verdict.ts` itself — the derivation was already correct; only the caller
  was short-circuiting it.
- **New `SpotifyGateState` value: `"account-mismatch"`.** Considered reusing
  the existing `"reconnect-required"` state (zero vocabulary growth, and it
  already blocks the CTA) but rejected it: `ReconnectPrompt`'s copy ("Spotify
  is disconnected — reconnect to create your playlist") is factually wrong for
  a mismatch — the extension IS connected, just as the wrong person — and its
  repair affordance (a bare `SpotifyReconnectLink` anchor) can't express "sign
  in as someone else" the way the dashboard banner's mismatch copy does. The
  task brief explicitly allowed a minimal new state for exactly this reason
  ("if you must add a state, keep it minimal and update every consumer").
  Kept `unpaired`/`unverifiable` mapped to `"ok"` (unchanged from before, but
  now genuinely reachable instead of theoretical): per the README, pairing
  (the hearted `apiToken`) only gates extension→backend *sync upload*, never
  the extension→Spotify commands the studio issues, and DB writes ride the
  app session cookie, not the pairing — so neither state can produce the
  wrong-account failure mode this fix closes. `unverifiable` specifically
  stays non-blocking per invariant 6 ("never a hard conflict... nothing a
  click here could silently repair") — a transient profile-read hiccup
  shouldn't scare a user with "wrong account" copy on a linked account that's
  actually fine. Updated every consumer of the type: `useSpotifyGate.ts`
  (`gateStateForVerdict`, new `mismatchProfile` field on the return so
  consumers get the extension's live profile without re-deriving the verdict
  themselves), `CreateBar.tsx` (new `mismatchProfile`/`accountDisplayName`
  props, new branch that blocks the CTA — including a defensive fallback to
  `ReconnectPrompt` if `mismatchProfile` were ever unexpectedly null, so a
  type-system violation can't silently re-enable Create), `StudioScreen.tsx`
  (threads the two new props, adds a header notice mirroring the existing
  extension-unavailable/reconnect-required ones), and a new
  `AccountMismatchPrompt.tsx` (mirrors `ReconnectPrompt`/
  `ExtensionUnavailablePrompt`'s "Check again" structure; primary action calls
  `repairConnection` — the same primitive `ExtensionAccountBanner.tsx` uses for
  the dashboard's mismatch case — with the inline `open.spotify.com` login URL
  `SpotifyReconnectLink` already uses for this surface, not the dashboard
  banner's `accounts.spotify.com` wrapper). `ReconnectPrompt.tsx`/
  `ExtensionUnavailablePrompt.tsx` themselves needed no code changes (neither
  switches on `gateState` internally), only re-verification that `CreateBar`'s
  new branch can't fall through into either of theirs for a mismatch.
- **Tests added** (`useSpotifyGate.test.tsx`'s new "account mismatch (findings
  1+2)" block and `CreateBar.test.tsx`'s new "account-mismatch" cases): a real
  `linkedSpotifyId` that differs from the extension's polled profile resolves
  to `"account-mismatch"` (never `"ok"`) with `mismatchProfile` populated; a
  matching profile still resolves `"ok"`; `unpaired`/`unverifiable` on a linked
  account still resolve `"ok"` (regression guard for the paragraph above); and
  `CreateBar` renders `AccountMismatchPrompt` — never the Create button — for
  `"account-mismatch"`, including the defensive null-profile fallback.

### Post-review fix: vacuous anti-flicker test (finding 3, IMPORTANT)

- **Both "invariant 4" tests in `useSpotifyGate.test.tsx` asserted the
  mid-flight state with a bare, non-`waitFor` `expect` immediately after
  triggering `recheck()` — vacuous, and reproduced exactly as the review
  described.** TanStack Query's `notifyManager` defers a query update's
  observer notification via `setTimeout(…, 0)`
  (`node_modules/@tanstack/query-core/build/modern/notifyManager.js`), so
  calling `recheck()` inside a bare `act(() => {...})` and asserting on the
  very next line only ever reads the PRE-recheck render — React hasn't
  re-rendered with the query's in-flight `isFetching: true` state yet by that
  point, regardless of whether the production selector correctly ignores
  `isFetching` or wrongly derives `"checking"` from it.
- **Verified exactly the way the review did.** Temporarily changed
  `useExtensionConnection.ts`'s `verdict` to `query.isFetching ? { kind:
  "checking" } : deriveConnectionVerdict(...)` — precisely the bug invariant 4
  forbids — and reran `useSpotifyGate.test.tsx` unmodified: 3 of 11 tests
  failed (the three `reportGateFailure` tests, which do use `waitFor`), but
  **both anti-flicker tests still passed**, confirming the review's finding
  exactly. Reverted the injection, rewrote the two tests (below), re-injected
  the same bug, and this time **both rewritten tests failed too** (5/11
  failing total) — confirmed the rewrite actually pins the invariant. Reverted
  the injection again; full file back to green (16/16 after also adding the
  findings-1+2 mismatch tests and the finding-4 recheck-clears-it test).
- **Fix:** switched both tests to fake timers and explicitly
  `await act(async () => { await vi.advanceTimersByTimeAsync(0); })`
  immediately after triggering `recheck()` — BEFORE resolving the pending
  fetch — to flush the deferred notify and force a genuine React re-render
  reflecting the query's in-flight state (`data` still the previous `ok`
  result, `isFetching: true`), then assert. This is the same
  fake-timer-plus-`advanceTimersByTimeAsync` pattern already used by this
  file's `refetchOnWindowFocus` tests, not a new technique. The mid-flight
  assertion is no longer symbolic — it can now fail, and does, on the
  regression it exists to catch.

### Post-review fix: clobberable `reportExtensionUnreachable` push (finding 4, IMPORTANT)

- **`reportExtensionUnreachable` had no sticky-store protection, unlike
  `reportSpotifyAuthFailure` — the exact lost-update race phase 01 eliminated
  for `authFailedAt`, reopened for the extension-unreachable case.** It wrote
  `installed: false, spotifyConnected: false` directly onto the polled
  `['extension','connection']` cache entry via `setQueryData`. A poll fetch
  already in flight when that push landed would resolve afterward with
  "healthy" pre-push data and — because TanStack Query replaces a query's
  cache entry wholesale on fetch commit, it does not merge onto a
  `setQueryData` write made mid-flight — silently clobber the forced
  `extension-unavailable` back to `ok`.
- **Fix, structurally identical to phase 01's `auth-failed-store.ts`:** added
  `unreachable-store.ts`, a module-level sticky store (`unreachableAt: number
  | null`) the polled query's `queryFn` never touches, read via
  `useSyncExternalStore`. `reportExtensionUnreachable` now stamps this store
  unconditionally (in addition to the existing, now-cosmetic `setQueryData`
  merge, kept for the same "instant read for any raw-field consumer" reason
  phase 01 kept the analogous merge for `authFailedAt`) and calls
  `queryClient.invalidateQueries(...)`, mirroring `reportSpotifyAuthFailure`'s
  own addition from the second-round review above — safe for the identical
  reason: the sticky store write is what makes the verdict correct
  synchronously, so the invalidate can only ever refresh cosmetic fields, not
  race away the observation. `useExtensionConnection` now merges
  `unreachableAt` the same way it merges `authFailedAt`: while sticky, it
  forces `installed`/`spotifyConnected` to `false` regardless of what the
  polled cache says. `connection-state.ts`'s `isHealthy`/`refetchInterval`
  also now read `getUnreachableAt()`, so a pushed unreachable observation
  keeps the poll alive exactly like a pushed auth failure does.
- **Verified the regression guard actually catches the bug**, the same way
  finding-4's own fix for `authFailedAt` was verified in phase 01: temporarily
  removed the `setUnreachableAt(Date.now())` call from
  `reportExtensionUnreachable` and reran the connection-layer suite — 4 tests
  failed (`connection-state.test.ts`'s new mid-flight lost-update guard,
  `report-failure.test.ts`'s three new `reportExtensionUnreachable` store
  assertions). Restored the line; all 48 connection-layer tests passed again.
- **Deliberate asymmetry from `authFailedAt`, recorded because it's easy to
  mistake for an inconsistency: `unreachableAt` CAN be cleared by an explicit,
  consumer-triggered `refetch()` call (wired into `useExtensionConnection`'s
  returned `refetch`); `authFailedAt` cannot.** This isn't an oversight —
  `reportExtensionUnreachable` has no `repairConnection` branch of its own
  (verdict `extension-missing` isn't in either of `repair.ts`'s
  `needsSpotifyLogin`/`needsPairing` sets — there's nothing code can do to fix
  a missing extension), so the studio's "Check again" button is the *only*
  available recovery affordance once this fires. Leaving the store
  permanently sticky (mirroring `authFailedAt` verbatim) would mean "Check
  again" stops working forever after the first push, for the rest of the
  page's life — worse than the pre-fix clobbering bug it replaces. Clearing on
  explicit refetch is principled, not just convenient: invariant 7 keeps
  `authFailedAt` sticky against confirming refetches specifically because the
  extension's local `hasToken` check is structurally blind to a Spotify-side
  token rejection (a dead token reads "valid" locally forever, so no refetch
  can ever produce trustworthy counter-evidence); a PING re-check has no
  analogous blind spot — it either answers or it doesn't, so a fresh,
  explicitly-requested PING is exactly as trustworthy as the one that
  originally failed. `refetch()`'s default `cancelRefetch: true` also
  guarantees the clear can't reopen the mid-flight race itself: it always
  starts a brand-new fetch, never reuses one that began before the clear, and
  the race this store exists to prevent is specifically about the *ambient*
  ~6s background poll's in-flight fetch, not an explicit user click. Pinned
  with `useSpotifyGate.test.tsx`'s new "sticky override is cleared by an
  explicit recheck" test.

### Post-review fix: doc drift on studio polling cadence (finding 5, MINOR)

- `04-studio-gate.md` claimed the shared query polls "every ~6s while the
  studio is open." Corrected to say the interval only runs while the
  connection is unhealthy and stops (`refetchInterval: false`) once fully
  healthy, leaning on `refetchOnWindowFocus` + the failure push otherwise —
  matching `connection-state.ts`'s actual `extensionConnectionQueryOptions`
  and the README's own "Always-on polling replaces today's 'stop once
  healthy' optimization" risk note, which this task doc's line had drifted
  from.

### Housekeeping alongside the above

- `vite.config.ts`'s `domTestFiles` still listed
  `useSpotifyGate.test.ts` (the pre-rename filename) after the phase-04
  `git mv` to `.test.tsx` — dead (it excludes a non-existent path from the
  node project; the dom project already picks the renamed file up via its
  `**/*.test.tsx` glob), but removed and replaced with an explanatory comment
  so a future reader doesn't wonder whether the rename was missed here.

## Phase 05

- **`SpotifyReconnectLink`'s activation handler always repairs under a
  hardcoded `{ kind: "spotify-disconnected" }` verdict**, not the caller's
  actual verdict (the component takes no verdict prop). Traced every
  production render site before deciding this was safe: `MatchesSection.tsx`
  only renders it when `reconnectNeeded` is true (now `spotify-disconnected`
  specifically — see below), `ReconnectPrompt.tsx` (studio) is only mounted
  by `CreateBar` for `gateState === "reconnect-required"`, and the liked-songs
  panel (`SongDetailPanelSurface.tsx:1789`) gates it the same way. No call
  site ever renders this anchor for `mismatch`/`unpaired`/`unverifiable` — the
  spec's own file list for those (`AccountMismatchPrompt`, the dashboard
  banner) already has its own `repairConnection` call with the real verdict.
  `repairConnection`'s `spotify-disconnected` branch is exactly "open the
  armed Spotify login + silently re-pair," which is what every current
  consumer needs. Documented the assumption directly in the component's doc
  comment so a future caller adding a new render site for a different verdict
  doesn't inherit a silent mismatch.
- **`addSuggestion` (QueueCardContent.tsx) takes `queryClient` as a new
  parameter and pushes `reportSpotifyAuthFailure`/`reportSpotifyAuthSuccess`
  inline, at the same two `outcomeFromCommandResponse` call sites** (song-mode
  and playlist-mode branches), rather than centralizing the failure push in
  the mutation's existing `onRetryableFailure` callback (which would also
  have worked — it already receives the unified `AddOutcome` regardless of
  which branch produced it). Chose the inline/duplicated-but-symmetric form
  because the task doc explicitly calls out "QueueCardContent has **two**
  `outcomeFromCommandResponse` call sites (:109 and :152), not one — both
  route to the push," which reads as a warning against exactly the
  single-editing-site mistake a reviewer might make; keeping both pushes
  colocated with their outcome check makes "both branches push" verifiable by
  reading either branch in isolation, and the success push needs a per-branch
  home anyway (there's no single "the write succeeded" callback the
  `AddOutcome`-consuming side can hook — `isSuccess` only fires for the
  overall `"added"` status, which a skipped-Spotify-write add-suggestion also
  satisfies; see next bullet). Removed the mutation's old
  `onRetryableFailure` entirely — nothing left for it to do once reconnectNeeded
  stopped being a local flag.
- **`reportSpotifyAuthSuccess` fires only when the Spotify write itself
  returns `outcome.status === "success"`, not whenever `addSuggestion`
  resolves `"added"`.** `addSuggestion` can reach `"added"` two ways: a real
  Spotify write succeeded, or `playlist?.spotifyId`/`currentSong?.spotifyId`
  was missing so the Spotify call was skipped entirely (falls straight to
  `submitMatchDeckAction`). Calling `reportSpotifyAuthSuccess` in the latter
  case would be a false attestation — no live command ran, so nothing evidences
  the token is still good. Same rule applied to `useSongPlaylistSuggestions`'s
  `onAdd`. Mirrors the existing pre-phase-05 asymmetry already in this code:
  an `extension-unavailable` outcome (NETWORK_ERROR) was never classified as
  `error`/`reconnect-required` before this phase either, and still isn't —
  it silently falls through to the DB write, which is pre-existing behavior
  ("Behaviors to preserve": only `reconnect-required` routes to the push) and
  out of scope to fix here.
- **`reconnectNeeded` checks `verdict.kind === "spotify-disconnected"`
  exclusively — not `verdict.kind !== "ok"`** — in both
  `useSongPlaylistSuggestions` and `QueueCardContent`, matching the task doc's
  literal wording ("`reconnectNeeded` for the panel derives from the shared
  verdict (`spotify-disconnected`)"). A `mismatch`/`unpaired`/`unverifiable`
  verdict on these surfaces renders nothing special — no reconnect prompt, no
  block on Add. This is a real, deliberately-left gap (see next bullet), not
  an oversight: building a mismatch-specific UI for liked-songs/matching
  (an `AccountMismatchPrompt`-equivalent per suggestion row, or a whole-panel
  gate) is a bigger change than "swap the push mechanism" and isn't asked for
  by this task's spec or its "Done when" checklist.
- **Passed the real `account.spotify_id` as `linkedSpotifyId` into
  `useSongPlaylistSuggestions` (liked songs) and `QueueCardContent`
  (matching)** — threaded `_authenticated`'s `account` context through
  `liked-songs.tsx`/`LikedSongsPage.tsx` and `match.tsx`/`QueueMatchSession.tsx`,
  the same field Dashboard.tsx and the studio route already thread (per this
  task's "Identity matters" brief and phase 04's CRITICAL wrong-account
  finding for the same `null`-id mistake). Consequence, recorded explicitly
  per the brief: this makes `deriveConnectionVerdict` structurally capable of
  returning `mismatch` for these two surfaces for the first time (previously
  impossible — `null` short-circuited straight to `ok`), but — unlike phase
  04's studio gate — **nothing here blocks the write or shows different UI
  for `mismatch`**; `reconnectNeeded` stays keyed to `spotify-disconnected`
  only (previous bullet), so an add-to-playlist while the extension is
  correctly-but-wrongly signed in still fires with no special warning. This
  is the same class of gap phase 04 closed for the studio's Create button,
  left open here because: (a) the task spec doesn't ask for it, (b) unlike a
  playlist *create* (one write, one obvious moment to gate), add-to-playlist
  here is a per-row action with no single "gate" surface to block, and (c)
  CLAUDE.md's "build only what's asked" — this would be new,
  spec-unrequested surface area. Flagging for whoever owns 06 or a follow-up:
  a wrong-account add-to-playlist write from these two surfaces silently
  succeeds against the extension's live (mismatched) Spotify account with no
  user-visible signal beyond what already existed pre-phase-05.
- **`repairConnection`'s rejection is caught at `SpotifyReconnectLink`'s own
  activation handler** (`.catch(() => {})`), matching the discipline every
  other `repairConnection` call site in this codebase already follows
  (`ExtensionAccountBanner`, `AccountMismatchPrompt`). Nothing to release
  afterward — this component carries no local "repairing" state (unlike the
  banner), so there's no stuck-disabled-button failure mode to guard against;
  the catch exists purely so a rejected `pairExtension()` can't surface as an
  unhandled promise rejection.
- **Did not touch `armReconnectOnActivation`/`shouldArmOnEvent` in
  `reconnect-link.ts`, and did not touch onboarding's `InstallExtensionStep`**,
  which still calls `armReconnectOnActivation` directly (its own bespoke
  arm+`window.open` sequence, no `repairConnection`/silent-pair). Both stay
  exactly as `shouldArmOnEvent` unchanged, `armReconnectOnActivation`
  unchanged) because `InstallExtensionStep` is explicitly out of scope here —
  the README's task table assigns "onboarding reads shared state" to phase 06,
  not 05 — and `shouldArmOnEvent` is still the correct primitive
  `SpotifyReconnectLink`'s new handler reuses (see the component's own
  changes) so it couldn't be deleted even if onboarding weren't deferred.
- **No pairing logic added to the liked-songs/matching add-to-playlist
  paths**, per the README's own scoping note ("a pairing failure cannot occur
  in the playlist/matching flows, so no re-pair logic is added there") — the
  DB writes (`addSongToPlaylist`, `submitMatchDeckAction`) ride the app
  session, never the extension pairing. Only `reportSpotifyAuthFailure`/
  `reportSpotifyAuthSuccess` were wired at these call sites; the recovery
  route stays the shared query's own poll/focus refetch plus whatever
  `repairConnection` a user-facing prompt elsewhere ultimately triggers.
- **Deleted `src/lib/extension/useSpotifyReconnectState.ts` and its test in
  this phase** (not deferred to 06) — the task doc's own "Delete" section
  lists it under task 05 ("here or in 06 once nothing imports it"), and after
  this phase's edits nothing imports it (confirmed by repo-wide grep). Also
  removed the now-dangling `vite.config.ts` `domTestFiles` entry for the
  deleted test file.
- **Test-file consequences of `SpotifyReconnectLink` now reading
  `useQueryClient()`:** two `CreateBar.test.tsx` tests that render it
  transitively (`reconnect-required` gate state, and the defensive
  `account-mismatch` + `mismatchProfile: null` fallback path, which renders
  `ReconnectPrompt`/`SpotifyReconnectLink` too) previously rendered with no
  `QueryClientProvider` in the tree and would now throw
  ("No QueryClient set"). Wrapped both in the file's existing
  `withQueryClient` helper (updated its header comment to name
  `SpotifyReconnectLink` alongside `AccountMismatchPrompt` as a reason a
  provider is required) — verified both fail without the fix, pass with it.
- **`match.test.ts`'s stale `vi.doMock("@/lib/extension/useSpotifyReconnectState", ...)`
  swapped for mocks of `@/lib/extension/connection/useExtensionConnection`
  and `@/lib/extension/connection/report-failure`.** This test only exercises
  `Route.options.beforeLoad`/`loader` (the route's `component` — and therefore
  `QueueCardContent` — is never rendered), so the mock isn't strictly required
  for the test to pass (importing the real modules would have been inert:
  `connection-state.ts`/`report-failure.ts` do nothing at module-eval time,
  only inside functions that are never called here); kept it anyway to match
  the pre-existing convention of mocking every extension-layer module this
  test's import graph transitively touches, and because leaving a mock for a
  deleted module while silently not-mocking its replacement would read as an
  oversight to a future reader diffing this file.
- **New tests added, not required verbatim but requested in spirit** (mirrors
  phase 03/04's "new tests... requested in spirit" precedent): a
  `QueueCardContent.test.tsx` "05 — shared connection verdict..." block
  (reconnectNeeded mirrors the verdict incl. a mismatch-is-NOT-reconnectNeeded
  regression guard; the auth-failure push bails before the deck write; the
  auth-success push still submits the deck decision; a non-auth error neither
  pushes nor submits); a new `src/lib/extension/__tests__/SpotifyReconnectLink.test.tsx`
  (left-click opens Spotify + re-pairs, right-click doesn't arm, a rejecting
  `pairExtension` doesn't throw); a new
  `src/features/liked-songs/hooks/__tests__/useSongPlaylistSuggestions.test.tsx`
  (no test file existed for this hook before this phase, despite the task
  doc's "Update `useSongPlaylistSuggestions` tests" bullet — created one
  covering the same shape: reconnectNeeded mirrors the verdict, linkedSpotifyId
  is threaded to `useExtensionConnection`, the auth-failure push bails before
  `addSongToPlaylist`, the auth-success push still records the decision, and a
  non-auth error does neither).
- **`bun run test`: 388 test files passed / 1 skipped (389), 4236 tests
  passed / 8 skipped / 11 todo (4255). `bun run typecheck` (tsgo --noEmit):
  clean, zero errors. `bun run lint` (biome): clean, zero issues.**

### Post-review fix: mismatch never blocked the write on either surface (CRITICAL, invariant 2 — same phantom-write class as phase 04)

- **Root cause:** the bullet above ("`reconnectNeeded` checks `spotify-disconnected` exclusively... a `mismatch`/`unpaired`/`unverifiable` verdict on these surfaces renders nothing special — no reconnect prompt, no block on Add") and the one after it (threading the real `linkedSpotifyId`) were both accurate about what phase 05 shipped, but their combination is exactly phase 04's CRITICAL finding recurring on two new surfaces: threading a real `linkedSpotifyId` makes `deriveConnectionVerdict` capable of returning `mismatch` for the first time on these two surfaces, and nothing gated the write on it. Traced the reachable path: `onAdd` (liked songs) / `addSuggestion` (matching) call `addToPlaylist` against a playlist id that belongs to `linkedSpotifyId`, using whatever token the extension's live session actually holds — under `mismatch` that's a *different* Spotify account. `extensions/src/shared/spotify-client/mutations.ts:14-36` forwards Spotify's Pathfinder `__typename` without checking it against a known-success value, and `extensions/src/background/command-handler.ts:180-194` wraps any non-throwing executor result as `{ok:true, data}` — so a permission-denied response delivered as HTTP 200 with an error-variant `__typename` reports as SUCCESS to the app, which then calls `reportSpotifyAuthSuccess` (clearing a legitimate sticky failure) and writes a DB row asserting the song/decision was added, while the target playlist on the *linked* account never received it. Even when Spotify does reject at the HTTP layer, the prior code showed no reconnect-shaped affordance for a mismatch on either surface — the row's Add button just sat there — which independently violates invariant 2 ("mismatch outranks unpaired... must surface").
- **This overrides the task doc's literal wording on purpose.** `05-liked-songs-matching.md` only asks for `reconnectNeeded` to mirror `spotify-disconnected` and says nothing about `mismatch`; the previous log entry framed leaving it unblocked as an explicit, spec-compliant scope decision. That framing is wrong once invariant 2 is read as load-bearing rather than aspirational: the README states it as a hard rule ("Mismatch outranks unpaired... a wrong Spotify session is not [repairable]. When both are true, surface the mismatch"), not a task-05-specific suggestion, and phase 04 already established that a `null`-collapsed identity check is a CRITICAL data-integrity bug, not a style preference. A narrower task doc cannot waive a README invariant — the task doc under-specified this, it didn't authorize skipping it.
- **Fix, mirroring `useSpotifyGate`/`AccountMismatchPrompt` (the studio's existing mismatch handling) rather than inventing a second "wrong account" UI:**
  - `useSongPlaylistSuggestions.ts`'s `onAdd` and `QueueCardContent.tsx`'s `addSuggestion` both now check the verdict/an `isAccountMismatched` flag *before* anything else runs and return without calling `addToPlaylist` or the DB write when it's `mismatch` — same "bail before the DB write, row stays actionable" shape the `reconnect-required` path already had. `addSuggestion`'s check sits once, ahead of both the song-mode and playlist-mode branches, so a single check point covers both orientations (unlike the `outcomeFromCommandResponse` push, which the task doc correctly notes needs duplicating at two call sites — the mismatch gate needs no such duplication because it runs before either branch's Spotify call).
  - `PlaylistsPanel` (liked songs) and the matching prop chain (`QueueCardContentProps` → `MatchingProps` → `MatchingSessionCommonProps`/`SongSuggestionsSectionProps` → `MatchesSectionProps`) gained `mismatch`/`mismatchProfile` (the extension's live `ExtensionSpotifyProfile`, non-null only under `mismatch`) and `onRecheck`/`onRecheckConnection` (wraps `useExtensionConnection`'s `refetch`). This is the same `refetch`-wrapping pattern `useSpotifyGate.recheck` already uses, not a new primitive.
  - UI: both `PlaylistsLayer` (liked songs' "Where it fits" section) and `MatchesSection`/`SongSuggestionsSection` (matching's song- and playlist-mode suggestion columns) now render `AccountMismatchPrompt` — the exact component `CreateBar` already swaps in for the studio's `account-mismatch` gate state — in place of the entire suggestion-rows list when mismatched, rather than a per-row swap. Chose "replace the whole list" over "swap each row's Add for something else" because `AccountMismatchPrompt` is a full sentence + two buttons, sized for a section-level slot (mirroring `CreateBar`'s whole-bar swap), not a compact per-row action slot the way `SpotifyReconnectLink` is for `reconnectNeeded`. This also means the write is structurally unreachable from the UI while mismatched (no Add button renders at all) — the hook/component-level `mismatch`/`isAccountMismatched` check is therefore defense-in-depth against a stale render slipping a click through, not the only guard.
  - `accountDisplayName` is passed as `null` to every new `AccountMismatchPrompt` call site on these two surfaces (falls back to its existing "which isn't the account this library was built from" copy) rather than threading `account.display_name` down through `LikedSongsPage`/`QueueMatchSession` the way the studio route does for its own `AccountMismatchPrompt`. Threading it would mean widening `useSongPlaylistSuggestions`'/`QueueCardContent`'s already-large parameter lists for a copy nicety, not a correctness requirement — the component's null-safe fallback exists precisely for callers that don't have the display name handy. Left as a documented follow-up, not a gap in the fix itself.
  - Confirmed `reportSpotifyAuthSuccess` cannot fire on a blocked write: the mismatch check returns before the `addToPlaylist` call and its `outcome.status === "success"` branch even runs, on both surfaces — there is no code path from a blocked write to either push. Pinned by tests (below) asserting neither push fires when mismatched, including a defense-in-depth variant that pre-stubs `addToPlaylist`/`outcomeFromCommandResponse` to return success and confirms the mismatch check still short-circuits before either mock is ever called.
  - `SongSuggestionsSection` (playlist-mode matching) did not previously receive `reconnectNeeded` at all — `MatchingSessionCommonProps` declares it but `MatchingSession.tsx`'s playlist branch never forwarded it to `SongSuggestionsSection`, so playlist-mode `spotify-disconnected` has shown no reconnect affordance since phase 05 landed. That's a separate, pre-existing gap from this finding (not introduced by this fix, and not required to fix it — the `mismatch` gate that blocks the *write* runs inside the shared `addSuggestion` function regardless of orientation, so playlist-mode is still protected against phantom writes even though this specific UI gap is untouched). `mismatchProfile`/`onRecheckConnection` were wired into *both* `MatchesSection` and `SongSuggestionsSection` correctly (unlike the pre-existing `reconnectNeeded` gap) because this fix's brief explicitly requires both surfaces to block and surface mismatch — recorded here so a future reader doesn't mistake the asymmetry (mismatch wired to both branches, reconnectNeeded still only wired to one) for an oversight in this fix; it's inherited from before it.
- **Tests added** (both files' new "post-review fix" / "account mismatch" describe blocks): `useSongPlaylistSuggestions.test.tsx` — a mismatch verdict never calls `addToPlaylist`/`addSongToPlaylist` and neither push fires; the same holds even when `addToPlaylist`/`outcomeFromCommandResponse` are stubbed to report success (defense-in-depth); `mismatch`/`onRecheck` are exposed correctly and `onRecheck` drives the shared `refetch`; `mismatch` is `null` for every other verdict. `QueueCardContent.test.tsx` — the mirror set, plus asserting `mockSubmitMatchDeckAction` (the DB write) is never called. **Verified both regression-guard tests actually catch the bug**: temporarily neutralized both guards (`if (verdict.kind === "mismatch") return` → `if (false) return` in the hook; `if (isAccountMismatched)` → `if (false && isAccountMismatched)` in `addSuggestion`), reran both files — 2 failures each, both on the `not.toHaveBeenCalled()` assertion for `addToPlaylist`/`mockAddToPlaylist` with the actual write args logged (confirming the write really would have gone through). Restored both guards; full suite reconfirmed green.
- **Recorded, not fixed — pre-existing gap, ticket-worthy:** in both `onAdd`/`addSuggestion`, an `extension-unavailable` (`NETWORK_ERROR`) outcome matches none of the `reconnect-required`/`error`/`success` branches and falls straight through to the DB write (`addSongToPlaylist`/`submitMatchDeckAction`), marking the row "added" even though the Spotify call never happened — the same phantom-success shape as this finding, just triggered by the extension being unreachable instead of a wrong account. Confirmed pre-existing (predates phase 05 entirely — `outcomeFromCommandResponse` has returned `{status: "extension-unavailable"}` since before this plan, and neither call site has ever checked for it) and out of this fix's scope (the brief for this pass was specifically the mismatch CRITICAL finding). Not fixed here per instruction; flagging explicitly so it gets its own ticket rather than being rediscovered as a surprise later.
- **`bun run test` (full suite, after this fix): 388 test files passed / 1 skipped (389), 4244 tests passed / 8 skipped / 11 todo (4263) — +8 over the prior phase-05 count, exactly the 8 new tests added above. `bun run typecheck` (tsgo --noEmit): clean, zero errors. `bun run lint` (biome): clean, zero issues.**

### Post-review: UI-level mismatch guard was untested (test-coverage gap)

- **Root cause:** the fix above's own text calls the UI-level swap "defense-in-depth against a stale render slipping a click through" alongside the hook-level guard, but only the hook-level guard (`useSongPlaylistSuggestions.test.tsx`, `QueueCardContent.test.tsx`) had tests. Neither `MatchesSection.test.tsx` nor `SongSuggestionsSection.test.tsx` mentioned "mismatch" at all, and no test existed for `SongDetailPanelSurface`'s `PlaylistsLayer` branch — a future edit to any of the three `mismatchProfile`/`playlists.mismatch` ternaries could silently regress the UI half with nothing failing.
- **Tests added**, one new "account mismatch guard (invariant 2)" describe block per surface, each asserting both directions (`AccountMismatchPrompt` renders + no Add affordance when mismatched; normal rows render + no prompt when not): `MatchesSection.test.tsx`, `SongSuggestionsSection.test.tsx` (both now wrap renders in a `QueryClientProvider` — `AccountMismatchPrompt` calls `useQueryClient()`), and a new `SongDetailPanelSurface.playlists-mismatch.test.tsx` (topic-suffixed, following `SongDetailPanelSurface.unread-state.test.tsx`'s convention) covering `PlaylistsLayer`. Note: `PlaylistRow`'s Add button's accessible name is `"Add to {playlist name}"` (aria-label), not `"Add"` — the new SongDetailPanelSurface test matches `/^Add to/` rather than the exact "Add" name `MatchesSection`/`SongSuggestionsSection`'s rows use.
- **Verified non-vacuous:** temporarily replaced `MatchesSection.tsx`'s `{mismatchProfile ? (` with `{false ? (`, reran `MatchesSection.test.tsx` — the new "renders AccountMismatchPrompt..." test failed (`getByRole("status")` found nothing), all other tests still passed. Restored the original ternary; confirmed the diff against the file's pre-existing (uncommitted) phase-05 state showed no residual change.
- **`bun run test` (full suite, after adding coverage): 389 test files passed / 1 skipped (390), 4250 tests passed / 8 skipped / 11 todo (4269) — +6 over the prior phase-05 count (6 new tests: 2 per surface × 3 surfaces). `bun run typecheck` (tsgo --noEmit): clean, zero errors.**

## Phase 06

- **`src/lib/extension/useExtensionAccountConflict.ts` deleted, along with its
  test.** Repo-wide grep (`src/`, `extensions/`) confirmed zero importers
  before deletion — the only remaining hits were a doc-comment in
  `verdict.ts` ("ordering carried over from useExtensionAccountConflict.ts")
  and the hook's own file/test, both expected. Diffed the deleted test's
  scenarios against the new suite case-by-case before deleting, per the task
  doc's instruction, rather than assuming parity:
  - "does not require an account check before Spotify is linked" → `verdict.test.ts`'s
    "short-circuits to ok pre-link, before the identity checks".
  - "fails closed while the first identity check is pending" (checking) →
    "reports checking while the query hasn't settled".
  - "verifies matching Spotify and hearted identities" (verified) → "reports
    ok when everything checks out".
  - "flags a Spotify mismatch..." / "keeps mismatch higher priority than an
    unpaired state" → "reports mismatch when the captured profile differs..."
    / "keeps mismatch outranking unpaired when both are true".
  - "flags unpaired when paired is explicitly false" → "reports unpaired for
    an explicit popup-side disconnect".
  - it.each unavailable-for-3-reasons: "a missing Spotify profile" and "an
    extension without pairing status" (`profile: null` / `paired: null`) →
    `verdict.test.ts`'s "reports unverifiable, never unpaired, when %s"
    it.each. The third case, "an unreachable extension status" (PING
    answered but `getSpotifyAccountStatus()` returned `null`), isn't a
    `deriveConnectionVerdict` case at all in the new architecture — it's
    handled one layer down, at the fetcher, by
    `connection-state.ts`'s `INSTALLED_BUT_UNANSWERING` shape (invariant 6),
    and is covered by `connection-state.test.ts`'s "reports installed: true
    when PING answers but SPOTIFY_STATUS doesn't" test. Confirmed the new
    behavior is a deliberate, invariant-6-mandated improvement over the old
    one: the old hook mapped this case to `unavailable` (same bucket as "not
    installed"), which the phase-01 revision log calls out as exactly the bug
    invariant 6 exists to prevent ("would have shown 'Install extension' to
    existing users"). Not a gap to port — the old behavior was the thing
    being fixed.
  - "reports unavailable when the extension isn't installed" → "reports
    extension-missing when PING never answered".
  - "clears a conflict once the accounts agree on the next poll" — this
    exercised the old hook's own `setInterval` re-poll, not a derivation
    rule; `deriveConnectionVerdict` is a pure function (recomputes from
    scratch on every call by construction, nothing to "clear"), and the
    re-poll mechanics it depended on live in `connection-state.test.ts`'s
    lifecycle tests (subscribe/interval/unsubscribe) instead. No gap to port.
  - No gaps found; nothing ported. Removed the file's `vite.config.ts`
    `domTestFiles` entry alongside the test file (dangling otherwise).
- **`useSpotifyReconnectState.ts` — already deleted in phase 05**, per that
  phase's own log entry ("deleted... in this phase, not deferred to 06").
  Confirmed by grep: only comment references remain (`useSongPlaylistSuggestions.ts`'s
  doc comment, two test files' descriptive comments), no import anywhere.
  Nothing left for this phase to do here.
- **`useDashboardSync.ts`'s "dead exports" (`reconnectSpotify` internals,
  removed state kinds) and orphaned `ExtensionAccountCheck` types — already
  fully cleaned up in phase 03.** Read the current file end-to-end:
  `reconnectSpotify`/`expectLoginReturn`/`buildArmedSpotifyUrl` don't exist
  anywhere in it (phase 03's log already records replacing that bespoke
  sequence with `repairConnection`), and `ExtensionAccountCheck`/
  `ExtensionAccountConflict` (the types deleted above) were never imported by
  this file — it always used its own `DashboardSyncUiState`/`ControlPhase`
  vocabulary. Grepped repo-wide for `reconnectSpotify` post-deletion: zero
  hits. Nothing to delete here; the task doc's bullet describes work phase 03
  already did, not a gap phase 06 needed to close.
- **Stories/fixtures (`src/stories/fixtures/index.ts`, banner/control
  stories) — already current, no removed states referenced.** Read all
  three files named in the task doc
  (`ExtensionAccountBanner.stories.tsx`, `DashboardSyncControl.stories.tsx`,
  `fixtures/index.ts`): every story exercises a verdict/state kind that
  still exists (`mismatch`/`unpaired`/`spotify-disconnected`/`unverifiable`
  for the banner; `checking`/`install-required`/`spotify-reconnect-required`/
  `paused`/`ready`/etc. for the control), and `simulateDashboard` already
  supplies `linkedSpotifyId`/`accountDisplayName` per phase 03's fixture
  update. No edits needed.
- **Sweep discrepancy, not a bug: `06-cleanup.md`'s literal sweep instruction
  ("`rg 'spotify-reconnect-required|account-unavailable|account-conflict' src/`
  — zero hits") does not hold for `spotify-reconnect-required` — and should
  not.** That state kind is alive and load-bearing in `DashboardSyncUiState`
  (`useDashboardSync.ts`) and its stories/tests: phase 03 deliberately kept
  it as the pre-link sync control's own reconnect CTA (see this doc's Phase
  03 section, "the pre-link `spotify-reconnect-required` CTA... kept in the
  sync control per spec", and the README's revision log, "Pre-link
  (`linkedSpotifyId === null`) banner suppression, and the resulting
  narrowing of 'the banner is the only reconnect home' to linked accounts").
  The cleanup doc's sweep line reads as leftover from an earlier draft of the
  plan, written before phase 03 finalized that design decision. Verified the
  other two terms in the same sweep (`account-unavailable`, `account-conflict`
  as literal string values) genuinely return zero hits — only
  `spotify-reconnect-required` is a real, current, intentional identifier.
  Recorded here rather than silently "fixing" it by renaming a correct,
  tested, in-use state kind to satisfy a stale grep in a planning doc.
- **Onboarding `InstallExtensionStep.tsx` migrated to
  `useExtensionConnection(null)`**, replacing its private
  `isExtensionInstalled`/`getSpotifyConnectionStatus` polling effect (2s/3s
  intervals) with `verdict.kind !== "checking" && verdict.kind !==
  "extension-missing"` (→ `isExtensionDetected`) and `verdict.kind === "ok"`
  (→ `isSpotifyConnected`) — the same `extensionInstalled` derivation
  `useDashboardSync.ts` already uses, reused verbatim rather than
  reinvented. `handleAccept` (pairExtension + resetSyncJobs +
  triggerExtensionSync + goToStep) is untouched, per the task doc's explicit
  "UX unchanged... this is read-path unification only."
  - **`null` is deliberately correct here, not the phase-04 mistake
    repeated.** The brief flagged this explicitly: phase 04 passed `null`
    where a real `account.spotify_id` was available and unused (a CRITICAL
    wrong-account bug), so this had to be checked, not assumed. Traced it:
    `createAccountForBetterAuthUser`'s doc comment
    (`src/lib/domains/library/accounts/queries.ts:151-154`) states
    "`spotify_id` is null until first extension sync" — and
    `InstallExtensionStep` is the screen that *triggers* that first sync
    (`handleAccept` → `triggerExtensionSync`). Unlike the studio/dashboard/
    liked-songs/matching surfaces (which all read an already-linked
    `account.spotify_id` out of route context), there is no real linked id
    in existence yet at this point in the flow — `null` isn't a shortcut
    that skips a check, it's the only value that could ever be true here.
    This also matches why `deriveConnectionVerdict` never needs to reach
    mismatch/unpaired/unverifiable for this consumer: those branches require
    a linked id to compare against, and pre-link there is nothing to compare.
  - **Deviation (original first pass, later fixed — see "Post-review fix:
    unbounded poll on a device that can never onboard here" at the end of
    this section): the shared query polled even when
    `!capability.canOnboardHere`, which the old bespoke effect explicitly
    avoided** (`"No point pinging from a device that can't finish the sync
    here — it renders the handoff instead of the install flow"`). At the
    time this was accepted as a minor, low-risk behavior change on the
    reasoning that `isExtensionInstalled()`/`getSpotifyAccountStatus()` are
    cheap `postMessage` round-trips that no-op quickly when nothing answers.
    That reasoning missed that `canOnboardHere` is a media-query capability,
    not a transient "hasn't answered yet" state — on a real handheld it is
    permanently false, so the verdict this hook derives sits at
    `extension-missing` forever, and `connection-state.ts`'s
    `refetchInterval` treats that as permanently unhealthy: not a brief poll
    but an **indefinite** 6s-interval ping for the entire time a phone sits
    on the handoff screen, on battery. Re-flagged by review and fixed below.
  - **Test file updated to mock at the connection-state seam**
    (`isExtensionInstalled`/`getSpotifyAccountStatus` from `@/lib/extension/detect`,
    same seam `connection-state.test.ts`/`useSpotifyGate.test.tsx` mock)
    instead of the deleted `getSpotifyConnectionStatus`, and wrapped both
    `render()` calls in a local `QueryClientProvider` (component now calls
    `useQuery` transitively). The "renders the finish-on-a-computer
    handoff..." test's `expect(mockIsExtensionInstalled).not.toHaveBeenCalled()`
    assertion was removed in this first pass (it asserted the exact thing the
    deviation above changed) and later **restored** once the post-review fix
    below made it true again.
- **Settings `ExtensionStatusRow.tsx` migrated to `useExtensionConnection(null)`.**
  Copy/markup untouched, per the task doc. Mapping: `checking` →
  `"checking"`, `extension-missing` → `"not-found"`, everything else
  (`spotify-disconnected`/`ok` — the only two other verdicts reachable
  pre-link) → `"connected"`, matching the task doc's literal three-way split
  ("checking → ..., extension-missing → ..., everything else → connected").
  This row only ever reported install status, never Spotify-auth status, so
  collapsing `spotify-disconnected` into "connected" here is not a
  regression — it's the same thing the old `isExtensionInstalled()`-only
  check always reported. `null` for the same reason as `InstallExtensionStep`:
  this row has no identity to check, only install presence, so there's
  nothing a linked id would add.
  - **No test existed for this component before this phase** (grepped for
    "ExtensionStatusRow" under `*.test.ts(x)`: zero hits). Added
    `src/features/settings/components/__tests__/ExtensionStatusRow.test.tsx`
    covering the three-way copy mapping plus, most importantly, a **"stays
    fresh" regression test** that is the actual point of this migration
    (the README literally names this component "the sixth detection path"
    for going stale for the life of the page): renders with the extension
    not detected, lets it settle, then — without unmounting or
    re-rendering from the test — flips the mocks to "installed" and
    advances the shared query's fake-timer poll interval (6s, per
    `connection-state.ts`'s `UNHEALTHY_REFETCH_INTERVAL_MS`) and asserts the
    row flips to "connected" on its own. **Verified non-vacuous the same way
    prior phases verify their regression guards**: temporarily hardcoded
    `extensionConnectionQueryOptions()`'s `refetchInterval` to `() => false`
    (simulating "never re-checks"), reran just this test file — the "stays
    fresh" test failed (stuck on "not detected"), the other three still
    passed. Reverted; full file green again (4/4). This is a from-scratch
    test file, not a modified existing expectation.
  - **`SettingsPage.test.tsx` broke as a side effect and needed a mock
    added, not a test-expectation change.** That file blanket-mocks
    `@tanstack/react-query` down to a bare `{ useQueryClient: () => ... }`
    stub (it's testing the Account section's identity display, unrelated to
    extensions), and `ExtensionStatusRow` — rendered inside `SettingsPage` —
    now transitively calls `useQuery` via `useExtensionConnection`, which
    doesn't exist on that stub: `Error: [vitest] No "useQuery" export is
    defined on the "@tanstack/react-query" mock`, reproduced first, then
    fixed. Fix: mocked `@/lib/extension/connection/useExtensionConnection`
    directly to a static `{ kind: "checking" }` verdict, rather than
    building out a real `QueryClientProvider` in a suite that has nothing to
    do with extension status. This is a mechanical fixture fix for a
    consumer this phase's migration newly touches, not a behavior-spec
    change — none of `SettingsPage.test.tsx`'s six assertions changed.
- **Final sweeps, all clean:**
  - `useExtensionAccountConflict|useSpotifyReconnectState`: zero import
    hits (comment-only references in `verdict.ts`, `useSongPlaylistSuggestions.ts`,
    and two test-file comments naming the old hook for context).
  - `"account-unavailable"|"account-conflict"` (literal strings): zero hits.
    (`spotify-reconnect-required` deliberately excluded from this claim —
    see the dedicated bullet above.)
  - `getSpotifyConnectionStatus|isExtensionInstalled`: remaining non-test
    hits are exactly `connection-state.ts` (the fetcher),
    `create-playlist-from-draft.ts` (kept by design, task 04's preflight),
    `detect.ts` (the definitions), and the two documented false positives
    (`ExtensionSetupTrail.tsx`, `IconComparison.stories.tsx` — prop name,
    not import) *plus one new false positive of the same shape*:
    `InstallExtensionStep.tsx` now also passes `isExtensionInstalled=
    {isExtensionDetected}` as an `ExtensionSetupTrail` prop — same pattern,
    not a leftover import.
  - `getSpotifyAccountStatus`: only `connection-state.ts` and `detect.ts`
    outside test files.
  - `spotify-reconnect-required|account-unavailable|account-conflict`: see
    the dedicated bullet above for why this one doesn't fully clear.
- **`bun run test`: 389 test files passed / 1 skipped (390), 4243 tests
  passed / 8 skipped / 11 todo (4262) — net −7 vs. the phase-05 end count
  (4250/4269): −11 from deleting `useExtensionAccountConflict.test.ts`, +4
  from the new `ExtensionStatusRow.test.tsx`. `bun run typecheck` (tsgo
  --noEmit): clean, zero errors. `bun run lint` (biome): clean, zero
  issues, 1188 files checked.**
- **Did not perform the manual verification script** (06-cleanup.md's
  "Manual verification script (with the real extension)") — no real
  extension/browser available in this environment; scoped to the automated
  acceptance criteria (tests, typecheck, dead-code sweeps) the task was
  actually run against. Flagging explicitly rather than silently skipping
  it, per the "anything from the plan you deliberately did NOT do" report
  requirement.

### Post-review fix: unbounded poll on a device that can never onboard here (IMPORTANT)

- **Root cause:** `InstallExtensionStep`'s first pass called
  `useExtensionConnection(null)` unconditionally, above the
  `if (!capability.canOnboardHere) return <OnboardingHandoff />` early
  return, because rules-of-hooks forbids calling a hook after an early
  return and the shared foundation (`extensionConnectionQueryOptions` /
  `useExtensionConnection`) has no per-consumer `enabled` flag. On a real
  handheld (`useOnboardingCapability`'s `HANDHELD_QUERY`:
  `(max-width: 767px) and (pointer: coarse) and (hover: none)`), the
  extension can structurally never answer — the verdict is permanently
  `extension-missing`, which `connection-state.ts`'s `refetchInterval`
  treats as permanently unhealthy, so the shared query pinged the extension
  every 6s **indefinitely** for the entire time the phone sat on the
  "finish on a computer" handoff screen. This is a direct regression versus
  the pre-migration bespoke effect, which made zero calls on that screen for
  exactly this reason (see its own comment, quoted above).
- **Route chosen: (b), restructure so the capability check happens before
  the connection-consuming body ever mounts — not (a), widen the foundation
  with an `enabled` flag.** `InstallExtensionStep` was split into two
  components in the same file: the exported `InstallExtensionStep` now only
  calls `useOnboardingCapability()`, returns `<OnboardingHandoff />`
  immediately when `!canOnboardHere`, and otherwise renders a new,
  unexported `InstallExtensionStepBody` — which is where
  `useExtensionConnection(null)` and every other hook the step needs now
  live. On a handheld, `InstallExtensionStepBody` (and therefore the
  `useQuery` subscription inside it) is never mounted, so there is no
  observer for `refetchInterval` to ever schedule against — no widening of
  the shared foundation was needed, and no other consumer's cache semantics
  are touched. Chose (b) over (a) because: the capability check was already
  structurally an early return one line above the hook call (a `!==
  false` media-query result, not a value that changes mid-flight the way an
  in-flight fetch would), so lifting it above the hook was a same-file,
  mechanical split with zero risk to `useExtensionConnection`'s other five
  call sites (dashboard, studio gate, liked songs/matching, settings); (a)
  would have added an `enabled`-style parameter to a foundation the plan
  explicitly calls "stable" and used by every other surface in this
  migration, for a need only one consumer (a screen with no connection UI
  to render in the first place) has, and would have required auditing that
  a disabled observer can't evict/clobber the shared `['extension',
  'connection']` cache entry other subscribed surfaces still read.
- **Proof of no polling on a handoff device:** two tests in
  `InstallExtensionStep.test.tsx`. First, "renders the finish-on-a-computer
  handoff..." now (again) asserts `mockIsExtensionInstalled` was never
  called, right after mounting with `canOnboardHere: false`. Second, a new
  test, "never polls the extension on a device that can't onboard here,
  even across multiple poll intervals," mounts the same way under
  `vi.useFakeTimers()` and advances 30s — five times past
  `connection-state.ts`'s 6s `UNHEALTHY_REFETCH_INTERVAL_MS` — then asserts
  both `mockIsExtensionInstalled` and `mockGetSpotifyAccountStatus` are
  still never called. This is the stronger of the two guards: the first
  test would still pass if the hook fired once on mount and merely hadn't
  resolved yet; the second proves no interval-driven fetch happens either,
  which is the actual unbounded-poll failure mode the finding described.
- **Normal (desktop) onboarding path confirmed unaffected:** the existing
  "renders a stable login href..." test (unchanged, `canOnboardHere: true`
  via the `beforeEach` default) still exercises the full body —
  `useExtensionConnection` mounts, `mockIsExtensionInstalled`/
  `mockGetSpotifyAccountStatus` resolve, and state 2 ("log in to Spotify")
  renders — proving the split didn't change behavior for the device class
  the step is actually built for.
- **No other consumer affected — confirmed by construction, not just by
  inspection.** The fix touches only `InstallExtensionStep.tsx` (a
  same-file component split) and its own test file; `connection-state.ts`,
  `useExtensionConnection.ts`, and every other call site
  (`useDashboardSync.ts`, `useSpotifyGate.ts`, the liked-songs/matching
  surfaces, `ExtensionStatusRow.tsx`) are byte-for-byte unchanged, so there
  is no shared-cache eviction/clobber risk to audit for route (a) that route
  (b) could have introduced — route (b) has no interaction with the shared
  cache at all beyond simply not creating an observer.
- **Explicitly not touched, per the review's scope note:** the settings
  row's remaining stale-window behavior when the extension is uninstalled
  while the page sits focused (the shared query stops polling once healthy
  and leans on `refetchOnWindowFocus`). That is a separate, already-
  documented trade-off in the README's Risks section, not this finding.
- **Test consequence:** `bun run test` — 389 files passed / 1 skipped (390),
  4244 tests passed / 8 skipped / 11 todo (4263), net +1 versus the
  pre-fix Phase 06 end count (4243/8/11 → 4262 total) — the one new
  fake-timer regression test; the restored `not.toHaveBeenCalled()`
  assertion lives inside an existing test, not a new one. `bun run
  typecheck` (tsgo --noEmit): clean, zero errors.

## Post-run follow-ups (2026-07-27)

Three of the run's disclosed leftovers closed in a follow-up pass; the rest
remain open (last bullet).

- **Phantom-success on `extension-unavailable` — fixed on both surfaces.**
  `useSongPlaylistSuggestions.onAdd` and `QueueCardContent.addSuggestion`
  (both orientation branches; `AddOutcome` gained an `"extension-unavailable"`
  status) now bail before the DB write when `outcomeFromCommandResponse`
  returns `extension-unavailable`, exactly like the `error` branch — the row
  stays actionable instead of being falsely recorded as added. Deliberately
  **no `reportExtensionUnreachable` push**: `NETWORK_ERROR` has two producers
  with opposite meanings (`spotify-client.ts:72` synthesizes it when the
  extension never answers; the extension's `command-handler.ts` emits it when
  the extension is fine but its own fetch to Spotify failed), so the signal
  can't be classified — same "a missing push is far less harmful than a false
  sticky one" rule phase 03 applied to `failSync`. Both regression guards
  verified non-vacuous (the matching one caught a genuinely missing song-mode
  guard on first run; the liked-songs one was bug-injected and failed as
  required).
- **`retryUnsynced` mismatch bypass — closed.** `StudioScreen` now blocks the
  created-unsynced Retry while `gateState === "account-mismatch"`: a
  `retryUnsyncedBlocked`/`retryBlocked` prop threaded through
  `PublishResultRegion` → `UnsyncedState` disables the button (the studio
  header's existing mismatch notice explains why), with a handler-level guard
  as defense-in-depth. `usePublishPlaylist` itself is untouched — it has no
  view of the gate, and the only production caller is the screen that does.
- **Playlist-mode `reconnectNeeded` gap — closed.** `SongSuggestionsSectionProps`
  gained `reconnectNeeded`; `SongSuggestionRowItem` swaps Add for
  `SpotifyReconnectLink` exactly like `MatchRow` does in song mode, and
  `MatchingSession`'s playlist branch now forwards the prop it already had in
  scope.
- **Still open, unchanged:** the extension-side HTTP-200 false-success
  (`mutations.ts` forwards Pathfinder `__typename` unchecked — the root
  enabler, needs its own extension fix), the "Switch Spotify account" logout
  URL decision, `accountDisplayName` threading into the liked-songs/matching
  mismatch prompts, the Settings row stale-window trade-off, auto-clearing
  `authFailedAt` (needs an extension bump), and the manual verification
  script (needs a real browser + extension).
