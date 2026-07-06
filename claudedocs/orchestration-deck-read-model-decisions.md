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

## Phase 2 — Worker

Files added: `src/lib/data/deck-db-types.ts`,
`src/lib/domains/taste/match-review-queue/deck-jobs.ts`,
`.../eligible-subjects.ts`, `.../proposal-builder.ts`, `.../session-appender.ts`,
`.../card-materializer.ts`, `.../card-suggestion-caps.ts`,
`src/worker/poll-match-deck-jobs.ts`,
`supabase/migrations/20260706000010_enqueue_match_review_deck_job.sql`, and the
two parity suites `__tests__/proposal-order-parity.test.ts` /
`__tests__/seed-pair-parity.test.ts`.
Files edited: `src/worker/index.ts`, `src/worker/execute.ts`,
`.../match-review-queue/service.ts`,
`src/lib/server/match-review-queue.functions.ts`,
`src/worker/__tests__/execute.test.ts`.

### Rulings as applied

- **R1 — `append_sessions` does NOT touch `appendSnapshotDelta`, and that stays
  deletable for Phase 5.** `appendSessionsForAccountOrientation`
  (`session-appender.ts`) loads the READY proposal for the
  account+orientation+snapshot under the active session's frozen-strictness
  `visibility_config_hash`, reads its `match_review_proposal_subject` rows, drops
  subjects already in the session queue, and inserts the rest via the EXISTING
  `insertQueueItems` / `insertQueuePlaylistItems` wrappers + the
  `insertSessionSnapshot` ledger. **Factoring chosen:** it shares the *machinery*
  (the `./queries` insert RPCs + ledger + dedupe helpers), NOT `appendSnapshotDelta`
  itself — rather than extracting `appendSnapshotDelta`'s apply-tail into a common
  helper (R1's "preferred" option). Rationale: extraction would have edited
  `appendSnapshotDelta` and risked its `service.test.ts` coverage; the independent
  implementation reusing the same `./queries` wrappers is equally Phase-5-safe
  (deleting `appendSnapshotDelta` touches neither the wrappers nor the appender)
  and lower-risk. "The derivation moves, the machinery stays" is honored via the
  shared `./queries` layer. No `TODO(phase5)` fallback was needed.
- **R1 "prior match_decisions" delta — interpreted as queue-membership dedupe.**
  Proposal subjects already exclude build-time-decided pairs (via
  `deriveProposalSubjects`), and `fetchQueuedSongIds`/`fetchQueuedPlaylistIds`
  select ALL session items regardless of state, so a resolved subject is
  "already queued" and excluded — matching exactly what `appendSnapshotDelta`
  does (it re-derives but its only queue-level dedup is the same set). No coarse
  per-subject decision re-fetch was added (it would over-exclude a song with a
  remaining undecided pair and diverge from `appendSnapshotDelta`). Residual: a
  subject decided in a *different* session between build and append can
  transiently append as an empty card — self-healing at card read, and near-nil
  since build chains append back-to-back. Flagged for the live-DB pass.
- **R2 — publish→build enqueue chained in `execute.ts`'s
  `executeMatchSnapshotRefreshJob`** (after the post-publish PostHog block,
  guarded on `result.published && result.snapshotId`), enqueuing `build_proposals`
  for BOTH orientations, key `build:{account}:{orientation}:{snapshot}`,
  best-effort (Sentry per orientation on enqueue failure, never a throw — the
  snapshot is durable and the read path self-heals). Deviation from plan §6's
  literal "inside `executeMatchSnapshotRefresh`": the pure orchestrator has 3
  return points and unit-test mocks, so the worker-boundary job is the equivalent
  seam. The `build_proposals` handler chains `append_sessions`
  (`append:{account}:{orientation}:{snapshot}`) on success.
- **R3 — NOTIFY fast path skipped.** No `notify-listener.ts` change and no
  `pg_notify` in the enqueue RPC. The poll loop covers pickup; the plan makes the
  fast path explicitly optional. Deferred optional optimization.
- **R4 — `SONG_CARD_SUGGESTION_CAP = 100`**, mirroring
  `PLAYLIST_CARD_SUGGESTION_CAP` (no reason for the arms to differ). Co-location
  decision: BOTH caps moved to a new domain module
  `card-suggestion-caps.ts` (they are co-located with each other), and
  `match-review-queue.functions.ts` now imports `PLAYLIST_CARD_SUGGESTION_CAP`
  from there. Deviation from the literal "co-locate in the server-fn file": the
  worker's `card-materializer` must import the caps but cannot import that
  server-fn file (it pulls `@tanstack/react-start` into the worker bundle), so the
  domain module is the shared home. The server test references the value only in
  comments, so nothing broke.
- **R5 — `enqueue_match_review_deck_job` migration added**
  (`20260706000010_...`): `INSERT ... ON CONFLICT (idempotency_key) WHERE status
  NOT IN ('completed','dead') DO NOTHING`, SECURITY DEFINER, `SET
  search_path=public`, REVOKE from PUBLIC/anon/authenticated + GRANT service_role,
  `RETURNS SETOF match_review_deck_job` (0 or 1 row). No `pg_notify` (R3). All
  enqueues route through it because supabase-js `.upsert` can't target the partial
  index predicate.

### Other Phase-2 decisions

- **Escape hatch (`deck-db-types.ts`) surface.** A synthetic `DeckDatabase` +
  `deckDb()` cast covers ONLY: the 4 new tables (`match_review_deck_job`,
  `match_review_proposal`, `_subject`, `_seed_pair`), the 4 deck RPCs
  (`claim/sweep/mark_dead/enqueue`), AND — added beyond the spec's list —
  `match_review_session`'s Phase-1a deck columns (`active_proposal_id`,
  `deck_revision`, `resume_position`), which are ALSO absent from the ungenerated
  types. Call sites through `deckDb()`: `deck-jobs.ts` (all RPCs + settlement
  UPDATEs), `proposal-builder.ts` (proposal/subject/seed writes + stale-marking),
  `session-appender.ts` (ready-proposal + subject reads), and
  `card-materializer.readSessionResumePosition` (the `resume_position` read).
  Everything else (queue items, `insert_queue_*`, `capture_*`, entitlement RPCs,
  `select("*")` on `match_review_session` via `fetchActiveSession`) uses the
  normal generated-type client. The file's header marks it deletable; the swap
  after `gen:types` is mechanical.
