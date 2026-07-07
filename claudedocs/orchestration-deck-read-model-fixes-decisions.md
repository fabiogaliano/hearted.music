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
