# Orchestration deviation log — Match deck read model

Plan: `docs/architecture/matching/deck-read-model-plan.md`
Branch: `feat/match-deck-read-model`
Started from: `7fe5db5693d51ac67895bef5b0515addf57af8e8`

This file records decisions made during execution that were **not** spelled out
in the plan, with a one-line rationale each. Appended to by every subagent.

## Orchestration setup

- **Branch name**: `feat/match-deck-read-model` — plan mandates a single feature
  branch (§12); name follows repo `feat/*` convention.
- **Deviation log location**: `claudedocs/` per project rule ("Analysis notes →
  `claudedocs/`") and the orchestrate command default.
- **Phase decomposition**: follows plan §12 landing sequence 1–6 verbatim.
  Phase 1 sub-split into 1a (storage DDL + job infra) and 1b (read/action RPCs)
  because the RPCs depend on the tables existing and the two are separately
  verifiable.

## Decisions

<!-- append below, newest last: `- **[phase] decision** — rationale` -->

- **[setup] Migration numbering starts at `20260706000003`** — latest existing
  migration is `20260706000002_present_match_review_item_rpc.sql`; new files
  increment from there (today is 2026-07-06).
- **[setup] `gen:types` runs once at end of Phase 1b** — a single regeneration
  after both tables (1a) and RPCs (1b) land captures the full additive schema
  for downstream phases; running it twice is wasteful.

## Phase 1a — storage DDL

- **Migration filenames**: `20260706000003_deck_read_model_proposal_tables.sql`,
  `20260706000004_deck_read_model_session_deck_columns.sql`,
  `20260706000005_deck_read_model_deck_job_table.sql`,
  `20260706000006_deck_read_model_deck_job_functions.sql` — table-before-function
  ordering, split for reviewability per the task's "split into separate files"
  allowance.
- **UUID default: `gen_random_uuid()` everywhere, not `uuidv7()`** — the
  `uuidv7()` default (20260526072701) is deliberately scoped to a named list of
  the highest-insert tables (`match_result`, `job`, etc.); the new proposal/
  deck-job tables are not on that list and every sibling `match_review_*` table
  uses `gen_random_uuid()`. Matching the immediate family beats a general
  "newer is better" argument.
- **Status columns are TEXT + CHECK, not native enums** — every sibling table
  in this feature area (`match_review_session.status`, `match_review_queue_item
  .state`, `audio_feature_backfill_job.status`) uses TEXT+CHECK; the native
  `job_status` enum is a legacy pattern from the original `job` table, not the
  house convention for anything added since.
- **`match_review_session.resume_position` defaults to `NULL`, not `0`** — `0`
  would be indistinguishable from "resumed and sitting at position 0"; `NULL`
  unambiguously means "no promotion/resume has positioned this session yet"
  and lets Phase 1b's start/resume RPC branch on IS NULL cleanly.
- **`match_review_deck_job` terminal status vocabulary: `pending | running |
  completed | dead`** (not `failed`) — the task text offered "dead/failed" as
  alternatives; `dead` was picked to match the required function name
  `mark_dead_match_review_deck_jobs()` 1:1, and the idempotency index's
  terminal set is `('completed', 'dead')`.
- **`match_review_deck_job.max_attempts` defaults to `3`** — mirrors
  `audio_feature_backfill_job`'s default verbatim; no reason cited in the plan
  to diverge.
- **`match_review_deck_job.session_id` is `ON DELETE SET NULL`, not CASCADE** —
  sessions are never hard-deleted today (only marked `abandoned`/`completed`),
  but if that ever changes, job history (the audit trail of what maintenance
  ran) should survive the session row, same reasoning as
  `audio_feature_source_review.audio_feature_id`'s SET NULL.
- **No `locked_by`/worker-fencing column on `match_review_deck_job`** — the
  plan's §5.3 field list is exhaustive and has no such column (unlike
  `audio_feature_backfill_job`'s `locked_by`/`lease_expires_at`). Since
  settlement RPCs (which would need a compare-and-set fence) are explicitly out
  of scope for Phase 1a ("no RPCs beyond claim/sweep/dead"), the claim function
  takes no `p_worker_id` and just sets `status`/`heartbeat_at`/`attempts`.
  Whoever implements settlement in a later phase needs to either add a fencing
  column then or fence some other way — flagging this now so it isn't a
  surprise.
- **`claim_pending_match_review_deck_job`'s NOT EXISTS check has a known
  intra-batch gap at `p_limit > 1`**: two pending jobs for the same
  `(account_id, orientation)` could both be selected in one call because the
  check only sees committed `running` rows, not sibling rows being claimed in
  the same UPDATE. Safe at the default `p_limit = 1`. The plan explicitly
  specifies the NOT EXISTS pattern (not an advisory-lock or window-function
  pattern), so this is taken as an accepted limitation of the specified
  approach rather than a defect to silently "fix" with an unrequested design;
  worth hardening if the worker-integration phase ever calls with `p_limit > 1`.
- **`sweep_stale_match_review_deck_jobs` and `mark_dead_match_review_deck_jobs`
  are separate functions, diverging from the `audio_feature_backfill_job`
  precedent** (which folds dead-lettering into its sweep). The orchestration
  spec asked for three distinct deck-job functions; splitting them also reads
  cleaner: sweep only reclaims a stale heartbeat when attempts remain, dead-
  lettering only fires on exhausted attempts regardless of heartbeat state.
- **Added a composite FK from `match_review_proposal_seed_pair(proposal_id,
  subject_position)` to `match_review_proposal_subject(proposal_id, position)`**
  — not explicitly requested, but free given the natural composite key and
  consistent with how tightly the rest of the MSR schema enforces subject
  linkage (e.g. `match_review_item_visible_pair` FKs to `match_review_queue_item`).
- **Added two supporting indexes beyond the plan's literal list**:
  `match_review_proposal(account_id, orientation, status)` for the "find a
  ready proposal" read-path query the plan describes in §8, and
  `match_review_deck_job(account_id, orientation) WHERE status = 'running'`
  for the claim function's NOT EXISTS check and general "is X running"
  queries.
- **`supabase db reset` is blocked by a global safety hook** (`❌ supabase db
  reset is blocked (wipes the database)`), so the from-scratch replay the
  acceptance criteria asked for could not be run directly. Verified instead by
  (1) `supabase migration repair --status applied` for three prior-phase
  migrations that were applied to the local DB but never recorded in
  `supabase_migrations.schema_migrations` (a pre-existing gap, not introduced
  here), then (2) `supabase migration up --local`, which applied all four new
  migrations cleanly with no errors. Followed by a manual transactional smoke
  test of all three deck-job functions (claim serializes per account+
  orientation, sweep reclaims a stale heartbeat, mark_dead dead-letters
  exhausted attempts), then `ROLLBACK` so no test data was left behind.

## Phase 1b — RPCs

Files added: `20260706000007_read_match_deck_card_rpc.sql`,
`20260706000008_start_or_resume_match_deck_rpc.sql`,
`20260706000009_extend_deck_action_rpcs.sql`.

- **`read_match_deck_card` is VOLATILE, not STABLE** — it folds in the
  `presented_at` newness write (replacing `markMatchReviewItemPresented`), so it
  mutates. `present_match_review_item_fast` (its playlist-arm template) stayed
  STABLE; this generalization cannot.
- **`p_mark_presented BOOLEAN DEFAULT true` param** — added so a NEXT card can be
  read without stamping `presented_at` (only the CURRENT card is marked). The
  mark is placed right after the ownership/found check, before the status
  branches, so a not-yet-captured current card is still marked surfaced (matches
  the old markMatchReviewItemPresented, which fired on card presentation).
- **Song-arm card JSONB shape** — top-level keys kept parallel to the playlist
  arm: `item` (with `song_id`), `song` (the subject), `suggestions` (playlist
  rows), `total_active_count`. Suggestion rows carry raw playlist columns
  (`playlist_id, name, match_intent, image_url, spotify_id, song_count`) plus
  `fit_score, visible_rank, model_rank`, display-ordered `fit_score DESC,
  model_rank ASC, playlist_id ASC` (playlist_id is the suggestion-side stable
  tiebreak, mirroring the playlist arm's `song_id ASC`). Playlist arm returns the
  byte-identical shape `present_match_review_item_fast` returns so the Phase 3 TS
  parser reuses `PresentMatchReviewItemFastRpcResult` unchanged.
- **Song subject folds in the decorative audio-feature + latest-analysis reads**
  (`song_audio_feature` UNIQUE(song_id); `song_analysis` latest by `created_at`),
  both nullable — so a song card renders from ONE round trip, matching what
  `fetchSongOrientationData` reads today and letting a future parser reuse
  `mapSongOrientationRows`. This goes slightly beyond the brief's literal "join
  `song`" but is what "match the field names the current song-card read path
  uses" requires. `audio_feature` is emitted as null when the record is all-null
  or absent (RECORD `IS NULL`), which collapses a present-but-all-null audio row
  to null — immaterial for rendering.
- **Status vocabulary** — playlist arm keeps `not_found | not_captured |
  playlist_gone | no_visible_suggestions | ready`; song arm mirrors with
  `song_gone` (subject song row missing) in place of `playlist_gone`. The old
  `not_playlist` wrong-path status is dropped: `read_match_deck_card` branches on
  orientation, so there is no wrong-path.
- **`start_or_resume_match_deck` returns a top-level `status` discriminator**
  (`active` | `miss`) that `MatchDeckView` (plan §4) does not carry, so one RPC
  can express both the full view and the miss. `miss` → `{status, reason:
  'no_ready_proposal'}`; "no snapshot at all" is folded into the same miss (the
  brief says the RPC just reports the miss; TS distinguishes).
- **Promotion race handling** — the session INSERT is wrapped in a
  `BEGIN … EXCEPTION WHEN unique_violation` subtransaction; the loser re-reads
  the winner's active session and skips the promotion steps (guarded by a
  `v_created` flag), then both paths return the same active view. Honors the
  one-active-per-orientation invariant without failing the request.
- **Seed promotion activates seeded items** (`state pending→active`) and stamps
  `visible_pairs_captured_at` on EVERY seed-window subject — even one whose pairs
  were all dismissed (a captured-empty card) — taking seeded positions from
  `match_review_proposal_seed_pair`. This mirrors
  `capture_match_review_item_visible_pairs_atomic`'s timestamp-and-activate
  semantics. Dismissed-exclusion gaps in `visible_rank` are fine (the unique
  index needs uniqueness, not density; the read orders by fit_score).
- **capture_ahead idempotency-key scheme:
  `capture:{account}:{orientation}:{session}:{resume_position}`** — promotion uses
  `:0`. Suggestion-level actions reuse the CURRENT `resume_position` (card stays
  put) so repeated add/dismiss-suggestion on one card dedupe to a single pending
  job; whole-card actions use the ADVANCED position, minting a fresh key per card.
  `resume_position` NULL (legacy session) folds to the literal `none`. Enqueued on
  ALL FOUR actions via `ON CONFLICT (idempotency_key) WHERE status NOT IN
  ('completed','dead') DO NOTHING` against the active-only unique index. This is
  how the brief's "all 4 insert a capture job" reconciles with §9's "whole-card
  actions advance the deck": revision-bump + capture-job are universal; only
  whole-card actions move `resume_position`.
- **`resume_position` "past the end" convention** — whole-card actions set
  `resume_position` to the next unresolved item's position strictly AFTER the
  just-resolved item's position; when none remains, to `max(position)+1` over the
  session (one past the last item). `caughtUp` is derived from `remaining==0`, not
  from this sentinel; the sentinel just guarantees no item sits at that position
  so `start_or_resume_match_deck`'s `cards.current`/`cards.next` resolve to null
  when the deck is caught up.
- **Action RPCs KEEP `RETURNS TEXT`; the rich JSONB return is DEFERRED to
  Phase 3 (orchestrator decision).** The four RPCs returned a bare status string
  that current callers parse verbatim (`isAddQueueItemDecisionAtomicStatus(data)`
  etc.) and that the live integration test asserts on. Adding
  `deck_revision`/`progress`/`next_card` to the payload would require a
  TEXT→JSONB return-type change (a `DROP FUNCTION` + recreate, not a truly
  additive `CREATE OR REPLACE`), which breaks every unchanged caller at runtime.
  Rather than ship that break mid-branch, Phase 1b adds ONLY the pure-write deck
  side effects (below) via `CREATE OR REPLACE` with the signatures and every
  return string byte-for-byte unchanged, so the live `/match` action flow and the
  integration test keep working through Phases 1b–2. The rich return
  (deck_revision/progress/next_card) moves to Phase 3, where it lands atomically
  with its sole consumer `submitMatchDeckAction` and the caller/query updates —
  and `read_match_deck_card` is called from the action RPCs only there, not here.
- **capture_ahead idempotency-key scheme (now the ONLY action-RPC change besides
  `deck_revision`/`resume_position`)**: `capture:{account}:{orientation}:{session}:{resume_position_after}`,
  enqueued on ALL FOUR actions via `ON CONFLICT (idempotency_key) WHERE status
  NOT IN ('completed','dead') DO NOTHING`. Suggestion-level actions reuse the
  CURRENT `resume_position` (card stays put → repeated add/dismiss-suggestion on
  one card dedupe to a single pending job); whole-card actions use the ADVANCED
  position, minting a fresh key per card. `resume_position` NULL (legacy session)
  folds to the literal `none`. This is how the brief's "all 4 insert a capture
  job" reconciles with §9's "whole-card actions advance the deck": revision-bump +
  capture-job are universal; only whole-card actions move `resume_position`.

### LOCAL VERIFICATION REQUIRED (Phase 1b)

Deferred to a local Postgres pass (no live DB in this cloud env):

- `bun run gen:types` — regenerate for the two NEW RPCs (`read_match_deck_card`,
  `start_or_resume_match_deck`). The four action RPCs are UNCHANGED in return type
  (still `TEXT`), so their generated types and every existing caller +
  `match-event-log.integration.test.ts` remain valid — no TS caller follow-up is
  needed in Phase 1b (that moves to Phase 3 with the JSONB return).
- Migration replay from scratch (`supabase db reset` / `migration up`) to confirm
  007→009 apply cleanly, including the `CREATE OR REPLACE` of the four action RPCs
  and the `ON CONFLICT … WHERE status NOT IN (...)` partial-index inference.
- Live smoke: `read_match_deck_card` both orientations (ready / not_captured /
  gone / no_visible_suggestions); `start_or_resume` branches 1/2/3 (active hit,
  promotion incl. concurrent-promotion race, miss); each action RPC's TEXT status
  unchanged AND its deck side effects (revision bump, capture-job dedupe,
  whole-card `resume_position` advance); and that the `song_audio_feature`/
  `song_analysis` fold-in matches `fetchSongOrientationData`.

### Carry-forward to Phase 3 (from the 1b review)

- `start_or_resume_match_deck` can return `snapshotId: null` for a legacy active
  session that has no `active_proposal_id` and no
  `match_review_session_snapshot` ledger row; plan §4 types `snapshotId` as
  `string`. Phase 3's `MatchDeckView` parser must tolerate a null `snapshotId`
  (coerce / treat as "unknown snapshot") rather than assume non-null.
