# Deck read model — consolidated review findings

Branch: `claude/match-deck-read-model-orchestrate-kzd5xs` @ `6d70eb84` (post
gen:types cutover; `deck-db-types.ts` escape hatch deleted).
Plan: `docs/architecture/matching/deck-read-model-plan.md`.
Decisions log: `claudedocs/orchestration-deck-read-model-decisions.md`.

Sources merged: a five-area agent review (schema/RPC SQL, worker jobs, server
contracts, route cutover, deletion+ops) run at `5507bfdc`, plus an external
GPT review run at `6d70eb84`. **Every GPT claim adopted below was re-verified
against the code**; claims that didn't hold up are in §7. Line refs are from
`6d70eb84`.

Severity: **H** = fix before merge. **M** = fix before or promptly after
merge; each is a real defect or a plan contradiction. **L** = cleanup /
hardening. Every issue carries a recommended fix.

---

## 1. High severity — fix before merge

### H1. `mark_dead` kills still-running final-attempt jobs and breaks the serialization guarantee
`supabase/migrations/20260706000006_deck_read_model_deck_job_functions.sql:105-122`.
`mark_dead_match_review_deck_jobs()` terminates any `pending | running` job
with `attempts >= max_attempts`, **ignoring `heartbeat_at`**. `attempts` is
incremented at claim, so a job on its final attempt satisfies the predicate
the moment it starts running. Any sweep tick during its execution marks it
`dead` mid-flight; since `claim_pending_…`'s `NOT EXISTS` gate only checks
`status = 'running'` (`…000006.sql:45-51`), a second job for the same
`(account_id, orientation)` can then be claimed **while the first is still
executing** — the exact race the serialization design exists to prevent. The
still-running handler may also later settle the `dead` row back to
`completed` (settlement is an unconditional UPDATE by id,
`deck-jobs.ts`).
**Fix:** dead-letter only jobs that are demonstrably not running: change the
predicate to `status = 'pending' OR (status = 'running' AND heartbeat_at <
now() - lease)` (pass the same `p_lease_seconds` as sweep). Optionally make
`completeDeckJob`/`deferDeckJob` guard `WHERE status = 'running'` so a
settled-after-dead job can't be resurrected. *(GPT finding; verified.)*

### H2. Stale-proposal resurrection re-appends superseded subjects
`src/lib/domains/taste/match-review-queue/proposal-builder.ts:233-307` +
`src/worker/poll-match-deck-jobs.ts` (unconditional `append_sessions` chain
after every successful build). `buildOneProposal` unconditionally upserts to
`building` and flips to `ready` at the end with no "am I still the latest
snapshot" check. A deferred/sweep-retried/`repair`/warm-script build of a
**superseded** snapshot resurrects its `stale` proposal to `ready`, then the
poll loop chains a fresh `append_sessions` which re-appends the old
snapshot's subject set into the active session — including subjects that
became ineligible since (unowned playlist, revoked entitlement). The M3 fix
only guards the inverse direction (old build marking newer proposals stale);
`start_or_resume_match_deck` pins latest-snapshot but `append_sessions` does
not.
**Fix:** two guards, both cheap: (a) in `buildOneProposal`, before the final
`ready` flip, re-check the built snapshot is still the account's latest
(same `getLatestMatchSnapshot` guard M3 already added for stale-marking) and
finish as `stale` otherwise; (b) in `appendSessionsForAccountOrientation`,
skip (settle `superseded`) when the job's `snapshotId` is no longer the
latest. *(Agent finding.)*

