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

## Phase 4 — Route cutover

Files edited: `src/routes/_authenticated/match.tsx` (full route/component rewrite),
`src/features/matching/mutations.ts`, `src/features/matching/useMatchReviewCard.ts`,
`src/features/matching/queries.ts` (`runMatchSnapshotRefreshEffects`),
`src/lib/hooks/__tests__/useActiveJobs.test.ts` (invalidation-count update),
`src/routes/_authenticated/__tests__/match.test.ts`,
`src/features/matching/__tests__/mutations.test.ts`,
`src/features/matching/__tests__/useMatchReviewCard.test.tsx`.
New files: `src/features/matching/deck-action-status.ts` +
`src/features/matching/__tests__/deck-action-status.test.ts`.

Scope honored: route/component cutover ONLY. NO legacy code deleted — the three
legacy query families (`matchReviewBootstrapQueryOptions`,
`matchReviewQueryOptions`, `presentMatchReviewItemQueryOptions`), the legacy
action server fns, `appendSnapshotDelta`, `presentMatchReviewItem`,
`markMatchReviewItemPresented`, and `bootstrapReadyMatchQueue` all still exist and
typecheck; the route just STOPS importing them (Phase 5 deletes them). Landed as
one coherent change (plan §10).

### Inherited-vs-applied

Verified the interrupted run's partial work against the blueprint and found it
correct — kept as-is: `deck-action-status.ts` classifier + test (tokens confirmed
against the four atomic status sets in `queries.ts:628-952` and the RPC bodies in
`20260706000009`); `mutations.ts` (`dismissSuggestionMutation` retargeted to the
deck card/tail keys + `submitMatchDeckAction` + classifier, RF-correct: keeps the
optimistic surgery, discards the returned view, rolls back on a non-`dismissed`
status); `useMatchReviewCard.ts` (tail query → `matchDeckCardSuggestionsInfiniteQueryOptions`,
dismiss boolean via the classifier); `queries.ts` (`runMatchSnapshotRefreshEffects`
adds `matchDeckKeys.deckRoot` invalidation alongside the legacy `reviewsRoot`,
keeps `syncActiveMatchReviewSessions`). Newly written this session: the whole
`match.tsx` rewrite, all three retargeted test suites, the new loader-inversion
tests, and the `useActiveJobs.test.ts` count fix (see below).

### Rulings as applied

- **RA — classifier** (`deck-action-status.ts`). `isDeckActionSuccess(type,
  actionStatus)` with per-type success-token sets: add-suggestion→`{added}`;
  dismiss-suggestion→`{dismissed}`; finish-card→`{completed_added, skipped}`;
  dismiss-card→`{dismissed}`. Everything else (incl. `already_added`,
  `not_visible`, `no_captured_pairs`, `already_resolved`, unknown/empty) is a
  rejection: do not advance / roll back. The action RPCs kept `RETURNS TEXT`
  (Phase 1b/3), so the route can't read a bool off the wire — the enumerated
  classifier is the seam.
- **RB — loader awaits + seeds.** `loaderDeps: ({search}) => ({mode})`; the loader
  short-circuits walkthrough (`sessionMode(...)==="walkthrough"`), else `await
  queryClient.ensureQueryData(matchDeckQueryOptions(accountId, deps.mode))` and, on
  `"itemIds" in view`, seeds `readMatchDeckCardQueryOptions(card.itemId).queryKey`
  from `view.cards.current/next.presentation`. `MatchLoading` is the route
  `pendingComponent` (covers cold SSR + the rare miss-path build); `MatchPending`
  deleted. The inner `<Suspense fallback={MatchLoading}>` stays — it re-engages
  only when Previous/Next lands on a card the loader/action didn't bake in.
- **RC — building recovery.** `QueueMatchPage` computes `isBuilding = !("itemIds"
  in view)`; a `useEffect` invalidates `matchDeckKeys.deck(accountId, mode)` when
  `isBuilding && firstVisibleMatchReady` (from `useActiveJobs`). Re-runs the bounded
  deck read whose miss path promotes the first window. Replaces
  `bootstrapReadyMatchQueue` (which the route no longer imports).
- **RD — no-context vs building.** The `{status:"building"}` branch routes through
  `deriveEmptyStateReason({hasQueue:false, caughtUp:false, isJobsActive,
  firstVisibleMatchReady, total:0, hiddenReviewItemCount:0})` — genuinely-no-setup →
  `no-context` ("set a matching intent"); jobs active or a first match ready →
  `building`.
- **RE — presented_at.** Deleted the client `markMatchReviewItemPresented` effect;
  `start_or_resume_match_deck` stamps the current card server-side and
  `read_match_deck_card` stamps on every real read. Residual recorded below.
- **RF — dismiss-suggestion keeps optimistic surgery, does NOT apply the view**
  (`dismissSuggestionMutation`, inherited). Whole-card actions (finish/dismiss-card)
  DO apply `result.view`: `applyResolvedView` writes it into the deck cache and
  advances the id pointer to `result.view.cards.current?.itemId ?? itemIds[0] ??
  null`.
- **RG — id-based Previous/Next preserved.** `resolveCurrentItemId(view.itemIds,
  currentItemId)` + `currentIndex = view.itemIds.indexOf(resolved)`; only the id-list
  SOURCE changed (deck view instead of `deriveUnresolvedIds(queue)`). Init pointer
  `view.cards.current?.itemId ?? itemIds[0] ?? null`.

### New loader/component shape

- Loader: `loaderDeps.mode` → await `ensureQueryData(matchDeckQueryOptions)` → seed
  the two baked card reads (skips the building state). Walkthrough returns void.
- `QueueMatchPage`: ONE `useSuspenseQuery(matchDeckQueryOptions(accountId, mode))`.
  Hooks (route context, navigate, queryClient, deck read, `useActiveJobs`, RC
  effect, latch ref, handlers) run before any branch; then building → empty state
  (RD), arrival-caught-up (`progress.caughtUp || cards.current===null`, gated by the
  `sessionStartedRef` latch) → empty state, else `QueueMatchContent key={mode}`.
- `QueueMatchContent`: navigates over `view.itemIds` (server authoritative — no
  `locallyResolvedIds`/`effectiveItemIds`); single exit invalidation
  (unmount + completion). `QueueCardContent`: `useSuspenseQuery(
  readMatchDeckCardQueryOptions(itemId))`; warm-ahead prefetch of `itemIds[i+1]`;
  actions dispatch `submitMatchDeckAction`.

### Per-action mapping