- **Settlement by direct UPDATE.** No complete/defer settlement RPC exists and the
  table has no fencing column, so `completeDeckJob`/`deferDeckJob`/`heartbeatDeckJob`
  are plain `deckDb().from("match_review_deck_job").update(...)` by id. `attempts`
  was consumed at claim, so defer = re-`pending` with a future `available_at`
  (30s) + null heartbeat; `mark_dead` terminalizes exhausted attempts on the sweep
  tick. Client-clock timestamps are used (no DB `now()` in a supabase-js update) —
  acceptable against the 900s lease.
- **Worker concurrency = 1, claim `p_limit = 1`.** The claim's NOT EXISTS
  self-join only sees committed running rows, so a single-slot poller is the only
  safe drain shape (Phase-1a note). Mirrors the audio-backfill loop wiring in
  `index.ts` (startup sweep, sweep timer, shutdown stop, drain guard, awaited loop).
- **`deriveProposalSubjects` returns the `filtersByPlaylistId` it read** so the
  builder computes `visibility_config_hash` / `read_time_filters_hash` from the
  exact same filter map + the one shared `nowMs` — keeping the proposal key
  byte-identical to what `appendSnapshotDelta` would compute (UTC-today folding
  parity). Cost: match results + target filters are fetched once per preset (3×);
  accepted for Phase 2 (plan §6 calls 3× cheap), noted as a possible memoization.
- **`PROMOTION_SEED_SUBJECTS = 3`**, **`CAPTURE_AHEAD_WINDOW = 5`** — new constants
  (neither pinned by the plan). Seed is a small promotion window; capture-ahead
  keeps a fast swiper from outrunning capture. Both in the domain modules that use
  them.