### H3. Promotion bulk-inserts trust proposal/seed rows verbatim — malformed worker data hard-500s the entry point
`supabase/migrations/20260706000008_start_or_resume_match_deck_rpc.sql:141-180`
bulk `INSERT … SELECT`s from `match_review_proposal_subject` /
`match_review_proposal_seed_pair` into `match_review_queue_item` /
`match_review_item_visible_pair`. The source tables
(`20260706000003…:75-121`) have **no uniqueness constraints** on subject
identity per proposal or on `(subject_position, visible_rank)` per seed —
unlike their targets, which do. Any worker derivation bug producing a
duplicate raises an uncaught `unique_violation` that aborts
`start_or_resume_match_deck` — turning "self-healing on miss" into a
persistent 500 for that account. Asymmetric with
`capture_match_review_item_visible_pairs_atomic`, which validates dense
duplicate-free ranks before inserting into the same table.
**Fix (belt + suspenders):** add unique indexes to the proposal tables
(`(proposal_id, song_id)` / `(proposal_id, playlist_id)` partial per
orientation; `(proposal_id, subject_position, visible_rank)` on seed pairs)
so bad data fails at **build time** (worker retries, nobody waiting), and
add `ON CONFLICT DO NOTHING` to the promotion's two bulk inserts so entry
never 500s. *(Agent finding.)*

### H4. Not-entitled subject ⇒ permanently stuck card the user cannot resolve
Compound of three verified behaviors:
1. `card-materializer.ts:122` — `captureAheadForSession` skips a
   `not-entitled` subject **without stamping** `visible_pairs_captured_at`
   (the promotion seed path, by contrast, stamps captured-empty cards).
2. `20260706000007_read_match_deck_card_rpc.sql:91-93` — the read returns
   `not_captured` **before** the subject-existence/ownership check, so a
   revoked-but-still-present subject never reaches `playlist_gone`/
   `song_gone`; the R-E on-demand materialize re-runs the same derivation,
   hits `not-entitled`, skips again — `not_captured` forever, mapped to
   `retryable-error`.
3. `20260706000009_extend_deck_action_rpcs.sql:412,551` — `finish` and
   `dismiss` both return `no_captured_pairs` for uncaptured items, and
   `match.tsx:752-758,1038-1044` treats that as a rejection (no advance).
Net: the user can neither view, finish, nor dismiss the card; `caughtUp`
never becomes true. The legacy flow surfaced this as an `unavailable` card
that could be skipped (`presentUnavailableOwnedItem`, deleted in Phase 5).
**Fix:** in `captureAheadForSession` (and the R-E path), stamp
`visible_pairs_captured_at` with zero pairs on `not-entitled` — the read
then returns `no_visible_suggestions`/unavailable and the existing
resolve-empty-card flow applies. Alternatively (or additionally) let
`finish_match_review_item_atomic` resolve an uncaptured item as `skipped`.
*(GPT found parts 1–2; agent verification found part 3 / the deadlock.)*

---

## 2. Medium severity

### M1. Build idempotency key omits the visibility hash — active sessions don't self-heal a deduped rebuild
All four enqueue sites use `build:{account}:{orientation}:{snapshot}`
(`src/worker/execute.ts`, `src/lib/server/playlists.functions.ts`,
`src/lib/server/match-deck-miss-path.ts`,
`scripts/ops/warm-match-deck-proposals.ts`) while plan §5.3's example key is
`build:{account}:{orientation}:{snapshot}:{hash}`. Phase 5 recorded this
(R5) as self-healing, but that's only true for **sessionless** entry: if
filter change B lands while change A's build is already executing (filters
already read), B's enqueue dedupes away, the follow-up append computes hash
B, finds `no_ready_proposal`, retries to exhaustion and dead-letters — and
an **active** session never receives the new-filter append (branch 1 never
consults the hash, and miss-healing only runs when no session exists) until
the next snapshot publish.
**Fix:** append the read-time-filters hash (or full visibility hash) to the
build idempotency key at all four sites, matching the plan. Cheap and
removes the whole class. *(GPT sharpened a recorded residual; verified.)*

### M2. Single global FIFO with no job-kind priority starves `capture_ahead`
`poll-match-deck-jobs.ts` (one claim slot) + claim `ORDER BY available_at,
created_at` (`…000006.sql:52`). The warm script enqueues `build_proposals`
for every account (each ≈7 round trips × 3 presets); a live swiper's
`capture_ahead` jobs queue behind the flood, defeating "capture runs ahead
of the user" (§7, §13) — and because the promoted-card path has no on-demand
materialize (see M5/recorded residual), starved capture surfaces directly as
`retryable-error` cards.
**Fix:** add kind priority to the claim's `ORDER BY` (`capture_ahead` >
`append_sessions` > `build_proposals`/`repair`), or run a second poll slot
dedicated to `capture_ahead`. *(Agent finding.)*

