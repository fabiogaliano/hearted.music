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