- **Seed derivation reuses `computeVisibleSuggestionList` via a synthetic queue-item
  DTO** (only `subject`/`accountId`/`sourceSnapshotId` are read by it), capped per
  orientation before writing seed rows, so the seed mirrors what a card would
  capture. Pure mapping helpers `orderedSubjectsToProposalSubjectRows` /
  `visibleSuggestionsToSeedPairRows` are exported and driven directly by the parity
  suites.
- **Parity-suite approach.** Both suites are DB-free: they mock `@/lib/data/client`
  and drive the pure `deriveEligibleSubjects` / `deriveVisibleSuggestions` on inline
  fixtures (the `review-subject-selector.test.ts` / `visible-suggestion-list.test.ts`
  pattern — the referenced tests themselves use inline data, not the `*-raw.json`
  harness). `proposal-order-parity` asserts the proposal-subject position order
  equals the derived subject order and guards that both derivation entrypoints are
  exported from the one shared `eligible-subjects.ts` (agree by construction).
  `seed-pair-parity` asserts the seed rows equal `deriveVisibleSuggestions` output
  field-for-field.
- **`build_proposals` is rebuild-safe** — the proposal upserts on its unique key
  and subjects are deleted-then-reinserted (cascading seed rows), so a
  sweep-resurrected double-run converges. `repair` reuses
  `buildProposalsForAccountOrientation`, resolving the latest snapshot when its
  payload omits `snapshotId`.
- **`execute.test.ts` fix (not a weakening).** The R2 enqueue is a new dependency
  of `executeMatchSnapshotRefreshJob`; the analytics-swallow test asserted an exact
  Sentry count and broke because the unmocked deck client captured on failure. Root
  cause: (a) `enqueueDeckJob` was unmocked, now mocked to `Result.ok(null)`; (b) a
  pre-existing latent bug — `mockCaptureWorkerEvent`'s throw impl leaked past
  `clearAllMocks` (which doesn't reset implementations) into later tests, fixed with
  a `mockReset()` in `beforeEach`. Added R2 coverage: both-orientation enqueue keys,
  best-effort swallow, and no-enqueue-on-no-publish.

### LOCAL VERIFICATION REQUIRED (Phase 2)

All live-DB verification is deferred (no Postgres in this cloud env). A local-DB
machine must verify:

- **Migration replay** `20260706000010` applies cleanly and the enqueue RPC's
  `ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed','dead') DO
  NOTHING` binds the partial index
  `idx_match_review_deck_job_idempotency_key_active`
  (`20260706000005_..._deck_job_table.sql:61-63`).
- **`bun run gen:types`** regenerates `database.types.ts` to include the 4 deck
  tables, the deck columns on `match_review_session`, and the deck RPCs — then
  DELETE `deck-db-types.ts`, swap every `deckDb()` → `createAdminSupabaseClient()`,
  and confirm the real Row/Insert shapes match this file's (payload jsonb → `Json`,
  nullable `session_id`/`heartbeat_at`/`resume_position`).
- **Idempotent double-run** (no fencing column): re-running each handler
  (build/append/capture, e.g. a sweep-resurrected job) must converge — proposal
  upsert + delete/reinsert, `insert_queue_*` ON CONFLICT DO NOTHING, and
  `captureVisiblePairsAtomic` first-write-wins.
- **Subject-order parity vs the entitlement/ownership prefilters** against a real
  snapshot: `deriveProposalSubjects` applies `select_entitled_...` +
  `fetchOwnedPlaylistIds` (which `getOrderedUndecidedSubjects` alone does NOT), so
  proposal order must equal `appendSnapshotDelta`'s. Run the §12 read-only
  shadow-compare script.
- **`nowMs` UTC-midnight folding**: the builder's `visibility_config_hash` must
  equal `appendSnapshotDelta`'s for the same policy across a midnight boundary
  (liked-at "today" filter).