### M3. Appender position-race silently completes without the ledger write
`session-appender.ts:76-80,203-266` — on a `(session_id, position)` unique
violation the whole batch is treated as a no-op, returns
`{kind:"applied", appendedCount:0}`, the job settles `completed`, and
`recordSnapshotApplied` is never written. Subjects are neither appended nor
recorded, with no retry — the durable-job guarantee breaks exactly on the
race it exists to absorb.
**Fix:** return `Result.err` on the position-race path so the job defers
and retries with fresh positions (the insert RPCs' `ON CONFLICT DO NOTHING`
makes the retry idempotent). *(Agent finding.)*

### M4. `buildOneProposal`'s rebuild is not transactional — promotion can see `ready` with zero subjects
`proposal-builder.ts:233-307` runs upsert→delete-subjects→insert→flip-ready
as separate PostgREST calls. A concurrent `start_or_resume_match_deck` in
the delete-committed/insert-pending window can promote an **empty deck**
from a proposal still reading `ready` (warm/repair intentionally re-target
ready proposals).
**Fix:** set `status = 'building'` **first** (before deleting subjects) in
the rebuild path — promotion then misses and self-heals; the final `ready`
flip (with the H2 latest-snapshot guard) closes the window. A single plpgsql
rebuild RPC is the thorough alternative. *(Agent finding.)*

### M5. `append_sessions` never chains `capture_ahead`
`poll-match-deck-jobs.ts` `append_sessions` arm: appends + metric, no
capture enqueue. Plan §3's diagram lists `capture_ahead` as part of the
publish-driven chain. A session resumed after a mid-session publish (or one
whose resume pointer sits in the appended region) reads uncaptured cards;
the baked deck view has no R-E fallback, so they render `retryable-error`.
**Fix:** after an `applied` append with `appendedCount > 0`, enqueue
`capture_ahead` for each affected active session (key it on the session's
current `resume_position`, same scheme the action RPCs use). *(GPT finding;
verified.)*

### M6. Song-newness clearing regressed
Old path: `markItemPresented` (`service.ts:417-440`) stamped `presented_at`
**and** called `clearSongNewness` (`queries.ts:1204` — upserts
`account_item_newness.is_new = false`). The deck RPCs stamp `presented_at`
only; `markItemPresented` now has zero production callers. Songs presented
in the deck are never marked viewed, so anything reading
`account_item_newness` (liked-songs status queries,
`status-queries.ts`) sees them as "new" indefinitely.
**Fix:** fold the newness upsert into `read_match_deck_card`'s
mark-presented block (song arm, one `INSERT … ON CONFLICT`), which is where
`presented_at` already lands; then delete the now-dead `markItemPresented`.
*(GPT finding; verified.)*

### M7. Rejected actions discard the fresh view — stale client can soft-lock
`match.tsx:752-758` (finish) and `:1038-1044` (dismiss-card): on a
non-success `actionStatus` (`already_resolved`, `not_found`,
`no_captured_pairs`) the handler releases navigation and **drops
`result.view`** — the server just computed the authoritative state and the
client throws it away. A stale client (second tab, missed invalidation)
retries into the same rejection forever.
**Fix:** on rejection statuses that imply staleness (`already_resolved`,
`not_found`), apply `result.view` via the existing `applyResolvedView` (or
invalidate `matchDeckKeys.deck`) so the UI reconciles instead of looping.
`no_captured_pairs` stays a retry (and is fixed at the root by H4). *(GPT
finding; verified.)*

