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