- **Entitlement/ownership parity** at capture: `capture_ahead`'s per-card
  `computeVisibleSuggestionList` output (and its caps) must match the request-path
  card, and a mid-flight decision must be re-excluded by `captureVisiblePairsAtomic`
  on the next derive (capture-ahead DTO freshness).
- **`append_sessions` residual** (see R1 note): a subject decided in a different
  session between build and append should self-heal to an empty card, not a wrong
  or duplicated one.
- **End-to-end drain**: publish → `build_proposals` (both orientations, all
  presets) → chained `append_sessions` → `capture_ahead`, plus `sweep`/`mark_dead`
  reclaim/dead-letter behavior and the `index.ts` startup sweep + shutdown drain.

### Review patch round (M2 / M3 / N1 applied; M1 / M4 residual)

- **M3 fixed** (`proposal-builder.ts`) — the "mark prior proposals stale" step now
  runs ONLY when the built snapshot IS the account's latest
  (`getLatestMatchSnapshot` id equality guard) before the existing
  `.neq("snapshot_id", …)` update, so building/repairing an OLDER snapshot can no
  longer flip a newer snapshot's `ready` proposals to `stale`. Approach (b) over
  (a): a correlated `match_snapshot.created_at` subquery isn't expressible as a
  clean single supabase-js `.update()`, and the id-list variant would violate the
  DB-derived-id-set `.in()` rule.
- **M2 fixed** (`session-appender.ts` + `poll-match-deck-jobs.ts`) — the appender
  reads `status` instead of filtering `.eq("status","ready")` and returns a new
  `{ kind: "superseded" }` outcome when a proposal row EXISTS for the frozen hash
  but is `stale` (a newer snapshot took over); the poll loop lets `superseded`
  fall through to `completeDeckJob` (no defer, no dead-letter, no Sentry). A
  genuinely-absent row (or one still `building`/`failed`) keeps the retryable
  `no_ready_proposal` path.
- **N1 fixed** (`poll-match-deck-jobs.ts`) — `completeDeckJob`/`deferDeckJob`
  Results are now checked via a `logSettlementFailure` helper that `log.error`s
  (job id + kind + settlement) on a failed settlement write; control flow is
  unchanged (the sweep still reclaims), the failure is just no longer silent.
- **M1 residual** (append decision re-check divergence) and **M4 residual**
  (midnight UTC-rollover `visibility_config_hash` skew) remain as recorded
  self-healing residuals — an empty transiently-appended card resolves at card
  read, and a rollover-skewed append lands `no_ready_proposal` → retry/self-heal.
  Both to be verified in the local-DB pass (see LOCAL VERIFICATION REQUIRED).

## Phase 3 — Server contracts

New files: `src/lib/domains/taste/match-review-queue/suggestion-cursor.ts`,
`.../deck-read-queries.ts`, `src/lib/server/match-deck.functions.ts`,
`src/lib/server/match-deck-miss-path.ts`,
`src/features/matching/deck-queries.ts`, plus three test suites
(`__tests__/suggestion-cursor.test.ts`,
`src/lib/server/__tests__/match-deck.functions.test.ts`,
`src/features/matching/__tests__/deck-queries.test.ts`).
Files edited (compile-forced only): `src/lib/data/deck-db-types.ts` (E3),
`src/lib/server/match-review-queue.functions.ts` (E1 song-arm fields + 2 legacy
constructors, E2 cursor collapse),
`src/lib/domains/taste/match-review-queue/proposal-builder.ts` (E4 export),
`src/features/matching/__tests__/mutations.test.ts` (E1-forced song-ready
fixture gains the 2 new fields).

### Rulings as applied

