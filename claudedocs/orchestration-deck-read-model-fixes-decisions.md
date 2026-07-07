# Orchestration decisions — deck read-model review fixes

Plan: `claudedocs/deck-read-model-review-consolidated.md`.
Branch: `claude/match-deck-read-model-orchestrate-kzd5xs`.

This log records where execution diverged from the consolidated review, one line
per decision + rationale.

## Scope decision (orchestrator, pre-flight)

- **In scope:** H1–H4 and M1–M13 (every High + every Medium; each is "a real
  defect or a plan contradiction" per the review's own severity definition).
  Rationale: §8 "Fixes first" mandates H1–H4 + the listed M-fixes and asks for a
  decision on M7/M8/M10/M11/M13; the remaining mediums (M2) are cheap and
  belong with them.
- **Out of scope (this run):** L1–L10 (cleanup/hardening) except where a specific
  L item is the completion of an M fix — L8's `markItemPresented` deletion is
  folded into M6, and L9 stale-comment fixes are made only in files an M fix
  already touches. P1–P4 are pre-existing (explicitly "track separately") and
  §5 residuals are accepted — neither is touched. Rationale: the user asked to
  "patch the needed fixes"; needed = the pre-merge Highs and Mediums.
- **No push / no PR / commits stay local**, per the orchestrate contract.

## Per-fix decisions

(appended by implementation/patch subagents as they go)

- **H1/M2 (`20260706000011`)**: `mark_dead_match_review_deck_jobs()` gained a
  `p_lease_seconds` param, so the old zero-arg overload is `DROP FUNCTION IF
  EXISTS`-ed before the `CREATE OR REPLACE` with the new signature — leaving
  both would make a no-args RPC call ambiguous. Precedent for
  drop-then-recreate-on-signature-change: `20260613000000_match_strictness_preference.sql:28,174-176`.
- **H1 lease value**: introduced a `DECK_JOB_LEASE_SECONDS = 900` constant in
  `poll-match-deck-jobs.ts` (mirrors `CLAIM_LEASE_SECONDS` in
  `poll-audio-feature-backfill.ts`) and pass it explicitly to both
  `sweepStaleDeckJobs` and `markDeadDeckJobs` in the sweep tick, so the two
  can never drift apart (the SQL default of 900 alone isn't enough — TS calls
  now pass a value on purpose so the coupling is visible at the call site).
- **M2 kind priority**: `build_proposals` and `repair` share priority rank 2
  (equal, both behind `capture_ahead`/`append_sessions`) — the review's fix
  only specifies `repair` should not starve behind `build_proposals` scale-out,
  not that one must strictly precede the other; `CASE ... ELSE 3` is a safety
  net for any future `kind` value, unreachable given the table's CHECK
  constraint.
- **H1 belt-and-suspenders**: added `.eq("status", "running")` to both
  `completeDeckJob` and `deferDeckJob` in `deck-jobs.ts`. Verified their only
  caller (`poll-match-deck-jobs.ts`) always calls them on a job it just
  claimed as `running`, so the normal running→completed/pending path is
  unaffected; only a job concurrently mark-dead'd is now correctly ignored.

### H3 / M6 / M13(b) — deck read-model SQL fixes (20260706000012–000015)

- **H3(b) ON CONFLICT target left bare (no column/constraint list) on both
  bulk inserts inside `start_or_resume_match_deck`.** Rationale: each target
  table (`match_review_queue_item`, `match_review_item_visible_pair`) carries
  multiple unique constraints a duplicate source row could hit (queue item:
  `(session_id, position)` plus two pairs of per-orientation partial unique
  indexes; visible pair: its PK `(queue_item_id, song_id, playlist_id)` plus
  `(queue_item_id, visible_rank)`), so no single conflict target is
  unambiguous — matches the task brief's documented fallback.
- **M6 newness upsert reuses `viewed_at = EXCLUDED.viewed_at` only (no
  `updated_at` in the `DO UPDATE SET`).** Rationale: `account_item_newness`
  has a BEFORE UPDATE trigger (`account_item_newness_updated_at` →
  `update_updated_at_column()`) that stamps `updated_at` automatically on
  every UPDATE, so setting it explicitly would be redundant; this also
  matches `clearSongNewness`'s original Supabase `.upsert()` payload, which
  only ever set `is_new`/`viewed_at`.
- **M13(b1) FK constraint name confirmed as the Postgres auto-generated
  `match_review_proposal_snapshot_id_fkey`** via `pg_constraint` (the CREATE
  TABLE gave it no explicit name), matching the brief's fallback guess exactly
  — no deviation needed.
- **M13(b2) revert-companion bodies were cleanly extractable for all four
  RPCs** — no reconstruction needed. `add_match_review_item_decision_atomic`'s
  last pre-`000009` definition is in `20260627000200_msr_add_decision_xor_target.sql`;
  the other three (`dismiss_match_review_item_suggestion_atomic`,
  `finish_match_review_item_atomic`, `dismiss_match_review_item_atomic`) are
  all last defined together in `20260701140000_row_level_match_suggestion_dismiss.sql`.
  Copied verbatim (including REVOKE/GRANT) into
  `claudedocs/rollback/restore-pre-deck-action-rpcs.sql`.
- Verification: `supabase migration up` applied 20260706000012–000015 cleanly
  against local Supabase; confirmed via `pg_indexes`/`pg_constraint`/`pg_proc`
  that the three new indexes, the cascaded FK, the two `ON CONFLICT DO
  NOTHING` clauses, and the gated newness upsert all landed as intended. Also
  ran an ad hoc transaction-rollback smoke test confirming a duplicate
  `(proposal_id, song_id)` insert into `match_review_proposal_subject` now
  raises `unique_violation` at insert time.

### H4 part 1/2 — not-entitled deadlock (`card-materializer.ts`)

- **Reused `captureVisiblePairsAtomic([])` rather than inlining a direct
  `UPDATE … SET visible_pairs_captured_at`.** Rationale: the atomic RPC already
  has a documented `empty` status (`20260625080000…:9,199`) — "zero pairs
  given; timestamp + activation still applied" — which is the exact
  captured-empty mechanism the normal (entitled) branch already goes through
  when its own suggestion list happens to be empty. Reusing it means the
  not-entitled branch gets first-write-wins idempotency, the same
  `already_resolved`/`not_found` guards, and the same state-activation
  behavior for free, instead of a second, divergent write path.
- **Did not touch the SQL promotion path.** While tracing "the promotion seed
  path stamps captured-empty cards" (H4 part 1 reference), found that
  `buildSeedForSubject` (`proposal-builder.ts:178-180`) returns `[]` for a
  not-entitled subject in the seed window, which means that subject's
  `subject_position` never gets a row in `match_review_proposal_seed_pair` —
  so `start_or_resume_match_deck`'s captured-empty stamp UPDATE
  (`20260706000008…:187-196`, keyed off `IN (SELECT subject_position FROM
  match_review_proposal_seed_pair …)`) silently excludes it too. This is a
  latent twin of H4 inside the promotion RPC's seed window, not just a
  contrasting "already works" reference. Left unfixed here (task scope was
  TS-side `captureAheadForSession` + confirming no second on-demand path
  exists; this is a SQL migration edit) — flagged for the orchestrator. It is
  NOT a live deadlock today: `captureAheadForSession`'s ahead-of-time run and
  the read RPC's R-E on-demand fallback both close over the SAME
  `captureAheadForSession` function (`match-deck.functions.ts:618-655`), so
  the now-fixed captured-empty stamp always lands on next capture pass or next
  read, even for a subject the promotion path missed.

### H2(a) / M4 / M12 — `proposal-builder.ts` write-time fixes

- **H2(a) implemented as a per-call latest-snapshot re-check inside
  `buildOneProposal`, not hoisted to the preset loop.** Rationale:
  `buildOneProposal` is also called directly (single preset, no wrapping loop)
  by `match-deck-miss-path.ts`'s synchronous request-path build, which needs
  the same guard; hoisting to `buildProposalsForAccountOrientation` would miss
  that caller. Kept the return type `Result<void, DbError>` unchanged — a
  superseded build finishes as `status: "stale"` and returns `Result.ok`
  (matches the brief: "successful-but-superseded", not an error); no callers
  branch on anything but `Result.isError`, so no discriminated result value was
  needed. Verified via `match-deck-miss-path.test.ts`'s existing "re-invoke
  still misses" case: if the guard flips a request-path build to `stale`, the
  re-invoked RPC just misses again and the caller already handles that
  (`buildFirstWindowAndPromote` returns the miss unchanged; no error path).
- **M4 required no code change — already correct.** The upsert
  (`proposal-builder.ts:239-269`) writes `status: "building"` as part of its
  payload, and Supabase's `.upsert(obj, {onConflict})` compiles to `INSERT ...
  ON CONFLICT (account_id, orientation, snapshot_id, visibility_config_hash)
  DO UPDATE SET <every column in obj, including status>` — confirmed that
  4-column unique constraint is the table's actual `UNIQUE` clause
  (`20260706000003_deck_read_model_proposal_tables.sql:46`), so the conflict
  target is unambiguous and the update really fires. That means a REBUILD of
  an already-`ready` proposal commits `status='building'` in its own request,
  before the delete-subjects call runs — closing the promotion race as asked.
  Added a comment above the upsert making this explicit (don't drop `status`
  from the payload) since the invariant isn't obvious from reading the upsert
  in isolation.
- **M12: added `nowMs?: number` to `computeVisibleSuggestionList` (default
  `Date.now()`), threaded through both the song and playlist branches** by
  renaming the branch-local `const nowMs = Date.now()` to `resolvedNowMs =
  nowMs ?? Date.now()` (avoids shadowing the new parameter). `buildSeedForSubject`
  now takes `nowMs: number` and passes it through positionally; `buildOneProposal`
  passes its shared `nowMs` at the call site. `card-materializer.ts`'s call
  site (the only other caller) is untouched and keeps defaulting to
  `Date.now()`, per the brief.

### H2(b) / M3 / M5 / M11 — session-appender + poll-loop append path

- **M3: deleted `treatPositionRaceAsNoop` outright** rather than narrowing it.
  The only remaining thing to do on a `(session_id, position)` ConstraintError
  is propagate it (`return insertResult;`), so the helper added no value once
  the no-op branch was removed — kept the explanatory comment inline at both
  call sites (song + playlist arms) instead of behind an indirection.
- **H2(b): checked `getLatestMatchSnapshot` directly, right after the active-session
  fetch**, rather than relying only on the existing `proposalResult.data.status
  === "stale"` check further down. The `stale` check depends on
  `buildProposalsForAccountOrientation` having already flipped the older
  proposal's status for THIS (account, orientation) — a correct but indirect
  signal that only exists once that other code path has run. Checking the
  account's latest snapshot directly is a cheaper, more direct guarantee and
  doesn't regress anything: kept the `stale`-status check too as a second,
  free guard (it fires for the same condition via a different signal, so it's
  harmless duplication, not dead code — e.g. it still catches a proposal
  explicitly marked stale for reasons other than a newer snapshot's *publish*
  timing race).
- **M11 + M5: threaded a single `sessionId` field through the `applied` outcome
  variant (not an array)**, not "each affected session" as the finding's plural
  phrasing might suggest. `fetchActiveSession` returns at most one row per
  (account, orientation) — the partial unique index allows only one active
  session per orientation — so `appendSessionsForAccountOrientation` always
  targets exactly one session per call; no fan-out is possible.
- **M11: `active_proposal_id` update and the M5 capture_ahead chain both gate on
  `appendedCount > 0`, factored through one `finalizeAppliedAppend` helper**
  used by every `applied`-outcome return site except the very top
  already-applied idempotency short-circuit (which returns before `proposalId`
  is even fetched, and has nothing new to advance the FK to).
- **M5: enqueue failure is logged (Sentry-worthy via `log.warn`) but does NOT
  defer the `append_sessions` job**, unlike the `build_proposals→append_sessions`
  chain (which does propagate the enqueue error). Reason: `recordSnapshotApplied`
  already durably committed the (snapshot, hash) ledger row inside
  `appendSessionsForAccountOrientation` before the outcome is returned, so a
  retried `append_sessions` job would hit the "already applied" branch and
  return `appendedCount: 0` — it would never re-attempt the `capture_ahead`
  enqueue. Deferring the whole job on a chain-enqueue failure would therefore
  retry indefinitely without ever fixing the actual gap, while failing the
  already-durable append is strictly worse than a best-effort chain. Losing
  the chain here is recoverable (next mid-session publish, an
  action-triggered `capture_ahead`, or M2's priority queueing).
- **M5 idempotency key**: mirrored the SQL action RPCs' scheme exactly —
  `capture:{accountId}:{orientation}:{sessionId}:{resumePosition ?? "none"}`
  (see `v_idem_key` in `20260706000009_extend_deck_action_rpcs.sql:172-173` and
  friends) — reusing the already-imported `readSessionResumePosition` from
  `card-materializer.ts` (same helper the existing `capture_ahead` dispatch arm
  uses) rather than adding a new resume-position read path.

### Post-review fixes — `session-appender.ts` (should-fix + nit, this pass)

- **Fix 1 (should-fix): `active_proposal_id` could be permanently stranded on a
  partial-failure retry.** Supersedes the earlier note above ("the very top
  already-applied idempotency short-circuit … has nothing new to advance the
  FK to") — that was true before this fix and is exactly the gap being closed.
  Failure mode: `recordSnapshotApplied`'s ledger INSERT commits, then
  `finalizeAppliedAppend`'s `active_proposal_id` UPDATE errors transiently; the
  job defers/retries, but the idempotency short-circuit (`appliedResult.value.has(appliedKey)`,
  `session-appender.ts:260`) now fires before `finalizeAppliedAppend` — and
  thus the UPDATE — ever runs again, since the ledger row already exists.
  - **Approach taken (the preferred option from the brief):** on the
    already-applied replay path, before returning, re-derive the exact ready
    proposal for this `(account, orientation, snapshot, hash)` key and
    re-issue the same idempotent `active_proposal_id` UPDATE scoped to
    `.eq("id", session.id)`. Implemented as a new
    `advanceActiveProposalOnReplay` function (`session-appender.ts:188-220`),
    called from the short-circuit at `session-appender.ts:262-274` instead of
    returning `Result.ok` directly.
  - **Shared lookup, not duplicated:** factored the proposal
    `select("id, status").eq(account).eq(orientation).eq(snapshot).eq(hash)`
    query (previously inline in the main apply path) into
    `fetchProposalForSnapshotHash` (`session-appender.ts:139-162`), used by
    both the main apply path (`session-appender.ts:279-284`) and the new replay
    self-heal. Scoping on all four columns means the replay path can never
    resolve another account's or a stale/mismatched-snapshot proposal — it is
    the identical row identity the original successful apply would have
    resolved.
  - **Failure-mode handling:** a query error from the lookup, or an error from
    the UPDATE itself, is propagated (`Result.err`) so the job defers/retries —
    matching `finalizeAppliedAppend`'s own handling of this exact UPDATE
    (`session-appender.ts:117-121`) for consistency. This does not risk an
    infinite loop: the ledger row is already durable (that's what made this a
    replay in the first place), so retries are bounded by the job's normal
    defer/retry/dead-letter policy, same as every other error path in this
    file — retrying is also precisely what's needed to re-attempt the FK
    write. A proposal that exists but isn't `ready` (still `building`, or
    flipped `stale` by a newer snapshot) is deliberately NOT an error: the
    advance is simply left for a later append job once a ready proposal
    exists for that key, rather than forcing a defer loop over a state that
    isn't actually broken.
- **Fix 2 (nit): corrected the M3 comments' overclaim.** The comments at the
  two insert-error propagation sites (song arm `session-appender.ts:355-364`,
  playlist arm `session-appender.ts:408-410`) previously implied only the
  `(session_id, position)` race is deferred. `queries.ts`'s
  `insertQueueItems`/`insertQueuePlaylistItems` actually collapse postgres
  23505/23503/23514 all into `ConstraintError` (`queries.ts:343-358`,
  `397-412`), so any constraint violation — not just the position race — now
  defers-and-retries. Reworded both comments to say ANY ConstraintError is
  deferred, with the position race called out as the common/expected case
  rather than the only one. No behavior change — comment-only.
- **Verification:** `bun run typecheck` and `bun run typecheck:worker` both
  clean; `bun run test` (full suite) — 299 passed / 1 pre-existing skip, 3379
  tests passed / 8 skipped / 11 todo, no failures, nothing skipped or modified
  to pass. No test file exists yet for `session-appender.ts` specifically
  (confirmed via search) — none added, per scope (fix the review findings, not
  add new test coverage).

### M10 / M1 — shared visibility-config-hash helper, skip-hash probe, build-key hash

- **Shared helper location/name**: `resolveVisibilityConfigHash(accountId,
  orientation, nowMs?)` in a new file,
  `src/lib/domains/taste/match-review-queue/visibility-config-hash.ts` (not a
  barrel — a single named export). Named `resolve*` rather than reusing
  `computeVisibilityConfigHash` (the existing pure function in
  `visibility-policy.ts` that hashes an already-resolved
  `QueueVisibilityConfigHashInput`) to avoid a same-name collision at any
  import site that needs both the async DB-composing version and the sync
  pure one. Returns `Result<{ hash, minScore, policy }, DbError>` — `minScore`
  is included because `resolveMatchDeckView`'s miss branch needs it (for
  `presetForMinScore`) and would otherwise have to re-derive it, defeating the
  point of the shared helper.
- **M10 "no active session" detection**: `callStartOrResumeMatchDeck`'s return
  type is `status: "active" | "miss"` — a `Result<StartOrResumeMatchDeckRpcResult,
  DbError>` already discriminates exactly what's needed. Verified against the
  RPC SQL (`20260706000008…:61-69` branch 1 vs `:82-104` branches 2/3): branch
  1 (active session) never touches `p_visibility_config_hash`; branch 2's
  proposal lookup does `p.visibility_config_hash = p_visibility_config_hash`,
  and SQL `NULL = x` is never true, so a `NULL` probe is *guaranteed* to fall
  through to branch 3 (miss) whenever there's no active session — regardless
  of what the real hash would have been. That means `status: "active"` on a
  null-hash probe can only mean branch 1, so it's safe to trust directly with
  zero hash cost; `status: "miss"` triggers the normal fallback path (compute
  the real hash, re-call the RPC, which may itself land on branch 2 promotion
  or a genuine branch-3 miss — both already handled by the pre-existing
  post-probe code, unchanged).
- **`callStartOrResumeMatchDeck`'s `visibilityConfigHash` param widened to
  `string | null`.** The generated `database.types.ts` Args type for this RPC
  has no way to express "TEXT, nullable at the SQL level" (Supabase codegen
  types every function TEXT param as non-null `string`, with no signal from
  the CREATE FUNCTION statement itself), so passing the literal `null` needs a
  narrow `as string` cast at the `.rpc()` call site — same category of gap the
  file already casts around for the JSONB return (`data as unknown as
  StartOrResumeMatchDeckRpcResult`), not a new escape hatch.
- **`resolveMatchDeckView`'s `skipHashComputation` is an options-object flag**
  (`options?: { skipHashComputation?: boolean }`), not a new positional
  param — keeps the existing `emitEntryMetrics` boolean's call sites
  unaffected and makes the skip mode opt-in and self-documenting at the call
  site (`submitMatchDeckAction`'s read-after-write only).
- **M1 idempotency-key hash-fetch failure handling differs between the miss
  path and the other three enqueue sites.** `match-deck-miss-path.ts` already
  has a resolved `visibilityConfigHash` in scope (no new failure mode
  possible). For `execute.ts`, `playlists.functions.ts`, and the warm script,
  hash resolution is a NEW fallible step; on failure each site captures the
  error (Sentry via `captureServerError`/`Sentry.captureException`/counted as
  `failed` in the warm script's report) and **skips that orientation's
  enqueue entirely** rather than falling back to the pre-fix hash-less key.
  Rationale: silently degrading to the old key on a hash-fetch failure would
  reintroduce the exact dedupe hazard M1 exists to close, invisibly; skipping
  the enqueue is loud (traced/logged) and safe — these are all best-effort
  triggers already (a missed enqueue here still self-heals via the read
  path's miss-path builder, per the accepted §5 residual).
- **All four M1 sites updated** — none skipped: `match-deck-miss-path.ts:87`
  (trivial, hash already in scope), `playlists.functions.ts`'s
  `enqueueFilterProposalRebuild` (one `resolveVisibilityConfigHash` call per
  orientation inside the existing 2-orientation loop), `execute.ts`'s
  post-publish enqueue (same, inside its existing 2-orientation loop), and
  `warm-match-deck-proposals.ts`'s `warmAccount` (one call per
  account-orientation, outside any preset loop — the script has no preset
  loop of its own; presets are built inside the single `build_proposals` job
  the worker later drains).
- **Test updates required beyond the 4 source sites**: the M1 key-format
  change broke 3 pre-existing test files that assert the exact
  `idempotencyKey` string without any hash suffix and don't mock the
  hash-resolving trio — `playlists.management.test.ts`,
  `playlists.match-config.test.ts` (both exercise
  `enqueueFilterProposalRebuild` via `flushPlaylistManagementSession`/
  `savePlaylistMatchConfig`), and `execute.test.ts`. Added a
  `resolveVisibilityConfigHash` mock (module-level `vi.mock`, orientation-keyed
  stub hash like `vc_test_${orientation}`) to each and updated the
  `idempotencyKey` assertions to include the `:vc_test_<orientation>` suffix.
  `playlists.functions.test.ts` doesn't assert the exact key but needed the
  same mock added since `savePlaylistMatchConfig`'s "normalizes duplicate
  language codes" test triggers the filter-only path and would otherwise hit
  the real (unmocked) DB-backed trio.
- **Added regression tests in `match-deck.functions.test.ts`** for the M10
  skip-hash probe: one asserting the probe is called with a `null` hash and
  the trio (`resolveMinMatchScore`/`fetchTargetPlaylistFilters`) is never
  invoked when the RPC reports `active`, and one asserting the fallback to
  the real hash (and a second RPC call) when the probe reports `miss`. Not
  requested explicitly, but this is the exact behavior the finding is about
  and had zero prior coverage.
- **Verification**: `bun run typecheck` and `bun run typecheck:worker` both
  clean. Full `bun run test` — 299/300 files passed (1 pre-existing skip),
  3377 passed / 8 skipped / 11 todo, zero failures, nothing disabled. `bunx
  biome check --write` applied on every touched source + test file (formatting
  only, no logic changes).

### M7 / M8 / M9 — client-side `match.tsx` fixes

- **M7 staleness set scoped to `already_resolved`/`not_found` only, checked via
  a shared `STALE_REJECTION_STATUSES` set** applied identically at all three
  rejection sites (`handleSkipUnavailable`, `handleDismiss`, `handleNext`).
  `no_captured_pairs` stays a plain retry (`onReleaseNavigation()` only, no
  view applied), per the brief and H4's root-cause fix. On a stale rejection,
  `applyResolvedView(result.view)` is awaited and no session-stat counters are
  bumped — the action didn't actually happen on this call, another
  tab/session already resolved it, so counting it as a skip/dismiss/finish
  here would double-count.
- **No explicit `onReleaseNavigation()` call needed on the M7 stale-reconcile
  path.** `applyResolvedView` always moves `onCurrentItemId` to a *different*
  item (the rejected item is, by definition of `already_resolved`/`not_found`,
  no longer the deck's current head) or to `null` on caught-up, which changes
  the `itemId` prop `QueueCardContent` is keyed off of — the existing
  `useEffect(() => onReleaseNavigation(), [itemId, ...])` (match.tsx, the
  release-on-itemId-change effect) fires and releases the lock, same
  mechanism the success path already relies on. Adding a redundant explicit
  release would risk double-managing `navigationLockedRef`.
- **M8 implemented as a bounded fixed-interval poll, not exponential
  backoff** (`BUILDING_POLL_INTERVAL_MS = 3_000`, `MAX_BUILDING_POLLS = 5` →
  ~15s ceiling before giving up and falling back to refocus/manual retry).
  Rationale: the miss-path promotion either succeeds within a couple of
  retries or the underlying build genuinely needs longer, in which case
  backoff timing doesn't change the outcome — a plain bound is simpler and
  sufficient.
- **M8 poll counting uses `query.state.dataUpdateCount` relative to a
  component ref baseline**, not a separate counter effect, so it works
  correctly whether the polling condition (`isBuilding && firstVisibleMatchReady`)
  starts true on mount (loader/SSR arrived mid-build) or turns true
  later — the baseline is captured lazily inside the `refetchInterval`
  callback the first time the gate is true, and cleared the moment the gate
  goes false (either because the deck resolved or `firstVisibleMatchReady`
  flips back), so a later, distinct building spell gets a fresh bounded
  window rather than inheriting an exhausted counter.
- **M8 fully replaces the one-shot `useEffect` (deleted), rather than keeping
  it alongside `refetchInterval` as a "fire once immediately, then poll"
  hybrid.** The brief explicitly prefers `refetchInterval` over an effect;
  keeping both would mean two independent triggers racing to invalidate/
  refetch the same query on the same transition, for no behavioral gain over
  a short (3s) interval alone. `useActiveJobs` (`useActiveJobs.ts:20-28`)
  already establishes the `refetchInterval: (query) => ...` idiom in this
  codebase, so this isn't a novel pattern.
- **M9 cancels only the card-read keys (`readMatchDeckCardQueryOptions`) that
  `applyResolvedView` is about to write** (current + next, guarding
  optional/null), not the deck query key itself. The hazard named in the
  finding is specifically the warm-ahead prefetch effect
  (`queryClient.prefetchQuery(readMatchDeckCardQueryOptions(next1))`) racing
  the post-action card write; the deck query has no equivalent concurrent
  prefetcher in this file, so cancelling it too would be unnecessary scope
  creep on the mutations.ts pattern this mirrors.
- **`applyResolvedView` made `async`; all three call sites now `await` it**
  (previously fire-and-forget). No caller depended on synchronous completion
  before this change (each call was already the last statement before a
  `return`/end of an async handler), so awaiting introduces no new ordering
  requirement.
- **Verification:** `bun run typecheck` — `match.tsx` itself is clean; one
  pre-existing/unrelated error surfaced in
  `match-review-queue/deck-read-queries.ts` from a concurrent in-progress
  M10 edit elsewhere on this branch (confirmed via `git stash` isolation:
  the error exists with `match.tsx`'s changes fully reverted too, and the
  concurrent file's error set was observed to change between consecutive
  typecheck runs — i.e. another session is actively editing it). Not in
  scope (sole file to edit was `match.tsx`) and not touched.
  `bun run test src/routes/_authenticated/__tests__/match.test.ts
  src/features/matching` — 170/170 passed across 15 files, including the
  direct `match.test.ts`. That suite does not yet assert on the specific
  M7/M8/M9 scenarios (rejection reconciliation, bounded building polls,
  prefetch-cancel ordering) — no test changes were made, per scope (fix the
  reviewed defects, not add new coverage).

### M6 completion — delete the now-dead `markItemPresented` TS path

- **Re-confirmed zero production callers before deleting**: `grep -rn
  "markItemPresented" src/ scripts/` hit only the definition
  (`service.ts:417`) and test/mock references — no production caller found,
  matching the finding. Proceeded with deletion.
- **`clearSongNewness` (`queries.ts:1204-1220`) was orphaned by this deletion
  and deleted too** — `markItemPresented` was its only caller (grep confirmed
  no other production or test-direct caller besides mocks).
- **`updateQueueItemPresented` (`queries.ts:562`) became newly orphaned as a
  side effect** (it was only called from the now-deleted `markItemPresented`)
  but is left in place — it's not named in M6 or L8, and the task scope was
  explicitly "delete ONLY what references `markItemPresented`/
  `clearSongNewness`". Flagging for a follow-up cleanup pass rather than
  deleting it unprompted.
- **Test deletions**: removed the whole `describe("markItemPresented", ...)`
  block in `service.test.ts` (4 test cases) plus its dangling
  `markItemPresented` import and the now-unused `clearSongNewness` mock
  wiring (vi.mock entry + beforeEach default). Removed the 6
  `markItemPresented`/`clearSongNewness`-referencing mock lines (hoisted vars
  + vi.mock factory entries) in `match-review-queue.functions.test.ts`. Also
  removed one stray `markItemPresented: vi.fn()` mock-factory entry in
  `match-review-queue.summary.test.ts` — not named in the task's file list,
  but it directly referenced the deleted symbol and was in-scope per "delete
  ONLY what references markItemPresented/clearSongNewness". Left
  `markItemResolved`, `callPresentMatchReviewItemFast`, and every other L8
  mock/symbol untouched, per explicit out-of-scope instruction.
- **Verification**: `bun run typecheck` and `bun run typecheck:worker` show
  zero errors attributable to any of the 5 files this pass touched (isolated
  via targeted grep on the typecheck output); the only typecheck errors
  present come from unrelated, concurrent in-progress edits elsewhere on this
  branch (`match.tsx`, `match-deck.functions.ts`, `deck-read-queries.ts`,
  `visibility-config-hash.ts`, `playlists.functions.ts` — confirmed via `git
  stash`/`git diff --stat` that none of these are part of this pass's diff,
  and the earlier M7/M8/M9 entry above already documents this same
  concurrent-M10-editing artifact). `bun run test` on the 4 directly affected
  suites (service, match-review-queue.functions, match-review-queue.summary,
  queries) — 73 passed, 4 pre-existing todo, no failures. A full-suite run
  additionally showed 3 failures in `playlists.match-config.test.ts` /
  `playlists.management.test.ts`; isolated via `git stash` (reverting this
  pass's 5-file diff only) and confirmed those 3 failures persist independent
  of this change — same concurrent-WIP cause, not a regression from this
  pass. `bun run check` (biome) clean on all 5 touched files.

## Post-verification fix pass 2

- **P0 unserialized concurrent-build race (`match-deck-miss-path.ts`) — fixed
  via option 2 (miss path defers to the queue), not option 1 (transactional
  RPC).** Rationale: `buildOneProposal`'s subject list can be the full
  current-preset scan (§8.3 deviation, already accepted) — worst observed
  case in this codebase's own measurements is an 845-suggestion playlist —
  which would have to marshal hundreds of subject rows + their promotion-seed
  pairs as jsonb RPC arguments to make a single-transaction rebuild function
  work; that payload size/shape is exactly the "large/fragile" case the task
  said to fall back from. Option 2 instead adds
  `findInFlightBuildProposalsJob(accountId, orientation)`
  (`deck-jobs.ts`) and, in `buildFirstWindowAndPromote`, checks it before
  building: if a `pending`/`running` `build_proposals` job already exists for
  this key (the common case — the same snapshot publish that produced this
  miss already enqueued it), skip the inline build, keep the best-effort full
  enqueue, and return the RPC's own miss shape unchanged so the caller
  degrades to `{status:"building"}`. The lookup itself fails OPEN (a lookup
  DB error falls through to the inline build rather than blocking the
  request) since it is a best-effort collision check, not a correctness
  gate — the residual TOCTOU between the check and the build is accepted
  explicitly, matching the task's stated trade-off. Belt-and-suspenders per
  the hard requirement: `buildOneProposal`'s own `unique_violation`
  (Postgres SQLSTATE `23505`) is now caught and degraded to the same miss
  shape instead of propagating, so a request that still loses a residual
  race (TOCTOU window, or some other concurrent writer) surfaces
  `{status:"building"}`, never the "Could not prepare your match deck" 500.
  Both branches trace via the existing `captureServerError` seam. No new
  migration — this is a TypeScript-only change plus regression tests in the
  existing `match-deck-miss-path.test.ts` scaffold (4 new cases: in-flight
  job defers, lookup failure fails open, unique_violation degrades, a
  non-unique_violation build error still propagates as a genuine failure).
- **P2.2 docstring fix (`match-deck-miss-path.ts` header, step 2)** — reworded
  the claim that branch-2 promotion is "guaranteed" to find the just-built
  proposal. It is not: a target-filter change racing between the request's
  hash read and the builder's own filters read can skew
  `visibilityConfigHash`, producing a transient miss that self-heals on the
  next entry (this was already a known, accepted behavior, just misstated in
  the docstring). The header now describes this as the normal case, not a
  guarantee, and calls out the filter-change skew explicitly.
- **P1.3 (`20260707000017`)**: dropped `idx_match_review_deck_job_pending_poll`
  outright (no replacement) — `claim_pending_match_review_deck_job`'s ORDER BY
  has led with the kind-priority CASE expression since M2, and
  `idx_match_review_deck_job_pending_claim_priority` (20260707000016) is the
  only index whose leading columns match that ORDER BY; confirmed via `EXPLAIN
  (COSTS OFF)` against a seeded 5000-row table (3-row/tiny-table plans always
  choose Seq Scan under the cost model regardless of which indexes exist) that
  the claim query's plan uses `idx_match_review_deck_job_pending_claim_priority`
  with no Seq Scan and no reference to the dropped index.
- **P1.4 (`20260707000018`)**: consolidated `v_total`/`v_remaining`/`v_item_ids`
  in `start_or_resume_match_deck` into one `SELECT ... FILTER (WHERE ...)`
  pass over `match_review_queue_item` (single READ COMMITTED snapshot) instead
  of three independent SELECTs, so the three can never disagree in one
  response; diffed the new function body against 000013's verbatim and
  confirmed the only hunk is that consolidation — no other line changed.
- **P1.1 (L3, `match-deck.functions.ts`)**: `mapReadDeckCardToItemRead` is pure
  by design (no accountId param; directly unit-tested with fabricated raw RPC
  shapes), so the two silent fallback arms (ready-with-no-subject, unknown
  status) can't capture themselves — hoisted a `captureUnexpectedCardShape`
  helper to every call site instead (`mapCardEnvelope`/`mapStartOrResumeToView`,
  and both read points in `resolveDeckCard`), keeping the mapper untouched.
  `not_captured` is deliberately excluded from the "unexpected" set — that cold
  path is already tracked via the `match_deck_materialize_on_read` product
  event, not a shape violation worth a new Sentry capture.
- **P1.2 (`poll-match-deck-jobs.ts`)**: added a `captureDeckJobDispatchError`
  helper mirroring the existing build_proposals/repair `Sentry.captureException`
  call's exact tag shape (`area=match_deck, operation=<kind>, runtime=worker`),
  wired to the genuine failure paths only — `append_sessions`'s
  `Result.isError(outcome)` branch and both `capture_ahead` failure points
  (`readSessionResumePosition`, `captureAheadForSession`). Left the
  `no_ready_proposal` retry-defer and the `superseded`/`no_active_session`
  complete-without-defer outcomes uncaptured on purpose — those are expected,
  routine control flow (the same reasoning the existing M2 comment already
  gives for `superseded`), not dispatch failures.
- **P1.5 (`deck-read-queries.ts`)**: added a minimal `status`-discriminator
  allowlist (array + `as const` + type guard) to both RPC wrappers, mirroring
  the style of `./queries.ts`'s `is*AtomicStatus` guards — but NOT their
  behavior: those convert an unknown status into `Result.err`, while these two
  deliberately still `Result.ok` the value (the mappers' fallback arms already
  handle an unexpected status gracefully) and instead fire a `captureServerError`
  at the wrapper boundary so the drift is visible. Confirmed via grep that
  neither wrapper is imported from `src/worker` (only `src/lib/server`), so
  importing the Cloudflare-only `captureServerError` here doesn't cross-
  contaminate the worker bundle — same constraint M1's decisions already
  documented for `proposal-builder.ts`.
- **P3.2 (`poll-match-deck-jobs.ts` / `.test.ts`)**: exported `dispatchDeckJob`
  (no behavior change) for direct per-kind dispatch tests. The claim → dispatch
  → settle lifecycle tests (happy-path complete, handler-error defer, N2's
  0-row settlement-guard warn) needed more than `dispatchDeckJob` alone since
  `logSettlementFailure` only runs inside the poll loop's fire-and-forget task
  — but driving the real `startMatchDeckJobPolling` while-loop in a test hit a
  hard wall: it idles on the global `Bun.sleep`, which the vitest node pool this
  suite runs under doesn't provide (confirmed absent — `ReferenceError: Bun is
  not defined`), and stubbing it to resolve immediately just turns the loop
  into a busy-spin that OOM'd the test worker. Instead, extracted the loop's
  per-job body (heartbeat lease, dispatch, settle) into a new exported
  `runClaimedDeckJob(job)` — a pure refactor (same body, same single call site,
  `void runClaimedDeckJob(job)` replacing the inline IIFE) — and tested that
  directly with mocked settlement calls; no full-loop test needed. M5's exact
  idempotency-key string (both the concrete-`resumePosition` and `?? "none"`
  branches) and the `superseded` no-defer/no-Sentry case are covered via
  `dispatchDeckJob` directly, since they don't touch settlement at all.

- **P2.1 (`proposal-order-parity.test.ts`)**: rewrote the file per review L10.
  Kept the one hand-computed test (`deriveEligibleSubjects` entitlement/
  ownership prefilter + tie-break-by-id pin) verbatim; replaced the vacuous
  `typeof deriveEligibleSubjects === "function"` closer and the two tests that
  only re-exercised the same pure fixture with two new tests that drive
  `deriveProposalSubjects` end-to-end (all six of its DB-facing dependencies —
  `getMatchResults`, `getNewItemIds`, `getMatchDecisionsForSongs`,
  `fetchSongsFilterMeta`, `fetchOwnedPlaylistIds`, `fetchTargetPlaylistFilters`,
  plus the admin-client entitlement RPC — mocked; `getOrderedUndecidedSubjects`
  and `deriveEligibleSubjects` themselves run for real) and pin the exact
  `match_review_proposal_subject` rows (order + every field) for both song and
  playlist orientation. Corrected the docstring to say parity is by
  construction via the shared `deriveEligibleSubjects` seam, not via a deleted
  shadow-compare.
- **P2.3 (plan §12)**: replaced the "read-only shadow-compare script in
  `scripts/`" pre-merge bullet with a note that it's superseded —
  `appendSnapshotDelta` is gone, so parity now rests on the shared
  `deriveEligibleSubjects` seam plus the fixture suites
  (`proposal-order-parity.test.ts`, `proposal-builder.test.ts`) that pin its
  output.
- **P2.4 (fix-pass-verification.md closing note)**: corrected the stale "tree
  dirty / branch unpushed" note. Verified via `git status` (clean) and
  `git log origin/<branch>..HEAD` (11 commits ahead, `813f35b4` — this doc's
  own commit — is the pushed tip): the tree is clean, the work through that
  commit is pushed, and the fix-pass-2 commits (P2.1/P2.3–P2.5) are local and
  unpushed, per the no-push contract.
- **P2.5 (`matchReviewKeys` dead exports)**: grepped the whole repo first —
  `matchReviewKeys.bootstrap` had zero references anywhere (not even a test);
  `matchReviewKeys.item` had zero production callers, and its one test
  reference (`useActiveJobs.test.ts`) never actually called the export — it
  hand-built the `["match-review", "item"]` key prefix in a comment/assertion
  to pin an invariant on a key nothing produces anymore. Deleted both exports
  from `queries.ts` (and the now-stale comment referencing `.item`); removed
  that dead-invariant test case rather than rewriting it, since nothing in
  production emits an `["match-review", "item", ...]` key post-cutover for it
  to guard against. Kept `all`/`reviewsRoot`/`review` — confirmed still
  referenced by `SettingsPage.tsx` and `PlaylistsCoverFlowScreen.tsx`.
- **P3.1 (`session-appender.test.ts`, tests only)**: added 3 cases — (a) two
  M3 constraint-defer tests (song via `insertQueueItems`, playlist via
  `insertQueuePlaylistItems`) asserting a `ConstraintError` propagates as
  `Result.err` and `insertSessionSnapshot` is never called, so the batch can
  never silently settle `applied`/`appendedCount:0`; (b) one guard-(b)
  isolation test that sets `getLatestMatchSnapshot` to still match the job's
  `snapshotId` (live-snapshot guard passes) while the proposal's persisted
  `status` is `stale`, asserting `{kind:"superseded"}` and that the subject
  fetch is never reached — isolating the persisted-status guard from the
  existing live-snapshot `superseded` test, which only exercises the other guard.
- **P3.3 (`visible-suggestion-list.test.ts` + `proposal-builder.test.ts`,
  tests only)**: in `visible-suggestion-list.test.ts`, added a `{kind:"range",
  end:{kind:"today"}}` liked-at fixture (subject song liked just after UTC
  midnight) driven through `computeVisibleSuggestionList` twice with the same
  DB fixture and two explicit `nowMs` values straddling that exact midnight —
  0 suggestions before, 1 after — proving the async driver actually threads
  its `nowMs` param into the filter predicate rather than defaulting to
  `Date.now()`. In `proposal-builder.test.ts`, mocked `deriveProposalSubjects`
  to return one subject (the existing suite's default of 0 subjects always
  skips the seed branch) and spied on `computeVisibleSuggestionList` (mocking
  `../visible-suggestion-list`, since the seed derivation's `buildSeedForSubject`
  is private/unexported) to assert it receives the builder's shared `nowMs` as
  its third argument — pinning the M12 fix at the one seam observable from
  outside the module.

### P3.4 — M1 hash-fail-skip regression tests (tests only, no new SQL/prod change)

- **`execute.ts` / `playlists.functions.ts` (`enqueueFilterProposalRebuild`)**:
  added one test each (`execute.test.ts`, `playlists.match-config.test.ts`)
  that makes `resolveVisibilityConfigHash` fail for the `song` orientation
  only, and asserts `enqueueDeckJob` is never called with `orientation:"song"`
  (no hash-less pre-M1 key), IS called once for `playlist` with the exact
  `build:{account}:{orientation}:{snapshot}:{hash}` key, the failure is
  captured (Sentry / `captureServerError`), and the overall operation still
  succeeds (`status:"published"` / the save's return value, not a throw).
  `DatabaseError`/tagged errors implement `Symbol.iterator` (for
  `Result.gen` yieldability), which trips `toHaveBeenCalledWith`'s deep-equality
  iteration protocol into `better-result`'s "Err yielded in Result.gen but
  generator continued" panic — worked around by extracting
  `mock.calls[0]` and asserting `toBe`/`toMatchObject` on the pieces
  separately, mirroring the existing `enqueueError` test in the same file that
  already uses this pattern for the same reason.
- **`playlists.match-config.test.ts` / `playlists.management.test.ts` already
  had exact (non-`objectContaining`) `enqueueDeckJob` key assertions for the
  SUCCESS path** ("takes filter-only path…", "syncs active session for
  filter-only flush…") — the brief's "ALSO add the currently-missing EXACT
  key assertions" requirement was already satisfied before this pass; no
  duplicate added.
- **`scripts/ops/warm-match-deck-proposals.ts` (`warmAccount`) — tested
  directly, not via helper extraction.** Direct testing turned out
  practical: `warmAccount` has no `supabase`-client dependency of its own
  (only `main`/`iterateLatestSnapshotPerAccount` do), and Vitest's shared
  config already seeds placeholder env vars for every node-project test
  (`vite.config.ts`'s `env: isTest ? {...}` block), so importing the module
  in a test is safe even though a real `bun scripts/ops/warm-match-deck-proposals.ts`
  invocation needs real env vars. Verified via a throwaway spike test before
  committing to this approach. The ONE production edit made: exported
  `warmAccount` plus its `AccountLatestSnapshot`/`WarmCounts` param/return
  types (previously unexported) — no behavior change, purely a visibility
  change so the function is importable from `scripts/ops/__tests__/`. New
  file `scripts/ops/__tests__/warm-match-deck-proposals.test.ts` covers
  `parseArgs` (3 cases) plus `warmAccount`: dry-run counts without touching
  hash/enqueue, exact hash-suffixed keys for both orientations on success,
  null-result → deduped (not enqueued), the M1 hash-fail-skip case (song
  fails, playlist still enqueues, `counts.failed`/`counts.enqueued` reflect
  the split, no throw), and a plain enqueue failure counted without throwing.

### P3.5 — client-side match.tsx tests (test-only; zero production edits)

- **New file `src/routes/_authenticated/__tests__/match.card-actions.test.ts`**
  covers M7, N1 (second half), M9, and M8 — all reached WITHOUT any
  production edit to `match.tsx`, by extending match.test.ts's existing
  trick one level further: `createFileRoute` is mocked to identity so
  `Route.component` (`MatchPage`) is a plain callable function; every React
  hook (`useState`/`useEffect`/`useCallback`/`useMemo`/`useRef`) is mocked to
  an inert/synchronous shim, so calling `MatchPage()` → walking
  `.props.children.type(...)` down through `QueueMatchPage` →
  `QueueMatchContent` executes each real function body far enough to read
  off the `.type` of the next JSX element in the tree — arriving at a real,
  otherwise-unexported reference to `QueueCardContent` (and, separately, at
  the real `refetchInterval` callback `QueueMatchPage` passes to the mocked
  `useSuspenseQuery`, captured straight off the mock's call args). That walk
  is one-time disposable scaffolding (memoized); every actual test then
  invokes `QueueCardContent`/`refetchInterval` directly with hand-built
  props/mocks, so assertions depend only on the real handler closures
  (`handleNext`, `applyResolvedView`), never on the scaffolding's own props
  or on `QueueMatchContent`'s internal `useState` call ordering. Sanity-checked
  the harness isn't vacuous by temporarily reverting each of the three fixes
  in a local, uncommitted edit and confirming the corresponding new test
  fails, then restoring via `git checkout --`.
  - **(a) M7**: two `handleNext` (finish-card) cases — `already_resolved`
    applies `result.view` (`setQueryData` on the deck key + `onCurrentItemId`
    advances) and does not bump `onSessionStats`, with no explicit
    `onReleaseNavigation` call (matches the earlier M7 decision: the itemId
    change is what releases navigation in production, via an effect this
    harness mocks away); `no_captured_pairs` releases navigation via
    `onReleaseNavigation` exactly once and applies nothing (`setQueryData`/
    `onCurrentItemId`/`onSessionStats` all untouched).
  - **(b) N1 second half**: a `finish-card` success whose promoted `view`
    carries a `retryable-error` current card and a `ready` next card —
    asserts the current card is routed through `queryClient.prefetchQuery`
    (never `setQueryData`) while the next card is seeded normally via
    `setQueryData`, mirroring the loader-side test at match.test.ts
    ~303-343 (both delegate to the same shared `seedBakedDeckCardReads`).
  - **(c) M9**: asserts `cancelQueries` is called with exactly the two
    written card keys (not the deck key), and — via `mock.invocationCallOrder`
    — that the last `cancelQueries` call's order index is strictly less than
    the first `setQueryData` call's, i.e. cancellation is fully awaited
    before any card-cache write.
  - **M8: tested via the same harness, not skipped and not extracted.**
    Captured the real `refetchInterval` callback off the mocked
    `useSuspenseQuery`'s call args (no export needed — the callback is read
    from the mock, not from `QueueMatchPage`'s return value) and drove it
    directly across synthetic poll ticks: stays on the fixed interval while
    still building + a first visible match is ready; stops once
    `MAX_BUILDING_POLLS` is reached; never polls when
    `firstVisibleMatchReady` is false; stops once the deck is no longer
    building; and a later, distinct building spell (after the gate goes
    false and back to true) gets its own fresh bounded window rather than
    inheriting the earlier exhausted baseline. One early draft of the last
    case encoded a wrong belief (that exhausting the bound alone clears the
    baseline) — caught by re-reading the source closely before trusting the
    test, since exceeding `MAX_BUILDING_POLLS` returns `false` without
    resetting `buildingPollBaselineRef`; only the gate-false branch clears
    it. Fixed before committing.
- **Scope note**: no export was added to `match.tsx` for any of the above
  (unlike the warm-script helper) — the walk-and-invoke technique only needs
  `Route` (already exported) plus the mocked React/router shims, so the P3.4
  warm-script export remains the only production edit in this whole pass.
