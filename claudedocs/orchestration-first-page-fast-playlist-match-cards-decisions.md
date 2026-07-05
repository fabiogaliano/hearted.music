# Orchestration decisions — first-page-fast-playlist-match-cards

Run started 2026-07-02. Baseline commit: 76a323c1

## Task B (step 6 guardrail)

- Always pass `global: { fetch: adminFetch }` to `createClient` (never a conditionally-omitted `global` option): a conditional spread (`...(cond ? { global: {...} } : {})`) changes the shape TypeScript infers for `createClient`'s options object, which widened `AdminSupabaseClient`'s generics and broke `.eq()`/`.single()` type inference across ~15 unrelated files (confirmed by diffing typecheck output against a stash of this change). Keeping the options object shape identical in every environment — with `adminFetch` resolving to the guard in dev/test and to the bare global `fetch` reference otherwise — reproduces the exact prior runtime behavior in prod while keeping the type stable.
- `adminFetch` is built via `as typeof fetch` cast: the guard function's signature is call-compatible with `fetch` but structurally missing the ambient static `fetch.preconnect` property that `typeof fetch` requires under the project's TS lib target. The cast only suppresses that irrelevant static-property check; call-site behavior is unaffected.

## Task A (steps 1+2)

- Could not run the literal `supabase db reset` command: the repo's global `~/.claude/hooks/block-git-commands.sh` PreToolUse hook hard-blocks any Bash command matching `supabase db reset` (message: "Use the terminal directly for this operation"), with no per-project or per-task override. Verified via `supabase migration list --local` that every migration up to and including `20260702120000` was already applied to the running local DB and only the new `20260703000000` was pending, then applied it non-destructively with `supabase migration up --local` (applies pending migrations without wiping data — functionally equivalent for validating that the new migration's SQL applies cleanly, but does not re-verify a full from-scratch replay of every historical migration). Confirmed the resulting function via `docker exec supabase_db_v1_hearted psql ... \df+ read_match_review_item_song_suggestions`: exactly one overload exists, with the new keyset args and REVOKE/GRANT applied to that signature only. `bun run gen:types` + `bunx biome format --write` ran normally afterward. If a full clean-slate `db reset` replay needs verifying, that has to be run by a human directly in a terminal.
- `fromSupabaseRpc`'s row-schema parameter is typed `S extends z.ZodType` (not `z.ZodArray<...>`) so the helper stays reusable for a future single-row RPC wrapper; the one caller (`readQueueItemSongSuggestions`) passes a `z.array(z.looseObject({...}))` schema, matching the plan's "z.looseObject row-array schema" guidance.
- Migration uses `CREATE OR REPLACE FUNCTION` for the new signature (after the `DROP FUNCTION IF EXISTS` on the old one) to mirror the exact style of the reference migration (`20260702120000`), even though a plain `CREATE FUNCTION` would behave identically here since the old signature was just dropped.


## Task C (step 3)