- **R-A (read-after-write, no return-type migration).** `submitMatchDeckAction`
  takes the plan §4 `MatchDeckAction` discriminated union (no orientation on the
  wire), loads the owned queue item to resolve orientation, dispatches to the
  EXISTING atomic wrappers (`addQueueItemDecisionAtomically` /
  `dismissQueueItemSuggestionAtomically` / `finishQueueItemAtomically` /
  `dismissQueueItemAtomically` — all still `RETURNS TEXT`), captures the raw TEXT
  status, then calls the shared `resolveMatchDeckView` and returns
  `{ actionStatus, view }`. No action-RPC return type changed; no legacy caller
  touched. Deviation from the blueprint's literal "load the item only for the 2
  suggestion actions": the item is loaded for ALL FOUR actions — the suggestion
  actions need it for orientation-aware column routing anyway, and finish/dismiss
  need the same orientation to rebuild the view (the input carries none). A
  missing/foreign item throws (stale client → refetch) rather than fabricating a
  view for an unknown orientation.
- **R-B (miss path = approach X).** `buildFirstWindowAndPromote`
  (`match-deck-miss-path.ts`) reuses the now-exported `buildOneProposal` as-is for
  the CURRENT preset, re-invokes `start_or_resume_match_deck` with the SAME
  `visibilityConfigHash`, then best-effort `enqueueDeckJob` the full
  `build_proposals` (`build:{account}:{orientation}:{snapshot}`, payload
  `{snapshotId}`). ONE `nowMs` is threaded from `resolveMatchDeckView` into both
  `computeVisibilityPolicyHash` (the RPC hash) and `buildOneProposal` (which
  derives its own hash from the same filters + nowMs) so branch-2 is a guaranteed
  in-request hit. No new plpgsql. No-snapshot → `{ status: "building" }`.
- **Deviation from §8.3 "bounded first-window scan" (recorded).** Approach X
  derives the FULL current-preset subject list on a miss (≈ the pre-refactor
  baseline cost, not a true bounded first-window scan). Accepted because a miss is
  rare (§13), self-heals, and the enqueued full build makes the next entry a hit.
- **R-C (cursor collapse).** All 4 sites collapsed onto the one pure helper
  `deriveSuggestionNextCursor(rows, pageSize, total?)`: the 3 first-page sites in
  `match-review-queue.functions.ts` (`readPlaylistCardFromCapture`, its legacy
  twin, the present-fast branch) pass `PLAYLIST_CARD_FIRST_PAGE_SIZE` +
  `suggestionTotal`; the tail site omits `total` (a full tail page always earns a
  cursor). The deck-card mapper is the 5th consumer. Behavior byte-identical to
  the prior inline ternaries (verified: the existing suite still passes).
- **R-D (song-arm pagination fields).** `MatchReviewItemRead` song ready arm gains
  required `suggestionTotal: number` + `nextCursor: QueueItemSongSuggestionCursor |
  null`; the 2 legacy song-arm constructors set
  `suggestionTotal = min(len, SONG_CARD_SUGGESTION_CAP)`, `nextCursor: null`. The
  deck song-card mapper does the same. **Limitation (recorded):** song `nextCursor`
  is ALWAYS null in Phase 3 — song suggestions are playlists and the cursor type is
  song-keyed (`{fitScore, modelRank, songId}`), and there is no song-mode tail
  endpoint. Song decks therefore read the whole capped set in one shot (window =
  `SONG_CARD_SUGGESTION_CAP`); a live check that prod song cards stay ≤ the cap is
  deferred.