- **add-suggestion** (`handleAdd`): keeps the Spotify extension leg + `addedTo`/
  `sessionStats`; DB call → `submitMatchDeckAction({type:"add-suggestion",itemId,
  suggestionId})`; success gate `isDeckActionSuccess("add-suggestion", …)`. Does NOT
  advance, does NOT apply the view.
- **dismiss-suggestion** (`handleDismissSuggestion` → the hook's
  `dismissSuggestion`): optimistic cache surgery via `dismissSuggestionMutation`
  (RF); no navigation lock; analytics on confirmed dismiss.
- **finish-card** (`handleNext`, unavailable-skip): `submitMatchDeckAction({type:
  "finish-card",itemId})`; success `completed_added|skipped`; on rejection
  `onReleaseNavigation()`; on success `applyResolvedView(result.view)`.
- **dismiss-card** (`handleDismiss`): same shape, `type:"dismiss-card"`, success
  `dismissed`; keeps `waitForPendingDismisses()` before dispatch.

### Invalidation + building/caught-up wiring

- Exit handler (`invalidateSessionBoundary`, unmount + completion) invalidates
  `matchDeckKeys.deck(accountId, mode)` + `matchReviewSummaryKeys.summary(accountId,
  mode)` + `dashboardKeys.all`; completion keeps `analytics.capture(
  "matching_session_completed")`. `handleModeChange` keeps its preferredSummary +
  `dashboardKeys.all` invalidation.
- `runMatchSnapshotRefreshEffects` now also invalidates `matchDeckKeys.deckRoot`
  (legacy `reviewsRoot` retained until Phase 5). `MatchErrorComponent` `resetQueries`
  key `matchReviewKeys.all` → `matchDeckKeys.all`.

### Decision beyond the literal blueprint (recorded)

- **`applyResolvedView` seeds the promoted cards' read caches** (not only the deck
  cache). After a whole-card action it writes `result.view.cards.current/next.
  presentation` into `readMatchDeckCardQueryOptions(...).queryKey` — mirroring the
  loader seed — so the advance to the promoted card renders from cache instead of
  suspending. This realizes plan §9's "response carries the promoted next card …
  the client needs no follow-up fetch to keep swiping." A caught-up returned view
  (`cards.current===null`, or a `building` view) sets the pointer to `null` → the
  latch keeps `CompletionScreen` (or, on building, `QueueMatchPage` re-renders the
  RD empty state). The completion-effect refetch of `matchDeckKeys.deck` mirrors the
  prior queue refetch and is background (active observer, no suspense flash).

### Tests (DB-free)

- `match.test.ts`: inverted the loader contract — mocks `@/features/matching/deck-queries`
  + `@/lib/server/match-deck.functions`, drops the `markMatchReviewItemPresented`
  mock, asserts the loader awaits `matchDeckQueryOptions` and seeds current+next
  card caches (and seeds nothing for building / single-card). Kept beforeLoad
  mode-normalisation + walkthrough short-circuit.
- `mutations.test.ts`: pure `patch*` tests unchanged; `dismissSuggestionMutation`
  repointed to `readMatchDeckCardQueryOptions`/`matchDeckKeys.card(...)+"suggestions"`,
  mock `submitMatchDeckAction`, fixtures `{actionStatus:"dismissed"|"already_resolved",
  view}`, rollback keyed off the classifier.
- `useMatchReviewCard.test.tsx`: present key → `readMatchDeckCardQueryOptions`, dismiss
  mock → `submitMatchDeckAction` returning `{actionStatus, view}`, call-arg assertions
  gained `type:"dismiss-suggestion"`.
- `useActiveJobs.test.ts` (d): invalidation count 5→6 + `toContainEqual(matchDeckKeys.
  deckRoot)` — a faithful update reflecting the new deck invalidation, not a weakening.
- `deck-action-status.test.ts` (new, inherited): success + rejection per action,
  cross-type leakage, unknown/empty tokens.

### LOCAL VERIFICATION REQUIRED (Phase 4)

No full-page RTL render test exists for the route (the route composes Suspense +
router + deck server fns), so a real browser (e2e / manual) pass must verify:

- **RE presented_at residual** — a card browsed-to-but-not-acted-on purely from a
  seeded/applied cache has a brief `presented_at` lag that self-heals on the next
  real read/action/refresh (the dominant swipe path always applies a fresh view whose
  new current was stamped server-side). Confirm newness clears correctly on browse.
- **RC building-recovery trigger** — first-run user on `{status:"building"}`: once
  `firstVisibleMatchReady` flips, the deck-key invalidation re-reads and the miss path
  promotes the first window (no strand on "building").
- **RB loader-await bounded latency** — cold hit renders card #1 in the first SSR
  paint; the rare miss-path build streams behind `MatchLoading` (the slow tail the
  pendingComponent covers), not a blank/hard-error.
- **Manual/e2e checklist** — cold entry hit/miss; Previous/Next over `view.itemIds`
  (no head-drop jump, RG); each action (add / finish / dismiss-card) advancing to the
  promoted card from cache; optimistic dismiss-suggestion feel + rollback; mid-session
  caught-up → `CompletionScreen` (latch, no "quiet in here" flash); building → the
  `no-context` CTA vs `building` split (RD); mode switch re-runs the loader for the
  other orientation and resets visit-local state (`key={mode}`).

---

## ORCHESTRATION RESUME STATE (paused for session reset) — RESOLVED

> RESOLVED: this pause was resumed and ALL phases (1a–6) are now complete,
> committed, and pushed. See "ORCHESTRATION COMPLETE" at the end of this file for
> the final state + the consolidated pre-merge checklist. The snapshot below is
> kept for history.

Paused mid-Phase-4 at a safe, fully-pushed boundary. Read this to resume.

**Done + pushed** (branch `claude/match-deck-read-model-orchestrate-kzd5xs`):
- Phase 1a (pre-existing), 1b (`2985319`), 2 (`f9c2d94`), 3 (`71ec019`). Each
  passed `bun run typecheck` + `typecheck:worker` + full `bun run test` at push
  (the pre-push hook runs all three). HEAD when paused = `71ec019` (Phase 3).
- Migrations through `20260706000010_enqueue_match_review_deck_job.sql`.

**Cloud constraint (still applies):** no local Postgres. Cannot run
`supabase db reset` / `migration up` / `gen:types` / any live-DB test. Do NOT
hand-edit `src/lib/data/database.types.ts` — new tables/RPCs are typed via the
`deck-db-types.ts` escape hatch (deletable after `gen:types`). Verify statically.
The GitHub git-deps `better-result` + `uipane` fail `bun install` (proxy blocks
`api.github.com` tarballs); recover by `git clone`-ing them at their `bun.lock`
pinned commits into `node_modules/` (github.com over HTTPS works).