- `PLAYLIST_CARD_FIRST_PAGE_SIZE`/`PLAYLIST_CARD_TAIL_PAGE_SIZE` are not exported (the plan doesn't ask for it, and the client seam that would consume them is step 4, not this task). The test file mirrors both values as local, uncommented-as-imported constants with a comment pointing back at the private source constants, matching the existing convention in this test file of hardcoding literal page/cap sizes (e.g. the 100/250 cap test) rather than importing internal numbers.
- `nextCursor` on the first page requires `rows.length === PLAYLIST_CARD_FIRST_PAGE_SIZE && rows.length < suggestionTotal` (both, per the plan) rather than just the length check alone: a card whose *capped* total is itself ≤ 8 (e.g. `suggestionTotal = 8` exactly) returns a full 8-row first page with nothing left to page in — the second half of the AND stops that case from emitting a cursor that would fetch an all-empty tail page forever after the first fetch.
- `listMatchReviewItemSuggestions`'s ownership-miss and non-playlist branches are collapsed into one `!item || item.subject.orientation !== "playlist"` check returning the same empty page — the plan lists them as two bullet outcomes but specifies an identical response shape for both, and mirroring `getMatchReviewItem`'s existing "don't leak which failure mode" posture means the foreign-item and wrong-orientation cases should be indistinguishable to the caller anyway.
- Kept `mapSuggestionRow`'s audio-features/analysis-null behavior and the `artists[0] ?? "Unknown Artist"` fallback byte-for-byte identical to the code it was extracted from — no drift between the first-page and tail-page render paths was an explicit design decision in the plan ("share with the new list fn"), so the extraction is a pure mechanical move, not a rewrite.
- Re-ran `bun run test` against a live local `supabase start` (not `db reset`, blocked by the repo's hook per Task A's note) after landing the changes, since the first full-suite run without a running local DB showed 17 integration-test files failing on `ECONNREFUSED 127.0.0.1:54322` — confirmed those failures are pre-existing local-environment state, not caused by this task's diff (none of the failing files touch `match-review-queue`), then got a fully green 3461-passed run once the DB was up.

## Task D (step 4)

• `dismissSuggestionMutation`'s mutation variables are the bare `suggestionId:
  string` (not `{ suggestionId }`) — the plan doesn't specify a shape and a
  bare string keeps `mutateAsync(suggestionId)` in `useMatchReviewCard`
  symmetric with `dismissSuggestion(suggestionId)`'s own signature.
  **[SUPERSEDED by `d1ba3c0d` — see Post-run fixes below. Variables are now
  `{ itemId, suggestionId }` so a dismiss targets the card it was enqueued for
  even after the user navigates away.]**
• `useMatchReviewCard`'s `currentReviewItem` mapping is left unmemoized
  (plain IIFE), mirroring the exact cost profile of the inline code it
  replaced in `match.tsx` (only `currentSuggestions` was `useMemo`'d there);
  no new memoization was introduced beyond what already existed.
• `SongSuggestionsSection.tsx` destructures only `suggestionTotal` out of the
  six new optional props (the rest — `hasMoreSuggestions`,
  `isLoadingMoreSuggestions`, `loadMoreSuggestions`, `loadMoreError`,
  `retryLoadMore`) are accepted-and-ignored per the plan's step 5 note, since
  `suggestionTotal` is the only one with a step-4 consumer
  (`SuggestionsControls`'s pluralization). Not destructuring the other five
  is itself the "accept and ignore" — no dead local bindings needed a WHY
  comment beyond the one already added above the destructure.
• `mutations.test.ts` and `useMatchReviewCard.test.tsx` call
  `dismissSuggestionMutation`'s `onMutate`/`onSuccess`/`onError` directly
  with a real `MutationFunctionContext` fake (`{ client, meta: undefined }`)
  rather than driving a live `useMutation` — v5's mutation callbacks all take
  a trailing `MutationFunctionContext` argument this mutation never reads;
  a minimal well-typed fake was simpler than mocking through `useMutation`'s
  full lifecycle for pure onMutate/onSuccess/onError assertions.
• Full `bun run test` (3476 passed, 1 pre-existing unrelated skip in
  `extensions/src/__tests__/live-contract.test.ts`, a network-gated live-API
  contract suite) and `bun run typecheck` are both green against a running
  local Supabase (already up from Task C's verification run) — no DB schema
  changes in this step, so no reset/migration was needed.

## Task E (step 5)

- `SongSuggestionsSection`'s sentinel `hasMore` fed to `useInfiniteScroll` is
  `(hasMoreSuggestions ?? false) && !loadMoreError`, not `hasMoreSuggestions`
  alone — on a load-more error the IntersectionObserver would otherwise keep
  re-firing `loadMoreSuggestions` (the sentinel is still in view) and spam
  retries silently; gating it forces the visible "Retry" click to be the only
  way to resume, matching the plan's "renders a retry action... rather than
  pretending pagination is complete."
- The retry footer and the loading sentinel are mutually exclusive branches on
  the same `suggestionsFooter` node (`loadMoreError ? retry : hasMoreSuggestions
  ? sentinel : null`) rather than composed/stacked — the plan describes them as
  alternate footer states, not simultaneous ones, and `ReviewListScroll` takes
  a single `footer` slot.
- No new `ReviewListScroll.test.tsx` was added — the plan's "Test changes"
  section only lists `SongSuggestionsSection.test.tsx` for step 5, and the
  footer slot is fully exercised indirectly through that file's new sentinel/
  retry/empty-state tests.
- `SongSuggestionsSection.test.tsx` needed a local `IntersectionObserver` stub
  (jsdom has none) since `useInfiniteScroll`'s effect now runs whenever
  `hasMoreSuggestions` is true; mirrors the fuller fake in
  `src/lib/hooks/__tests__/useInfiniteScroll.test.tsx` but trimmed to a
  render-only stub since these tests assert on output, not observer callbacks.
- Used a raw apostrophe (`Couldn't load more suggestions.`) in JSX text rather
  than `&apos;`, matching the existing convention elsewhere in the codebase
  (e.g. `CheckInboxPanel.tsx`, `DashboardSyncControl.tsx`).
- Confirmed no Ladle stories exist for `SongSuggestionsSection` or
  `ReviewListScroll` (`grep -rln` for both names under `**/*.stories.tsx`
  returned nothing) — nothing to verify there per the task's optional check.
- Did not touch `MatchingSession.tsx`'s pre-existing unattributed
  `minmax(0,1fr)` working-tree change; prop threading for the paging props
  into `SongSuggestionsSection` was already done there in step 4, so step 5
  required zero edits to that file.

### Reviewer fixes (post step-5)
- Blocking: `ReviewListScroll.tsx` rendered `{footer}` between `listRef` and
  `.review-list-fade`, so the fade's `margin-top: -40px` overlapped the footer
  (e.g. "Loading more…"/Retry) instead of the last row at full scroll.
  Reordered to `listRef` → fade → `footer` and folded the "why" into the
  existing `footer` JSDoc (now: "Rendered after the fade so the fade's
  negative margin overlaps the last row, not the footer.").
- Non-blocking a11y: added `aria-live="polite"` to the `loadMoreError` retry
  footer in `SongSuggestionsSection.tsx`, matching the existing sentinel's
  `aria-live="polite"` so a stalled-pagination retry is announced the same
  way a loading state is.
- Did not add a DOM-order (fade-before-footer) assertion: `overflowing` is
  only `true` after a `ResizeObserver`/`getBoundingClientRect`-driven
  measurement in `useLayoutEffect`, which jsdom doesn't produce real layout
  for — faking it would mean building new measurement-mocking test
  infrastructure, which the task said not to do. Instead extended the
  existing "renders a retry footer" test in `SongSuggestionsSection.test.tsx`
  with an `aria-live="polite"` assertion, covering the a11y fix cheaply
  through an existing test.
- Verification: `bun run typecheck` green; `bun run test
  src/features/matching/__tests__/SongSuggestionsSection.test.tsx` green
  (27 passed); full `bun run test src/features/matching` green (14 files,
  172 passed).

## Orchestrator notes
- Unattributed working-tree change detected mid-run: `src/features/matching/sections/MatchingSession.tsx` (grid `1fr_1fr` → `minmax(0,1fr)`, both modes). Claimed by neither Task A nor Task B. Excluded from task commits; surfaced in final report.

## Post-run fixes (commits after the deviation-log commit `0774f51b`)

Two commits landed after this log was committed and made design decisions the
sections above didn't capture. Recorded here so the log stays the complete
deviation record.

### `d7c861a1` — session grid columns shrink below content width
- Resolution of the Orchestrator note above: the `MatchingSession.tsx` grid
  change flagged as "unattributed, excluded from task commits" was promoted to
  its own commit. `1fr` columns carry an implicit `min-width: auto`, so a long
  unbreakable suggestion row could push a column past the 50/50 split;
  `minmax(0,1fr)` on both the song and playlist arms keeps the split and defers
  to inner truncation. No longer unattributed.

### `d1ba3c0d` — key dismiss by item variables + surface tail read errors
- **Dismiss mutation variables are now `{ itemId, suggestionId }`, not a bare
  `suggestionId` string** — supersedes the Task D bullet above. A single
  MutationObserver is reused across cards (its options re-set each render as
  itemId changes) and `mutateAsync` runs against the observer's CURRENT
  options, so a dismiss queued on card A that settles after navigating to card
  B would otherwise execute with B's closed-over keys. Carrying `itemId` in the
  per-call variables makes each execution target the card it was enqueued for.
- **Per-itemId promise chain in `useMatchReviewCard`** serializes overlapping
  same-card dismisses. The whole-snapshot rollback is only sound if dismisses
  for one card never overlap: two concurrent onMutate snapshots plus a failed
  rollback would resurrect a row a succeeded dismiss removed. TanStack's
  mutation `scope` can't prevent this — it serializes only the mutationFn, and
  onMutate runs before the retryer — so the hook chains each dismiss behind the
  prior one's full settlement. Keyed by itemId (not one shared chain) so
  dismisses on different cards, which touch disjoint caches, don't stall each
  other.
- **`onMutate` tail-cancel and rollback tail-restore became conditional on
  `previousTail !== undefined`.** Cancelling the tail's auto-fired FIRST page
  (no data yet) reverts it to a data-less `hasNextPage=false` state that
  `loadMoreSuggestions` refuses to restart, stranding a >8-row card's tail; and
  writing `undefined` back on rollback would clobber a first tail page that
  finished loading during the mutation window. Both are gated to act only when
  loaded pages were actually snapshotted.
- **`readOwnedQueueItem` split from `fetchOwnedQueueItem` (miss vs error).**
  Deviates from the plan's literal "ownership via `fetchOwnedQueueItem`" in
  `listMatchReviewItemSuggestions`, but honors the plan's stated intent ("DB
  error → throw a generic retryable load-more error") better than its letter:
  collapsing an ownership-read DB failure to an empty page silently truncated a
  >8-row card's tail forever. `readOwnedQueueItem` preserves the miss-vs-error
  distinction so a genuine miss still returns an empty page while a read failure
  throws into the infinite query's error/retry state.

### `dismissChainsRef` Map eviction (this doc-update pass)
- The per-itemId promise-chain Map never evicted settled entries, so it retained
  one resolved-promise reference per card visited across a review session
  (bounded and tiny, but unbounded in principle). Added identity-checked
  eviction in `useMatchReviewCard`: once a chain settles, its entry is deleted
  UNLESS a newer dismiss has already overwritten it (the `chains.get(itemId) ===
  settled` guard), so a live chain is never removed. Serialization is unaffected
  — an evicted entry was fully settled, so the next dismiss's `Promise.resolve()`
  fallback is equivalent to the chain it replaced.

## Carried forward (not code — verify before/at deploy)
- **Deploy order** (from the plan, restated here so it isn't lost): prod runs
  pre-RPC code and neither migration is applied. Apply `20260702120000` then
  `20260703000000` to prod BEFORE deploying any build containing the RPC-calling
  server code. The v1 signature has no live caller, so the `DROP IF EXISTS`
  transition is safe.
- **Manual verification items 3 & 4** from the plan's Verification section
  (manual `/match` run against the legacy 845-pair card; read-only keyset SQL
  validation via `bun run prod:sql`) are not reproducible from the repo and
  remain to be done by a human before merge.