### M8. Building-recovery effect is one-shot — can strand on "building"
`match.tsx:230-241` fires once per `(isBuilding, firstVisibleMatchReady)`
transition. If the triggered refetch's miss-path promotion returns
`{status:"building"}` again (`promotion_incomplete`,
`match-deck.functions.ts:600-605`), the deps haven't changed, nothing
refires, and there is no `refetchInterval` — the user is stuck until an
incidental refocus refetch.
**Fix:** while `isBuilding && firstVisibleMatchReady`, retry with a bounded
backoff (e.g. `refetchInterval` on the deck query gated by that state), not
a one-shot effect. *(Agent finding.)*

### M9. `applyResolvedView` races in-flight card prefetches
`match.tsx:711-731` writes the post-action card payloads via `setQueryData`
with no `cancelQueries`; the warm-ahead prefetch (`match.tsx:655-660`) for
the same itemId can settle afterwards and clobber the fresher payload.
`dismissSuggestionMutation` (`mutations.ts:164-169`) already guards this
exact hazard.
**Fix:** `await queryClient.cancelQueries({queryKey: itemKey})` for
`cards.current`/`cards.next` before the `setQueryData` writes. *(Agent
finding.)*

### M10. Every swipe pays two discarded DB round trips
`resolveMatchDeckView` (`match-deck.functions.ts:496-524`) always computes
the visibility hash (`resolveMinMatchScore` + `fetchTargetPlaylistFilters`,
two round trips) — but `submitMatchDeckAction`'s read-after-write can only
hit RPC branch 1, which never reads `p_visibility_config_hash`
(`…000008.sql:60-69`). This sits on the exact hop-count-critical path the
plan optimizes.
**Fix:** give `resolveMatchDeckView` a `skipHashComputation` mode for the
read-after-write caller: call the RPC with a null/sentinel hash first, and
compute the hash only if the RPC reports no active session (the promotion/
miss branches — which can't happen mid-action in practice). *(Agent
finding.)*

### M11. `active_proposal_id` is never advanced by appends — stale view metadata
`session-appender.ts` inserts queue items + ledger but never updates
`match_review_session.active_proposal_id`; branch 1 of the RPC reads
snapshot/hash/`hidden_review_item_count` through that FK
(`…000008.sql:61-69` + view assembly). After appends from a newer snapshot,
`MatchDeckView.snapshotId` / `visibilityConfigHash` /
`progress.hiddenReviewItemCount` still describe the superseded proposal.
Item ids and remaining/total counts are computed live from queue items, so
this is metadata/diagnostics drift, not card-content drift — but PostHog
props and any hash-keyed client logic inherit the lie.
**Fix:** when an append applies, update the session's `active_proposal_id`
to the appended proposal's id (same account/orientation/frozen-strictness
hash — it's the legitimate successor). *(GPT finding; verified.)*

### M12. Seed derivation doesn't thread the shared `nowMs` — midnight skew inside one proposal
`proposal-builder.ts:174` calls `computeVisibleSuggestionList(item,
minScore)` **without** the `nowMs` parameter the function already accepts
(`visible-suggestion-list.ts:154,165` — defaults to `Date.now()`), while
subjects + hash use the one shared `nowMs` (`:206-229,328`). A build
straddling UTC midnight can write seed pairs filtered under a different
"today" than the proposal's hash claims.
**Fix:** pass the builder's `nowMs` through `buildSeedForSubject` into
`computeVisibleSuggestionList`. One-line. *(GPT finding; verified.)*

### M13. Post-deploy rollback story is incomplete
Plan §12/§15 says rollback = `git revert`. Two verified holes: (a)
`20260706000009`'s `CREATE OR REPLACE` of the four live action RPCs is not
undone by reverting app code — reverted legacy callers would keep bumping
`deck_revision` and enqueueing `match_review_deck_job` rows with no worker
left to drain them (inert but unbounded growth); (b)
`match_review_proposal.snapshot_id` (`…000003.sql:37`) has no `ON DELETE`
clause → `RESTRICT`, silently changing delete behavior on the legacy
`match_snapshot` table (integration tests already delete from it directly).
**Fix:** (a) keep a ready-to-apply revert-companion migration restoring the
four pre-branch RPC bodies, and say so in §12; (b) make the FK
`ON DELETE CASCADE` — proposals are derived data with no audit value
outliving their snapshot. *(Agent findings; GPT independently flagged (a).)*