- **R-E (`not_captured` on-demand materialize).** Implemented in the
  `readMatchDeckCard` server fn only: on a `not_captured` RPC result it loads the
  item's session/orientation/position, reuses `captureAheadForSession({… window:
  1})`, re-reads ONCE with `p_mark_presented=true`, and if still `not_captured`
  the mapper's `retryable-error` fallback applies. The pure `mapReadDeckCardToItemRead`
  maps `not_captured → retryable-error` (the terminal fallback). **Open item:** the
  deck VIEW's baked current/next cards do NOT run R-E — a `not_captured` baked card
  maps to `retryable-error` and the client re-fetches it via `readMatchDeckCard`
  (which does R-E). Normally the current card is captured (seed window / capture-
  ahead), so this is the rare cold edge; whether the deck view's current card also
  needs R-E is flagged for the live-DB pass.
- **R-F (`snapshotId: null` tolerance).** `mapStartOrResumeToView` coerces a null
  `snapshotId` → `""` (the `EMPTY_MATCH_REVIEW_RESULT.sessionId=""` precedent) and
  emits a `Sentry.addBreadcrumb` (category `match_deck`, level warning); it never
  throws. `MatchDeckView.snapshotId` stays typed `string` per plan §4.

### Other Phase-3 decisions

- **Module layout.** Contract types + the 3 server fns + the 2 exported mappers
  (`mapReadDeckCardToItemRead`, `mapStartOrResumeToView`) + private
  `resolveMatchDeckView`/`resolveDeckCard`/`loadOwnedItem`/`materializeOnDemand`
  live in `src/lib/server/match-deck.functions.ts`. The two deck-read RPC wrappers
  + their raw result interfaces live in the DOMAIN layer
  (`deck-read-queries.ts`), mirroring `callResumeMatchReviewSession` /
  `callPresentMatchReviewItemFast` in `queries.ts`. The miss composition is its own
  server-layer file (`match-deck-miss-path.ts`) so `match-deck.functions.ts`
  imports one symbol and the miss logic is unit-isolatable. The shared cursor
  helper is a pure domain module.
- **The deck contract types (`MatchDeckView`, `MatchDeckCard`, `MatchDeckAction`,
  `MatchDeckBuildingState`, `StartOrResumeMatchDeckResult`,
  `SubmitMatchDeckActionResult`) live in `match-deck.functions.ts`** (verbatim from
  plan §4), co-located with their sole producers. `StartOrResumeMatchDeckResult =
  MatchDeckView | MatchDeckBuildingState` is discriminated by `version` (view) vs
  `status:"building"` — MatchDeckView carries no `status` field, per §4 verbatim.
- **`resolveMatchDeckView` factoring.** ONE private function does nowMs → minScore
  → preset → target-filters → hash → RPC → (active ? map : miss handling), shared
  by `startOrResumeMatchDeck` and the read-after-write of `submitMatchDeckAction`.
  This is the single seam where the request hash is computed, keeping the R-B
  byte-identity invariant in one place.
- **Deck suggestion window is orientation-based.** Playlist decks bake first-page
  (`PLAYLIST_CARD_FIRST_PAGE_SIZE = 8`, mirrored as a local const — a first-paint
  tuning number, not a shared contract) with a tail cursor; song decks bake the
  whole capped set (`SONG_CARD_SUGGESTION_CAP = 100`, nextCursor null). The
  standalone `readMatchDeckCard` uses window `SONG_CARD_SUGGESTION_CAP` (=100 =
  both caps) because orientation is unknown up front — never truncates either arm;
  a playlist card read on navigation therefore returns up to 100 rows (nextCursor
  null) rather than a first page, trading first-paint size for orientation
  simplicity (navigation is off the SSR-critical path).
- **Escape-hatch additions (E3).** `deck-db-types.ts` `Functions` gains
  `start_or_resume_match_deck` and `read_match_deck_card`, both `Returns: Json`
  (the wrappers `as unknown as` narrow); the header "Migrations mirrored" list adds
  007 + 008. No hand-edit to `database.types.ts`.
- **`MatchReviewItemRead` imported type-only** into `match-deck.functions.ts` (and
  the render types from `matching.functions.ts`) so the big server-fn file is NOT
  pulled into `match-deck.functions.ts`'s runtime module graph; a local
  `OrientationSchema` avoids importing `MatchOrientationSchema` as a value.
- **Test approach (DB-free).** `match-deck.functions.test.ts` mocks
  `deck-read-queries`, the 4 atomic wrappers + `fetchTargetPlaylistFilters` +
  `mapItemToDto`, `resolveMinMatchScore`, `getLatestMatchSnapshot`,
  `captureAheadForSession`, and `../match-deck-miss-path` (`buildFirstWindowAndPromote`
  mocked to isolate miss→build→active from `buildOneProposal`'s DB writes); the pure
  hash/caps/cursor helpers run for real. Covers ready song+playlist mapping,
  suggestionTotal capping, nextCursor full-page vs partial, every non-ready status,
  `snapshotId:null` no-throw + breadcrumb, miss→building, miss→build→active,
  miss→build-still-misses→building, R-E materialize-and-re-read, and each action
  dispatch incl. orientation-aware suggestion routing (song vs playlist column).

### Post-review PATCH round (SHIP + NITs)

Review returned SHIP; two NIT-level fixes applied. (1) **Copy parity:** the deck
`mapReadDeckCardToItemRead` `no_visible_suggestions` branch now reuses the legacy
`noVisibleSuggestionsMessage(orientation)` (exported from
`match-review-queue.functions.ts`) instead of a hardcoded generic — the deck read
now emits the same orientation-aware copy as `readPlaylistCardFromCapture`. The
mapper gained an `orientation: MatchOrientation | null` arg: the deck VIEW threads
the single deck orientation (always correct); the standalone `readMatchDeckCard`
GET passes the orientation only when the payload carries it (`ready`, or the
post-materialize re-read) and `null` otherwise — the `no_visible_suggestions`
payload omits orientation, so `null` falls back to the orientation-neutral copy
rather than risk a mislabel. (2) **Miss-path test:** added
`__tests__/match-deck-miss-path.test.ts` (DB-free, mirrors the
`match-deck.functions.test.ts` scaffold — mocks `buildOneProposal`,
`callStartOrResumeMatchDeck`, `enqueueDeckJob`, `captureServerError`) covering
happy path (build→re-invoke active + enqueue key/kind assertion), **enqueue
`Result.err` never fails the request** (the previously-untested best-effort point),
`buildOneProposal` error surfaces without promoting, and a still-miss re-invoke
returned unchanged (caller maps to building). Remaining NITs — the GET
`readMatchDeckCard` doing idempotent `presented_at` writes (per spec §7) and the
documented R-B/R-E residuals — are accepted for the local-DB pass.

### LOCAL VERIFICATION REQUIRED (Phase 3)

All live-DB verification is deferred (no Postgres in this cloud env):

- **Request hash ≡ worker proposal hash (load-bearing).** Else every entry is a
  miss (right output, wrong cost). `resolveMatchDeckView`'s
  `computeVisibilityPolicyHash(policy, nowMs)` and `buildOneProposal`'s internally
  derived hash must be byte-identical for the same account/orientation/preset —
  both read `fetchTargetPlaylistFilters` and fold the same `nowMs`. Verify a normal
  entry is a branch-2 HIT, and that the miss path's re-invoke lands active (not a
  second miss). Note the small residual: the two `fetchTargetPlaylistFilters`
  reads (RPC-hash side + `buildOneProposal` side) are separate; a filter change
  between them would skew the hash → transient miss loop, self-heals next request.
- **`bun run gen:types` swap.** Regenerate for the two deck read RPCs, then delete
  `deck-db-types.ts`, swap `deckDb()` → `createAdminSupabaseClient()`, and drop the
  `as unknown as` narrows where the generated Row/Return shapes now type the calls.
- **`snapshotId:null` coercion renders** and no downstream deck cache key breaks on
  `""`.
- **song `nextCursor` contract-only (null):** confirm prod song cards stay ≤
  `SONG_CARD_SUGGESTION_CAP` (no 2nd page needed).
- **`not_captured` on-demand materialize** re-read returns ready with acceptable
  latency; confirm whether the deck VIEW's baked current card also needs R-E (see
  R-E open item) or is reliably captured by the seed/capture-ahead.
- **branch-2 promotion fires after the single-preset build** (queue items + seed
  copy + ledger + capture_ahead job).
- **resume_position advance → follow-up view returns the promoted (not
  just-resolved) card** — i.e. `submitMatchDeckAction`'s read-after-write reflects
  the advanced deck.
- **same-snapshot/different-hash proposal duplication at UTC-midnight stays
  benign.**
- **`total_active_count` bigint→number** for 845-suggestion cards (no precision
  surprise in `suggestionTotal` / cursor derivation).