**Per-phase cycle:** implement (fresh subagent, specific files + acceptance
criteria) → review (fresh-context subagent) → patch (≤2 rounds) → `/commit` style
Conventional Commit → push with retry. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` +
`Claude-Session: https://claude.ai/code/session_016N8d44sYacwMpN2bZVfbgb`.

### Phase 4 — Route cutover (IN PROGRESS — resume here)
A partial implementation was stashed to keep the tree green:
`git stash list` → `phase4-partial-wip` (the `deck-action-status.ts` classifier +
its test, and `mutations.ts` / `queries.ts` / `useMatchReviewCard.ts` retargeted to
the deck caches + `submitMatchDeckAction`). `match.tsx` was NOT yet cut over, so the
stash alone is a broken intermediate — recover it with `git stash pop` ONLY if this
is the same container (else re-run Phase 4 fresh). Full Phase 4 blueprint (if the
container persists) is at
`scratchpad/.../phase4-blueprint.md` (session scratchpad, NOT in repo).

Phase 4 rulings already decided (durable copy — implement to these):
- **RA** add `src/features/matching/deck-action-status.ts` classifier: success tokens
  add-suggestion→`added`; dismiss-suggestion→`dismissed`; finish-card→`completed_added|
  skipped`; dismiss-card→`dismissed`; everything else = rejection (don't advance).
- **RB** loader AWAITS `startOrResumeMatchDeck` (plan §8 unblocks this; paths are
  bounded); `MatchLoading` = route `pendingComponent` for cold/miss tail.
- **RC** building-recovery effect: when `{status:"building"}` && `useActiveJobs().
  firstVisibleMatchReady` → invalidate `matchDeckKeys.deck(accountId,mode)` (replaces
  `bootstrapReadyMatchQueue`).
- **RD** preserve no-context-vs-building via `deriveEmptyStateReason` + `useActiveJobs`.
- **RE** delete the client `markMatchReviewItemPresented` effect (server stamps
  `presented_at`); accept the minor browsed-but-not-acted seeded-card newness lag.
- **RF** dismiss-suggestion KEEPS its optimistic cache surgery and does NOT apply the
  returned view; whole-card actions (finish/dismiss-card) DO apply `result.view` to the
  deck cache + advance the pointer to `result.view.cards.current?.itemId`.
- **RG** preserve the id-based Previous/Next pointer (`resolveCurrentItemId`) over
  `view.itemIds`; only the id-list SOURCE changes.
Scope: route/component cutover ONLY — do NOT delete legacy server fns / query families
/ `appendSnapshotDelta` / `presentMatchReviewItem` / `bootstrapReadyMatchQueue` (that is
Phase 5); the route just STOPS using them. Land the new rendering + the removal of the
three-query orchestration in ONE commit (plan §10). Use the `tanstack-start-react` +
`react-best-practices` skills. Key files: `src/routes/_authenticated/match.tsx`,
`src/features/matching/{mutations,useMatchReviewCard,deck-queries}.ts`. Tests to update
(DB-free): `match.test.ts` (loader inversion), `mutations.test.ts` (dismiss retarget),
`useMatchReviewCard.test.tsx` (retarget) + the new classifier test.

### Phase 5 — Delete legacy (NOT STARTED)
Delete `appendSnapshotDelta` + its 2 playlist-sync call sites (switch them to enqueue
`build_proposals`/`append_sessions` deck jobs), `createOrResumeQueueLegacy`,
`presentMatchReviewItem`, `getMatchReviewItem`, `markMatchReviewItemPresented`, the 3
legacy query families, and the now-collapsed `nextCursor` twins. Keep legacy SQL objects
physically intact (drop only in a later cleanup migration). Note: Phase 3 kept the action
RPCs' TEXT return; the rich-JSONB single-RPC action optimization can fold in here once the
action RPCs are single-caller (see Phase 1b/3 decisions).

### Phase 6 — Ops (NOT STARTED)
`scripts/` warm/backfill (build proposals for all accounts), Smart Placement in
`wrangler.jsonc`, Sentry + PostHog metrics (§13).

### Final deliverable when all phases land
A consolidated `LOCAL VERIFICATION REQUIRED` checklist for a machine with local
Supabase: `bun run gen:types` (regenerates away `deck-db-types.ts`), migration replay
007→010, full `bun run test` + e2e, and the §12 shadow-compare script (request
visibility hash ≡ worker proposal hash is the load-bearing check). Do NOT merge / open a
PR unless asked.

## Phase 5 — Delete legacy

Landed the plan §11/§12.5/§14 cleanup: TypeScript deletion + 2 behavior rewires
ONLY. NO DB objects dropped — all legacy SQL/RPCs and the session-appender DB
wrappers are physically retained for a later cleanup migration. Verified
statically (no local Postgres): `bun run typecheck` (0), `typecheck:worker` (0),
full `bun run test` (282 files / 3266 tests pass; 18 DB-gated integration suites
skip), `bun run check` (0 — the 2 pre-existing `noNonNullAssertion` warnings in
`match-review-queue.functions.ts` vanished with the deleted
`readPlaylistCardFromCapture`/`presentMatchReviewItem` lines that carried them).

### Deletion inventory

Files deleted:
- `src/features/matching/bootstrap-ready-queue.ts` (+ its test) — Step B.
- `src/features/matching/__tests__/queries.test.ts` — only tested the deleted
  `matchReviewBootstrapQueryOptions`.
- `src/lib/domains/taste/match-review-queue/pass-advance.ts` (+ its test) —
  Step E; sole consumers were the deleted `createOrResumeQueueLegacy`/`syncActiveQueue`.
- `src/lib/server/match-review-queue-events.ts` — R3 (`emitQueueAppendEvents`
  went dead once both import sites — start/resume and the playlist syncs — were
  deleted/rewired).

`src/features/matching/queries.ts` (Step A): deleted
`matchReviewBootstrapQueryOptions`, `matchReviewQueryOptions`,
`presentMatchReviewItemQueryOptions`,
`matchReviewItemSuggestionsInfiniteQueryOptions`; pruned imports (`getMatchReview`,
`listMatchReviewItemSuggestions`, `MatchReviewItemSuggestionCursor`,
`presentMatchReviewItem`, `startOrResumeMatchReview`,
`syncActiveMatchReviewSessions`, `infiniteQueryOptions`). Kept `matchReviewKeys`
(TRAPS: all/reviewsRoot/review still ref'd by SettingsPage +
PlaylistsCoverFlowScreen), the summary query families
(`getMatchReviewSummary`/`getPreferredMatchReviewSummary`), `matchDeckKeys`,
`dashboardKeys`. Updated the stale
`matchReviewItemSuggestionsInfiniteQueryOptions` comment in `mutations.ts` to name
the deck version (`matchDeckCardSuggestionsInfiniteQueryOptions`).

`src/lib/server/match-review-queue.functions.ts` (Step C): deleted server fns
`startOrResumeMatchReview`, `getMatchReview`, `getMatchReviewItem`,
`presentMatchReviewItem`, `markMatchReviewItemPresented`,
`syncActiveMatchReviewSessions`, and (R1) the 4 dead legacy mutation fns
`addSongToPlaylistFromQueueItem`, `dismissMatchReviewItemSuggestion`,
`dismissMatchReviewItem`, `finishMatchReviewItem`. Deleted orphaned privates
`fetchOwnedQueueItem`, `filterDismissedActiveSuggestions`, `deriveCaughtUp`,
`computeHiddenReviewItemCount`, `buildMatchReviewResult`,
`readPlaylistCardFromCapture`, `readPlaylistCardFromCaptureLegacy`,
`presentUnavailableOwnedItem`; dead types/consts/schemas
`MatchReviewStartResult`, `MatchReviewItemPresentedResult`, `ActiveSuggestionEntry`,
`EMPTY_MATCH_REVIEW_RESULT`, `StartMatchReviewSchema`, `GetMatchReviewSchema`,
`GetMatchReviewItemSchema`, `PresentMatchReviewItemSchema`, `MarkPresentedSchema`,
`AddFromQueueSchema`, `AddFromQueueResult`, `DismissSuggestionResult`,
`DismissQueueSchema`, `DismissQueueResult`, `FinishQueueSchema`,
`FinishQueueResult`, `SyncActiveMatchReviewSessionsResult`, `ALL_ORIENTATIONS`,
and the private `PLAYLIST_CARD_FIRST_PAGE_SIZE`. KEPT the TRAPS survivors:
`MatchReviewItemRead`, `readOwnedQueueItem`, `mapSuggestionRow`,
`noVisibleSuggestionsMessage`, `MatchReviewItemSuggestionCursor`,
`ListMatchReviewItemSuggestionsPage`, `listMatchReviewItemSuggestions`, and the
whole queue-summary section (incl. `getMatchReviewSummary` per R2). Pruned imports
to match (dropped `getPlaylistById`, `captureVisiblePairsAtomic`, the caps,
`computeVisibleSuggestionList`, `fetchSongOrientationData`,
`captureProductEventBestEffort`, `emitQueueAppendEvents`, `chunkedRead`,
`fromSupabaseMany`, the atomic wrappers + resume/session query fns, and
`createOrResumeQueue`/`markItemPresented`/`syncActiveQueue` from ./service).

`src/lib/domains/taste/match-review-queue/service.ts` (Step D): deleted
`appendSnapshotDelta`, `createOrResumeQueue`, `createOrResumeQueueLegacy`,
`syncActiveQueue`, and privates `createQueueFromLatestSnapshot`,
`appendLatestSnapshot`, `recordSnapshotApplied`, `isSnapshotAlreadyApplied`,
`mapRpcSession`, `hasSessionBeenSeeded`, `AppendOpts`. KEPT the TRAPS survivors —
esp. `fetchLatestSnapshotId` (still called by `hasFirstVisibleReviewSubject`) —
plus `getQueueSummary`, `getOrderedUndecided*`, `markItemPresented`,
`markItemResolved`. Pruned service.ts imports: dropped `advanceActiveSession`
(./pass-advance), `computeVisibilityPolicyHash` (kept the `VisibilityPolicy` type),
`DEFAULT_MATCH_STRICTNESS`/`STRICTNESS_MIN_SCORE`, `captureServerError`, and the
now-unused ./queries wrappers FROM service.ts
(`callResumeMatchReviewSession`/`completeSession`/`insertMatchReviewSession`/
`insertQueue*`/`insertSessionSnapshot`/`fetchAppliedSnapshotIds`/`fetchMaxPosition`/
`fetchQueued*Ids`/`mapItemToDto`) — the wrappers THEMSELVES stay in queries.ts for
session-appender (R4). Also refreshed the module doc comment.

### R1 helper check (fetchOwnedQueueItem)

`fetchOwnedQueueItem` (and `filterDismissedActiveSuggestions`) were freed by the 4
mutation-fn deletions and had ZERO remaining consumers → both deleted.
`fetchOwnedQueueItem` is a *private* fn: `submitMatchDeckAction`
(`match-deck.functions.ts`) does not and cannot import it; it resolves the owned
item via its own `mapItemToDto` path and dispatches straight to the atomic wrappers
(`addQueueItemDecisionAtomically`/`dismiss*`/`finish*`) it imports directly from
`./queries`, so no atomic-wrapper imports remain in `functions.ts` (all removed).
`readOwnedQueueItem` was KEPT — still used by the surviving
`listMatchReviewItemSuggestions`. Typecheck confirmed the zero-consumer status.

### Rewire #1 — playlist filter sync → deck-job enqueue

`playlists.functions.ts`: both filter-only branches (`saveMatchConfig` and
`flushPlaylistManagementSession`) stopped calling `syncActiveQueue(...)`. Extracted
a private `enqueueFilterProposalRebuild(accountId, operation)` helper (avoids
duplicating the block): a read-time filter change publishes no snapshot, so it
resolves the account's LATEST snapshot via `getLatestMatchSnapshot`, then for
song+playlist enqueues `build_proposals` keyed
`build:{account}:{orientation}:{snapshot}` with payload `{snapshotId}`,
best-effort (`captureServerError` on enqueue error; never rolls back the save;
no-snapshot → no-op). Imports: removed `syncActiveQueue` + `emitQueueAppendEvents`;
added `enqueueDeckJob`, `getLatestMatchSnapshot`, `Json`. Extracting the shared
helper (vs. inlining twice) was chosen per the blueprint's sketch.

### Rewire #2 — runMatchSnapshotRefreshEffects

`features/matching/queries.ts`: dropped the `await syncActiveMatchReviewSessions()`
call (appends are worker-driven now) and the dead `matchReviewKeys.reviewsRoot`
invalidation. Kept the deck/summary/dashboard invalidations
(`matchDeckKeys.deckRoot`, `matchReviewSummaryKeys.summariesRoot`,
`dashboardKeys.stats/pageData/matchPreviews`) and the `async`/`Promise<void>`
signature (`useActiveJobs.ts` `void`-calls it).

### R2 / R3 / R5 as applied (R4 above)

- R2 — LEFT `getMatchReviewSummary` + `matchReviewSummaryQueryOptions` untouched
  (out of scope; reference-only survivor).
- R3 — deleted `emitQueueAppendEvents`. ANALYTICS LOSS (Phase 6 follow-up): the
  request-path `review_queue_appended` + `first_visible_match_ready` PostHog
  events no longer fire on a queue append (there is no request-path append
  anymore). If that signal is valued, re-add it worker-side (session-appender
  append metrics). No new emission was added in Phase 5.
- R5 — rewire-#1 idempotency/staleness residual (RECORDED): the build key
  `build:{account}:{orientation}:{snapshot}` does NOT encode the filter hash, so
  if a second filter change lands while a same-snapshot build is still in-flight
  (not yet completed/dead), the enqueue dedupes (ON CONFLICT DO NOTHING) and the
  second change rides the first build. Low severity: the in-flight build reads
  live filters at execution time, and the deck read self-heals on a proposal miss.
  Left as-is.

### Surprise — MatchReviewResult kept (still referenced)

The blueprint listed the `MatchReviewResult` interface among the Step C dead
types, but it is STILL imported by `src/features/matching/queue-helpers.ts` (a
live route module — `match.tsx` imports other helpers from it) for the
now-route-unused `deriveUnresolvedIds`/`deriveCaughtUp` helpers. Per the
"keep a still-referenced symbol and flag it" guidance I KEPT `MatchReviewResult`
(deleting only its sibling `MatchReviewStartResult`, which was solely used by the
deleted `startOrResumeMatchReview`). Follow-up candidate for a later pass: delete
`queue-helpers.deriveUnresolvedIds`/`deriveCaughtUp` (dead outside their own tests;
plan §14 lists `deriveUnresolvedIds` for deletion) and then `MatchReviewResult` —
deferred here as it expands beyond the enumerated Phase-5 file set.

### Tests

- Deleted: `bootstrap-ready-queue.test.ts`,
  `features/matching/__tests__/queries.test.ts`, `pass-advance.test.ts`.
- Edited (removed deleted-fn describe blocks, survivors + assertions intact):
  `service.test.ts` (removed the createOrResumeQueue/appendSnapshotDelta clusters +
  their imports/consts; kept getQueueSummary/getOrderedUndecided*/
  hasFirstVisibleReviewSubject/markItem*); `match-review-queue.functions.test.ts`
  (removed all deleted-fn blocks incl. the 4 mutation fns; kept
  listMatchReviewItemSuggestions — re-added the `mockItemOwnership` helper +
  `BASE_PLAYLIST_ITEM` fixture the survivor uses but which lived inside a deleted
  region, and re-added the `DatabaseError` import).
- Rewritten to the new enqueue behavior (faithful, not weakened):
  `useActiveJobs.test.ts` (dropped the syncActiveMatchReviewSessions mock + its 2
  sync-specific tests; asserts deck/summary/dashboard invalidation = 5 calls,
  `matchDeckKeys.deckRoot` present, `matchReviewKeys.reviewsRoot` NO LONGER
  invalidated, item keys never invalidated); `playlists.match-config.test.ts` +
  `playlists.management.test.ts` + the savePlaylistMatchConfig block in
  `playlists.functions.test.ts` (mock `enqueueDeckJob` + `getLatestMatchSnapshot`;
  the filter-only path asserts 2 `build_proposals` enqueues song+playlist with key
  `build:acct-1:{orientation}:snap-1` + payload `{snapshotId:"snap-1"}`, instead of
  2 `syncActiveQueue` calls).
- Tidied stale vi.mock keys naming deleted symbols:
  `match-review-queue.summary.test.ts` (dropped createOrResumeQueue/syncActiveQueue
  service keys), `dashboard.functions.billing.test.ts` (dropped the 8 deleted-fn
  keys, added a listMatchReviewItemSuggestions placeholder).

### LOCAL VERIFICATION REQUIRED (Phase 5)

Deferred to a machine with local Supabase (no Postgres in this cloud env; no DDL
was written, so migration replay is unaffected):
- Filter-change chain end-to-end: a `saveMatchConfig`/`flushPlaylistManagementSession`
  filter-only change → `build_proposals` (both orientations, keyed to the latest
  snapshot) → chained `append_sessions` → the active session's NEXT deck read
  reflects the NEW filters (newly-visible subjects appended, newly-hidden ones
  excluded). This replaces the old synchronous `syncActiveQueue` append; confirm the
  worker drains it and the deck updates within acceptable lag.
- Confirm no runtime import of a dropped symbol survives (static sweep is clean;
  remaining name matches are historical/parity WHY-comments only).
- Legacy SQL/RPCs intentionally retained (`resume_match_review_session`, the
  `insert_queue_*`/capture/decision RPCs, the session-append wrappers) — a later
  cleanup migration drops the ones the deck path no longer calls, once prod soak
  confirms.
- R5 residual: verify the in-flight-build-dedupe-during-a-second-filter-change case
  self-heals (the build reads live filters; the deck read self-heals on miss).

### Patch round (post-review, SHIP with no must-fix)

Three cheap improvements to rewire #1 (the only new runtime behavior): (1)
`enqueueFilterProposalRebuild` now captures a genuine snapshot-read DB error
(`Result.isError`) via `captureServerError` (`step:"resolve_latest_snapshot"`)
instead of swallowing it alongside the no-snapshot skip — the `Result.ok(null)`
case stays a silent clean skip. (2) Added a best-effort-path test to
`playlists.match-config.test.ts`: when `enqueueDeckJob` returns `Result.err`, the
filter-only save still SUCCEEDS (no rollback) and `captureServerError` fires per
orientation. (3) Dropped dead `mockSyncActiveQueue` scaffolding + the
`createOrResumeQueue`/`syncActiveQueue` service-mock keys from
`match-review-queue.functions.test.ts` (no surviving consumer). Accepted
doc-drift NIT: some stale WHY-comments still name deleted symbols — parity notes
only, no runtime impact, left as-is.

## Phase 6 — Ops

Final phase: the warm/backfill script, Cloudflare Smart Placement, and the
Sentry + PostHog + worker-lag metrics (plan §12.6 + §13). No DB objects, no
schema, no route/component changes — a script, one wrangler line, and metric
call sites at existing seams. Verified STATICALLY (no local Postgres): `bun run
typecheck` (0), `typecheck:worker` (0), full `bun run test` (282 files / 3267
tests pass, 18 DB-gated suites skip), `bun run check` (0).

### 1. Warm/backfill script (`scripts/ops/warm-match-deck-proposals.ts`)

- **ENQUEUE, not direct build.** The script enqueues a `build_proposals` deck job
  (both orientations) per account via `enqueueDeckJob`, keyed
  `build:{account}:{orientation}:{snapshot}` with payload `{snapshotId}` — the
  EXACT trigger every other build site uses (execute.ts R2, match-deck-miss-path,
  the playlists filter rewire). Chosen over calling
  `buildProposalsForAccountOrientation` directly because (a) that is the
  established "trigger a build" pattern across the codebase, (b) the running
  worker already chains `append_sessions` after each build (the script would have
  to replicate that), and (c) enqueue is a fast metadata insert — the script
  doesn't hold DB connections through the heavy per-preset derivation. Assumes the
  prod worker is running (it is). Idempotent by construction: the enqueue RPC's
  `ON CONFLICT (idempotency_key) WHERE status NOT IN ('completed','dead') DO
  NOTHING` means a re-run — or a race with the worker's own publish-triggered
  enqueue — is a benign no-op (counted as `deduped`).
- **Account iteration avoids `.in()` on a DB-derived id set.** There is no
  `published` flag on `match_snapshot` — a row IS a published snapshot — so
  "accounts with a published snapshot" = accounts with ≥1 `match_snapshot` row,
  latest = newest `created_at` (as `getLatestMatchSnapshot` does). The script
  streams `match_snapshot` ordered `(account_id ASC, created_at DESC, id DESC)`
  via `.range()` offset pages (`iterateLatestSnapshotPerAccount`, 1000/page,
  selecting only `account_id,id,created_at`) and treats the FIRST row seen per
  account as its latest, skipping the rest. It never collects an id set and feeds
  it back as an `.in()` URL filter, and never touches a snapshotless account. No
  `chunkedRead` (that is only for externally-sourced id lists). Residual: offset
  pagination under concurrent snapshot writes could skip/dupe an account — a dupe
  is a harmless idempotent no-op and a skip self-heals on the account's next deck
  read; noted for the live pass.
- **`--dry-run`** iterates + counts what WOULD be enqueued (accounts × 2
  orientations) writing nothing; **per-account error isolation** — `warmAccount`
  turns an `enqueueDeckJob` `Result.err` into a logged `failed` count and
  continues, and an unexpected per-account throw is caught in `main`'s loop
  (counts both orientations failed) so one bad account never aborts the run.
  `--help` prints usage and exits. Conventions (colors, `success`/`error`/`info`,
  `import.meta.main` guard, arg parse) mirror `grant-liked-song-access.ts`.
- **package.json alias** `"warm:match-deck": "bun scripts/ops/warm-match-deck-proposals.ts"`,
  sibling to `reset:onboarding` / `grant:liked-access`.
- **Static-verification note:** the `--help`/`--dry-run` runtime path can't be
  exercised in this cloud env — `@/env` validation throws at import when the
  Supabase/auth env vars are unset (identical behavior for the existing
  `grant-liked-song-access.ts --help`), before `parseArgs` runs. The script is
  verified by `bun run typecheck` (tsconfig `include: **/*.ts` covers `scripts/`;
  confirmed by injecting a temp type error, which typecheck caught).

### 2. Smart Placement (`wrangler.jsonc`)

Added top-level `"placement": { "mode": "smart" }` (with a WHY comment, JSONC
valid) between `main` and `routes`. Moves the Worker's execution near the origin
it talks to most — the self-hosted Postgres on the VPS — cutting deck-read
round-trip latency (plan §1/§15). No other config touched.

### 3. Metrics inventory (§13)

All reuse the EXISTING helpers — no new metrics layer. Server (Cloudflare) uses
`captureProductEventBestEffort` (`@/lib/observability/capture-product-event`,
detached + Sentry-routed, never throws) for PostHog and `captureServerError` →
`@sentry/cloudflare` for Sentry; the worker (Bun) uses `captureWorkerEvent`
(`src/worker/posthog-capture.ts`, prod-only no-op otherwise) for PostHog and
`@sentry/bun` for Sentry.

**Sentry captures** (of the 5 enumerated points, 4 were ALREADY covered by the
Phase-2/3 `reportDeckError`/dead-letter scaffolding; only (a) was genuinely
missing and is newly added):

- **(a) proposal build failure — NEWLY ADDED.** `poll-match-deck-jobs.ts:145`
  `Sentry.captureException` (`@sentry/bun`) in the `build_proposals`/`repair` arm
  when `buildProposalsForAccountOrientation` errors, tags
  `area=match_deck, operation=build_proposals, runtime=worker`. **Placed at the
  worker dispatch boundary, NOT inside `proposal-builder.ts`** (approximation,
  recorded): the builder is shared domain code imported by BOTH the `@sentry/bun`
  worker and the `@sentry/cloudflare` server (via the miss path), so it can't
  import either SDK without cross-contaminating a bundle. The server-side
  invocation (`buildOneProposal` in the miss path) is already captured by
  `captureServerError` at `resolve_match_deck_view_miss` (below), so both call
  sites are covered.
- **(b) promotion / miss-path build failure — ALREADY COVERED.** The
  `callStartOrResumeMatchDeck` error path is captured at
  `match-deck.functions.ts:533` (`resolve_match_deck_view`); the
  `buildFirstWindowAndPromote` error propagates to `resolveMatchDeckView` and is
  captured at `:585` (`resolve_match_deck_view_miss`); the best-effort enqueue
  failure inside `buildFirstWindowAndPromote` is captured at
  `match-deck-miss-path.ts:91` (`match_deck_miss_build_enqueue`). No change.
- **(c) deck action transaction failure — ALREADY COVERED.** Every arm of
  `submitMatchDeckAction` already calls `reportDeckError(..., "submit_match_deck_action")`
  (`match-deck.functions.ts:870/889/907/924`). No change.
- **(d) on-demand materialize failure — ALREADY COVERED.** The materialize and
  recapture DB errors are captured at `match-deck.functions.ts:649`
  (`read_match_deck_card_materialize`) and `:712`
  (`read_match_deck_card_recapture`). The "cold path fired / recovered?" SIGNAL is
  the new PostHog `match_deck_materialize_on_read` (below), which is the right
  channel for a non-error signal. No new Sentry.
- **(e) deck job dead-lettering — ALREADY COVERED.** `poll-match-deck-jobs.ts:368`
  `Sentry.captureMessage("match deck job dead-lettered: {kind}", "error")` in the
  sweep tick where `markDeadDeckJobs` returns rows (Phase 2). No change.

**PostHog events** (all server-side via `captureProductEventBestEffort`, distinct
id = account id, matching the `playlists.functions.ts` precedent):

- **`match_deck_hit`** — `match-deck.functions.ts:544` (`source:"active"`) and
  `:596` (`source:"promoted"`), fired from `resolveMatchDeckView` ONLY on a genuine
  entry. Props: `orientation, source, revision, remaining`.
- **`match_deck_miss_reason`** — `:567` (`reason:"no_snapshot"`) and `:603`
  (`reason:"promotion_incomplete"`). Props: `orientation, reason`.
- **`match_deck_action`** (single event carrying BOTH signals the brief lists as
  `match_deck_revision` + `match_deck_action_type`) — `:946`, in
  `submitMatchDeckAction` after the read-after-write. Props: `orientation,
  action_type, action_status, revision` (`revision` from the fresh view, `null`
  when the view is caught-up/building). **Interpretation recorded:** the brief's
  `match_deck_revision` + `match_deck_action_type` are wired as two PROPERTIES on
  one per-action event rather than two separate events (one action → one event;
  firing two events per action would double-count actions).
- **`match_deck_materialize_on_read`** — `:739`, in `resolveDeckCard` when the
  R-E cold path fires (`not_captured` → on-demand materialize). Props: `itemId,
  recovered` (whether the single re-read cleared `not_captured`), `orientation`.
  The `resolveDeckCard` tail was refactored to a single result variable so the
  event fires exactly once with `recovered` known.
- **Entry-metric gating:** `resolveMatchDeckView` gained an `emitEntryMetrics`
  flag (default `false`); `startOrResumeMatchDeck` passes `true`,
  `submitMatchDeckAction`'s read-after-write leaves it `false` — so its ~always-a-hit
  internal read doesn't inflate `match_deck_hit`. The action path emits only
  `match_deck_action`.

**Worker lag metrics** (via `captureWorkerEvent`, distinct id = account id):

- **`match_deck_build_lag`** — `poll-match-deck-jobs.ts:163`, emitted after a
  successful `build_proposals`/`repair`. `lag_ms = now - job.created_at`.
- **`match_deck_capture_lag`** — `:239`, emitted after a successful
  `capture_ahead`. `lag_ms = now - job.created_at`.
- **Lag-source approximation (recorded):** `job.created_at` is the PROXY for the
  true anchors. A `build_proposals` job is enqueued immediately after publish
  (execute.ts R2 / miss / filter rewire), so `created_at ≈ snapshot publish
  time`; a `capture_ahead` job is enqueued in-txn by the deck action, so
  `created_at ≈ action time`. This measures enqueue→ready and action→captured,
  which include the poll pickup delay — the best cheap proxy without a new
  timestamp column or a snapshot-publish-time read per job (`emitDeckJobLag`
  computes it inline; both live in the worker, which has `job.created_at` +
  `job.account_id`). `captureWorkerEvent` no-ops outside production, so these are
  silent in dev/test.

### Phase-5 analytics follow-up (emitQueueAppendEvents)

Phase 5 (R3) deleted `emitQueueAppendEvents`, dropping the request-path
`review_queue_appended` and `first_visible_match_ready` PostHog events (there is
no request-path append anymore). Resolution:

- **`review_queue_appended` — WIRED worker-side.** `poll-match-deck-jobs.ts:213`
  emits it via `captureWorkerEvent` in the `append_sessions` arm when the outcome
  is `applied` with `appendedCount > 0`. Props: `orientation, snapshot_id,
  appended_count`. This is the direct analog (the worker now owns the append and
  carries `appendedCount`), cheap, and restores the appended-count signal. The
  semantics shift from request-scoped to publish-scoped, which is correct for the
  new model.
- **`first_visible_match_ready` — ACCEPTED CHANGE (not re-added).** Recomputing a
  precise per-account "first-ever visible match ready" timestamp worker-side would
  need new plumbing (a persistent "has this account ever had a non-empty
  build/append" flag) — exactly the kind of new infra the brief says to avoid. Its
  intent is now better served by existing/new signals: the `matching_setup_completed`
  anchor still fires (`playlists.functions.ts`), and readiness is observable via
  `match_deck_build_lag` (publish→proposals ready) + `match_deck_hit`
  (source=active|promoted, the first successful entry). Recorded as an accepted
  analytics change; re-add only if a north-star dashboard specifically needs the
  standalone timestamp.

### LOCAL VERIFICATION REQUIRED (Phase 6)

Deferred to a machine with prod/staging access (no local Postgres / live worker
in this cloud env):

- **Run the warm script** against staging then prod: `bun run warm:match-deck
  --dry-run` (confirm the account/enqueue counts look right and the snapshot
  stream terminates), then `bun run warm:match-deck`; confirm the worker drains
  the `build_proposals` jobs (both orientations), chains `append_sessions`, and a
  cold account's first deck entry is now a HIT (no in-request miss build). Re-run
  and confirm idempotent no-op (`deduped` count, no duplicate proposals). Confirm
  the offset-pagination account stream covers the full base (spot-check total
  accounts-with-snapshot vs `counts.accounts`).
- **Smart Placement deploys** — `wrangler deploy` accepts `placement.mode:"smart"`
  and the CF dashboard shows placement active; measure the deck-read latency delta
  (the reason for the change) once traffic warms the placement.
- **Metrics fire in a live pass** — in prod PostHog confirm `match_deck_hit`
  (both sources), `match_deck_miss_reason`, `match_deck_action` (revision +
  action_type populated), `match_deck_materialize_on_read` (recovered true/false),
  `match_deck_build_lag` / `match_deck_capture_lag` (sane `lag_ms`), and
  `review_queue_appended` (appended_count) all arrive with account distinct ids;
  in Sentry confirm the new worker `build_proposals` capture fires on an induced
  build failure and doesn't double-report against the miss-path capture.
- **Lag-proxy sanity** — confirm `job.created_at`-based `lag_ms` tracks real
  publish→ready / action→captured latency closely enough to alert on; if the poll
  pickup delay dominates, consider a dedicated publish-time source in a later pass.

---

## ORCHESTRATION COMPLETE — all phases landed

All six landing-sequence phases (plan §12) are implemented, reviewed, and pushed
to `claude/match-deck-read-model-orchestrate-kzd5xs` (base `main`). Every phase
passed `bun run typecheck` + `bun run typecheck:worker` + full `bun run test` +
`bun run check` at push time (pre-push hook). Final suite: 3267 tests pass, 18
DB-gated integration suites skipped (no local Postgres in the cloud env).

Commits (newest first):
- `443f42e` phase 6 — ops (warm script, Smart Placement, §13 metrics)
- `69231e7` phase 5 — delete legacy queue machinery + 2 sync-trigger rewires
- `9c4340f` phase 4 — /match route cutover to the deck read model
- `71ec019` phase 3 — deck server contracts
- `dad5871` docs — mid-run resume checkpoint (now resolved)
- `f9c2d94` phase 2 — worker deck-job builders + poll loop
- `2985319` phase 1b — deck read/start/action RPCs
- `bc976ba` phase 1a — deck read-model storage schema (pre-existing)

Migrations added: `20260706000003`–`20260706000010` (proposal tables, session deck
columns, deck-job table + claim/sweep/dead functions, `read_match_deck_card`,
`start_or_resume_match_deck`, extended action RPCs, `enqueue_match_review_deck_job`).
All additive — no legacy SQL object was dropped (a later cleanup migration drops
the now-dead legacy RPCs after prod soak).

### CONSOLIDATED LOCAL VERIFICATION REQUIRED (run before merge, on a machine with local Supabase)

Nothing below could run in the cloud env (no Postgres). All are pre-merge gates.

1. **Regenerate types**: `bun run gen:types`. This must (a) add the 4 new tables +
   the new RPCs to `src/lib/data/database.types.ts`, and (b) let you DELETE the
   temporary escape hatch `src/lib/data/deck-db-types.ts` and repoint its call
   sites (`deck-jobs.ts`, `proposal-builder.ts`, `session-appender.ts`,
   `card-materializer.ts`, `deck-read-queries.ts`, the warm script) to the plain
   `createAdminSupabaseClient()`. Verify the real generated Row/Insert shapes match
   what `deck-db-types.ts` declared (payload jsonb, nullable session_id/
   heartbeat_at/resume_position).
2. **Migration replay** from scratch (`supabase db reset` / `migration up`):
   `20260706000003`→`0010` apply cleanly, incl. every `ON CONFLICT (idempotency_key)
   WHERE status NOT IN ('completed','dead')` binding to the partial unique index, and
   the `CREATE OR REPLACE` of the 4 action RPCs.
3. **Full `bun run test` + e2e** against the local stack, incl. the DB-gated
   integration suites that skip in cloud (`match-event-log.integration`, etc.), and
   a browser/e2e pass over `/match` (NO full-page RTL test exists): cold entry hit,
   cold entry miss (bounded first-window build + enqueue), preset change, filter
   change, UTC-midnight hash rollover, mid-session publish, Previous/Next
   navigation, each action type incl. optimistic dismiss-suggestion, hard reload
   after each action, caught-up → CompletionScreen, building → no-context CTA.
4. **The load-bearing hash check** (highest risk): confirm a normal cold entry is a
   branch-2 HIT, not a miss — i.e. the request path's `computeVisibilityPolicyHash`
   (from `resolveMinMatchScore` + `fetchTargetPlaylistFilters` + one `nowMs`)
   reproduces byte-for-byte the `visibility_config_hash` the worker's proposal
   builder wrote. A silent mismatch makes every entry take the (correct but slow)
   miss path.
5. **Parity / shadow-compare** (§12): the Phase-2 fixture parity suites
   (`proposal-order-parity`, `seed-pair-parity`) already run in CI and pin
   proposal subject order + seed pairs by construction (both the builder and the
   deleted `appendSnapshotDelta` used the shared `deriveEligibleSubjects` seam).
   NOTE: the plan's original "shadow-compare vs live `appendSnapshotDelta`" is
   SUPERSEDED — `appendSnapshotDelta` was deleted in Phase 5, and parity is now
   guaranteed by the shared seam + fixture suites rather than a runtime diff. If a
   live diff is still wanted, run it against the pre-Phase-5 tag or diff the
   proposal builder against the deck read path outputs.
6. **Deck-job worker drain** end-to-end on the local stack: publish a snapshot →
   `build_proposals` → chained `append_sessions` → `capture_ahead`; the `--dry-run`
   then real `bun run warm:match-deck` (spot-check `counts.accounts` vs total
   accounts-with-snapshot); sweep/mark-dead on a killed worker; idempotent
   double-run safety (no worker fence — relies on upsert / ON CONFLICT / first-write-
   wins capture).
7. **Ops**: confirm Cloudflare Smart Placement (`wrangler.jsonc`) deploys and
   measure the Worker→VPS latency delta; verify the PostHog events fire —
   dashboards must key on `match_deck_action.{revision,action_type}` (ONE event
   with properties), not the plan's literal `match_deck_revision`/`match_deck_action_type`
   event names; verify the 5 Sentry captures + worker lag events fire.

### Accepted residuals / follow-ups (recorded across the per-phase sections above)
- Action RPCs kept `RETURNS TEXT`; the single-RPC rich-return optimization can fold
  in now that `submitMatchDeckAction` is their sole caller (post-Phase-5).
- Dead helpers `deriveUnresolvedIds`/`deriveCaughtUp` + `MatchReviewResult` in
  `queue-helpers.ts` (no non-test consumer) deferred to a later cleanup.
  RESOLVED (cleanup pass): removed the dead exports `deriveUnresolvedIds`,
  `deriveCaughtUp`, `nextItemIdAfterResolved`, and `shouldBootstrapReadyQueue`
  from `queue-helpers.ts` plus their `describe` blocks, and deleted the
  now-orphaned `MatchReviewResult` interface (and its `MatchReviewSubject`
  import) from `match-review-queue.functions.ts`. Kept `resolveCurrentItemId`,
  `countAppendedFromTotal`, `deriveProgressIndex`, `deriveEmptyStateReason`,
  `shouldOfferLoosenStrictness`, and the `Reason` type — all still consumed by
  `match.tsx` / `MatchingEmptyState`.
- Request-path `first_visible_match_ready` analytics not re-homed (covered by
  `match_deck_build_lag` + `match_deck_hit` + `matching_setup_completed`);
  `review_queue_appended` WAS re-homed to the worker.
- Warm-script page size (1000) == PostgREST `max_rows` (1000): safe today +
  matches repo convention; would silently under-warm if `max_rows` is lowered.
- Worker lag metrics use `job.created_at` as the publish/action-time proxy
  (includes poll-pickup + retry-backoff tails).
- Deck-job `claim` intra-batch race at `p_limit>1` (safe at the poller's `p_limit=1`);
  no worker-fencing column (idempotent handlers make double-run safe).

Do NOT merge and do NOT open a PR unless the maintainer asks.