---

## 3. Low severity / hardening

- **L1. Deck-job table has no `error_code`/`error_message`** columns, unlike
  its `audio_feature_backfill_job` precedent — dead-lettered jobs are
  diagnosable only via Sentry. Fix: add both columns + populate on
  defer/dead. *(Agent.)*
- **L2. `readMatchDeckCard` is a GET that writes** (`presented_at`, R-E
  capture; the RPC is VOLATILE). Idempotent, but document it and confirm no
  CDN/cache layer ever caches the route's server-fn GETs. *(Agent; also the
  recorded Phase-3 NIT.)*
- **L3. Unexpected RPC statuses map silently to `retryable-error`**
  (`match-deck.functions.ts:354-359,391-398`) with no Sentry — a future
  contract break would be invisible. Fix: `captureServerError` in the
  default arm. *(Agent.)*
- **L4. Proposal tables lack explicit `REVOKE/GRANT`**, relying on RLS
  deny-all + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`
  (`20260613030000…`). Safe today; add the explicit grants for parity with
  newer siblings, and pre-merge, confirm CI applies migrations as role
  `postgres` (default privileges are role-scoped). *(Agent.)*
- **L5. Warm script double-counts failures** — outer catch adds
  `ORIENTATIONS.length` even when one orientation already succeeded
  (`warm-match-deck-proposals.ts:221-228`). Reporting-only. *(GPT + agent.)*
- **L6. Recovered misses aren't measurable as misses.** A successful
  miss→build→promote emits only `match_deck_hit{source:"promoted"}` — the
  same source as a normal branch-2 promotion — so §13's "proposal miss rate
  at entry" can't be computed. Fix: emit `match_deck_miss_reason{reason:
  "no_ready_proposal", recovered:true}` from the miss path, or add a
  distinct `source:"miss_recovered"`. *(GPT; verified.)*
- **L7. `capture_ahead` re-derives already-captured cards** across
  overlapping windows on every job (fresh key per whole-card action).
  Wasteful, not incorrect. Fix: skip items whose
  `visible_pairs_captured_at` is already set before deriving. *(Agent.)*
- **L8. Dead code left behind:** `markItemPresented` (zero prod callers —
  delete after M6 rewires newness), `matchReviewSummaryQueryOptions`,
  `markItemResolved`, `callPresentMatchReviewItemFast`; ~11 stale hoisted
  mocks in `match-review-queue.functions.test.ts`. *(Agent + GPT.)*
- **L9. Stale comments/docs** still describe deleted machinery as live:
  "ships alongside the legacy families" in `deck-queries.ts:13-16` /
  `match-deck.functions.ts:14-16`; present-tense `appendSnapshotDelta`
  references in `eligible-subjects.ts`, `session-appender.ts`,
  `proposal-builder.ts`, `visibility-policy.ts`, `service.ts`;
  `docs/architecture/matching/architecture.md:512`. *(Agent + GPT.)*
- **L10. `proposal-order-parity.test.ts` is partly circular** — its final
  guard asserts `typeof deriveEligibleSubjects === "function"`. With
  `appendSnapshotDelta` deleted, the plan §12 shadow-compare is permanently
  unrunnable; parity now rests entirely on the shared-seam-by-construction
  argument. Fix: replace the vacuous assertion with a fixture test that
  drives `deriveProposalSubjects` end-to-end (mocked queries) and pins the
  emitted subject rows; record in the plan that the shadow-compare gate was
  superseded and why. *(Agent; GPT flagged the missing script.)*

---

## 4. Pre-existing issues surfaced (not regressions of this branch — track separately)

- **P1. Action RPCs validate `account_id` ownership only**, not membership
  in the caller's *active* session (`…000009.sql:59-64`); plan §9's "they
  already do" is inaccurate. Same for `loadOwnedItem`. Byte-identical
  behavior pre-branch. Fix if desired: add a session-status join to the
  ownership check. *(Agent + GPT — GPT presented it as new.)*
- **P2. `sessionStartedRef` isn't scoped per mode** (`match.tsx:249`):
  finish one orientation, switch to an already-caught-up other orientation →
  `CompletionScreen` with zeroed stats instead of the arrival empty state.
  Confirmed byte-identical in `main`. Fix: key the latch by mode or reset it
  in the `key={mode}` remount. *(Agent + GPT — GPT presented it as new.)*
- **P3. Page-wide Suspense blast radius**: the single top-level
  `<Suspense>` (`match.tsx:193-197`) means Previous/Next onto an uncached
  card unmounts the whole page subtree (losing `pastItems`/`sessionStats`).
  Same structure in `main`. Fix: card-scoped Suspense boundary. *(Agent.)*
- **P4. Chunked `.in()` over DB-derived id sets** in the shared visibility
  helpers (`visible-suggestion-list.ts:295-303`,
  `filter-metadata-queries.ts:103-149`, `queries.ts:507-515`) predates the
  branch (files unchanged vs `main`) but does conflict with the project rule
  ("push the predicate into an RPC/join"). The deck builder now runs this
  hot in the worker, so an RPC/join refactor got more valuable. *(GPT raised
  it as a branch issue; it is pre-existing.)*

---

## 5. Accepted residuals (recorded in the decisions log; still agreed, listed for completeness)

- Action RPCs keep `RETURNS TEXT`; `submitMatchDeckAction` does
  read-after-write. The single-RPC rich return is a post-merge fold-in (the
  RPCs are single-caller now). M10 mitigates the interim cost.
- Miss path builds the **full** current-preset proposal ("approach X"), not
  the plan §8.3 bounded first-window scan. Contradicts the plan's letter;
  accepted because misses are rare and enqueue the real build. Keep the
  §13 `match_deck_miss_reason` volume as the watch-signal (needs L6 to be
  measurable).
- Promoted/baked deck-view cards have no R-E on-demand materialize —
  `not_captured` → `retryable-error`, healed by the standalone card read.
  The agent review judged "rare cold edge" **optimistic** given the
  poll-only worker: M2 (priority) + M5 (append chain) + the client refetch
  are the mitigations; re-evaluate after the live pass.
- Song `nextCursor` always null (whole capped set in one read);
  `snapshotId: null` → `""` coercion; double `fetchTargetPlaylistFilters`
  hash-skew residual; claim `p_limit > 1` intra-batch gap (poller uses 1);
  no worker fencing column (idempotent handlers); client-clock settlement
  timestamps; NOTIFY fast path skipped; warm-script page size == PostgREST
  `max_rows`; `job.created_at` as the lag-metric anchor; warm script
  `--help` requires env (import-time validation, matches sibling scripts).
- Scope note: the two `.claude`/CLAUDE.md vendoring commits (`5f7bac94`,
  `b2eb1a82`) are unrelated to the plan — deliberate cloud-session infra,
  harmless to ship or cherry-pick out.

---

## 6. What's verified correct (alignment)

- **Deletion is complete**: all plan §14 symbols gone (grep-verified),
  including the deferred `queue-helpers` cleanup (`5507bfdc`, verified to
  remove only dead code). Both playlist-sync sites rewired to
  `enqueueDeckJob`; no request-path snapshot derivation anywhere.
- **Escape hatch retired**: `6d70eb84` regenerated types, deleted
  `deck-db-types.ts`, repointed call sites; local full Vitest incl.
  DB-gated suites passed per the commit.
- All Phase-4 rulings RA–RG match the code exactly; cache keys derive from
  one factory everywhere; `dismissSuggestionMutation` is exemplary
  optimistic-update code; hooks order clean; `key={mode}` reset correct.
- Authorization: `accountId` only from session context, re-scoped in every
  query/RPC; no cross-account path found.
- Hash-parity seam: one `nowMs` threaded through request-side hash and
  miss-path build (R-B) — correct except the seed gap (M12).
- SQL conventions hold: SECURITY DEFINER + pinned `search_path` +
  REVOKE/GRANT on all functions; DDL genuinely additive; the concurrent-
  promotion `unique_violation` handler is correct against the real partial
  index; `read_match_deck_card`'s playlist arm is byte-parallel with
  `present_match_review_item_fast`.
- Metrics: all five §13 Sentry guardrails + all PostHog events exist and
  the `emitEntryMetrics` gating is correct (hits only on genuine entries).
  `review_queue_appended` correctly re-homed worker-side.
- M2/M3/N1 worker patch-round fixes verified as described; seed-pair parity
  suite genuinely pins the mapping (unlike L10's order suite).

---

## 7. External (GPT) review — scorecard of claims NOT adopted above

Adopted-and-verified GPT claims are credited inline (H1, H4 parts, M1, M5,
M6, M7, M11, M12, L5, L6). The rest:

- **".in() misuse in proposal derivation" — rejected as a branch defect**:
  the helpers are byte-identical to `main` (see P4). Real debt, wrong
  attribution.
- **"`sessionStartedRef` mode bug" — pre-existing** (P2), not introduced by
  the cutover.
- **"Miss path unbounded" / "TEXT returns" / "no shadow-compare" /
  "warm `--help` env" — correct but already recorded** in the decisions log
  as deliberate deviations/residuals (§5 above); L10 adds the one genuinely
  new angle (the parity test's circular assertion).
- **"Full from-scratch replay not done" — correct**, carried into §8.
- GPT missed the SQL/worker-layer defects entirely (H2, H3, M2, M3, M4,
  M9, M13, and the H4 action-deadlock half) — its review and the agent
  review overlap on fewer than a third of the findings, which is why this
  merged document exists.

---

## 8. Pre-merge checklist (supersedes the log's "CONSOLIDATED LOCAL VERIFICATION")

Fixes first:
1. Land H1–H4 (SQL guard predicates, latest-snapshot guards, unique
   indexes + ON CONFLICT, captured-empty stamping for not-entitled).
2. Land the cheap M-fixes that are one-liners or near: M1 (key hash), M3
   (defer on position race), M4 (building-first rebuild), M5 (append→
   capture chain), M6 (newness upsert), M9 (cancelQueries), M12 (seed
   nowMs).
3. Decide M7, M8, M10, M11, M13 (small but need a choice each).

Then verify on a machine with local Supabase + staging:
4. **From-scratch migration replay** (`supabase db reset` → `migration up`)
   for `20260706000003`→`0010` **plus the new fix migrations** — this never
   ran; only 0007–0010 were applied to an existing DB.
5. **The load-bearing hash check**: a normal cold entry is a branch-2 HIT —
   request-path `computeVisibilityPolicyHash` byte-equals the worker
   proposal's `visibility_config_hash` (incl. across a UTC-midnight
   boundary once M12 lands).
6. **Worker drain end-to-end**: publish → `build_proposals` (both
   orientations, 3 presets) → `append_sessions` → `capture_ahead` (M5);
   sweep/mark-dead on a killed worker (re-test after H1); idempotent
   double-runs; H2 regression case (delayed retry of a superseded build
   must not resurrect).
7. **Browser/e2e pass over `/match`**: cold hit, cold miss, preset change,
   filter change (incl. the M1 double-change case), midnight rollover,
   mid-session publish (verify appended cards capture, M5), Previous/Next,
   every action + hard reload after each, optimistic dismiss + rollback,
   caught-up → CompletionScreen, building → no-context CTA, and the H4
   case (revoke entitlement mid-session → card must be resolvable).
8. **Ops**: `warm:match-deck --dry-run` then real run (idempotent re-run;
   spot-check account coverage; watch M2 starvation while a test user
   swipes); Smart Placement deploy + latency delta; PostHog/Sentry live
   verification (dashboards key on `match_deck_action.{revision,
   action_type}` properties, and L6's miss-rate fix).

Do not merge / open a PR until the maintainer asks.
