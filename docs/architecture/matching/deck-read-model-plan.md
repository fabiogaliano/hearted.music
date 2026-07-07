# Match deck read model — implementation plan (v2)

> Long-term `/match` refactor plan. Companion to
> `read-vs-write-time-derivation.md` (the plain-language *why*). Builds directly
> on the shipped MSR work (`claudedocs/match-system-refactor/`): the RPC/index
> fast paths proved the assemble-at-request-time architecture tops out around
> ~1.1s because of dependency depth, not row count.
>
> **v2 revision:** grounded against the current code, this version reuses four
> primitives that already exist (`visibility_config_hash`, `match_result_ranking`
> pair order, the capture/read RPC split, the worker job pattern) instead of
> reinventing them, folds deck state into `match_review_session` instead of
> adding parallel deck/card tables, and replaces the feature-flagged rollout
> with a **single-feature-branch cutover**: the new read path is self-healing on
> miss, the schema is purely additive, and rollback is `git revert`.

---

## 1. Verified findings this plan is grounded in

Measured on prod (`hearted.music`, release `085c8a46…`) with a cold hard reload
of `/match` on a real account (845-suggestion playlist), 2026-07-06:

- **The cold load spends ~1.1s of request-path server-fn time** after SSR shell
  + JS boot: auth gate → `startOrResumeMatchReview` (resume RPC, ~572ms in) →
  `presentMatchReviewItem` (done ~1.12s in). Note the wire shape: bootstrap
  already self-seeds the queue query cache (`src/features/matching/queries.ts:64-84`),
  so this is **two dependent network waves, not three** — but the frontend still
  maintains **three separate query families** (bootstrap / queue / present) as
  distinct cache sources that must be kept coherent by choreography.
- **Each Worker→VPS hop costs 200–670ms** (TLS + TTFB + Worker exec) because the
  Worker runs at the edge and Postgres lives on the OVH VPS. Hop *count* × hop
  *cost* is the budget; row count is noise (845 rows stream in ~5ms).
- **The spinner is architectural.** `src/routes/_authenticated/match.tsx` keeps
  its loader empty (walkthrough short-circuit only) and assembles the card
  client-side through Suspense. The loader was evacuated because it previously
  awaited request-time queue derivation and caused 16s FCP while a large library
  was enriching. Putting work back in the loader is only safe if every path is
  bounded.
- **The current fast path is already deployed and is the ceiling.**
  `resume_match_review_session` (read-only, 1 RPC) and
  `present_match_review_item_fast` (read-only, playlist-only, requires pairs
  already captured) are live, plus composite `match_result` indexes.
- **A visibility-policy hash already exists and is persisted.**
  `src/lib/domains/taste/match-review-queue/visibility-policy.ts` defines
  `VisibilityPolicy { orientation, minScore, filtersByPlaylistId }`, the single
  shared predicate `passesVisibilityPolicyForPair`, and
  `computeVisibilityConfigHash` → `vc_<orientation>_<minScore>_<rtfHash>` (with
  UTC-today folding for liked-at-today filters). It is stored in
  `match_review_session_snapshot`, whose PK is
  `(session_id, snapshot_id, visibility_config_hash)`. **This plan reuses that
  hash as the proposal key. No new `policy_hash` concept is introduced.**
- **Per-orientation pair order is already precomputed at publish.**
  `match_result_ranking` stores `(snapshot_id, subject, orientation, rank,
  ordering_score, …)` with partial unique indexes per orientation. Storing full
  pair order again per proposal (v1's `match_review_proposal_pair`) would
  duplicate this table three times over; v2 keeps only a **window-bounded
  promotion seed** (§5.1).
- **The capture/read split partially exists at the RPC level.**
  `capture_match_review_item_visible_pairs_atomic` is the mutating first-write-wins
  capture; `present_match_review_item_fast` is a pure read over captured pairs
  (and re-excludes dismissed pairs in SQL). What's missing is: capture happening
  *off* the hot path, a fast read for song orientation, and deck framing.
- **Durable job infrastructure exists.** The generic `job` table has
  `available_at`, `attempts`, `max_attempts`, `heartbeat_at`, claim RPCs using
  `FOR UPDATE SKIP LOCKED`, and sweep/mark-dead functions; the worker
  (`src/worker/index.ts`) runs poll loops plus a `job_created` LISTEN fast path
  (`src/worker/notify-listener.ts`, auto-disabled on the transaction-mode
  pooler). `audio_feature_backfill_job` is the precedent for a **dedicated job
  table** when a workflow needs its own payload/serialization shape — deck
  maintenance follows that precedent (§5.3).
- **`appendSnapshotDelta` is the request-path snapshot-size work.**
  `src/lib/domains/taste/match-review-queue/service.ts:536-806`: ~10 round
  trips, scans the entire latest snapshot's `match_result` rows, runs on `/match`
  entry (`createOrResumeQueue`) and on playlist mutation/filter sync triggers
  (`src/lib/server/playlists.functions.ts:836,972`). Its idempotency ledger and
  the per-orientation `insert_queue_song_items` / `insert_queue_playlist_items`
  RPCs (`ON CONFLICT DO NOTHING`, partial unique indexes per session+subject and
  session+snapshot+subject) are exactly the machinery a worker-side append job
  needs — the derivation moves, the machinery stays.
- **Snapshot churn is low enough for precomputation.** Worst observed account:
  48 snapshots in 5 days (~10/day). Building read models on publish and policy
  change is practical.
- **RLS convention is deny-all + service-role.** Every table gets
  `ENABLE ROW LEVEL SECURITY` + an explicit `*_deny_all` policy; all access goes
  through `service_role` or `SECURITY DEFINER` RPCs with pinned `search_path`
  and `REVOKE … FROM PUBLIC, anon, authenticated` / `GRANT … TO service_role`.
  No `auth.uid()` owner policies exist anywhere; new tables follow suit.
- **Migrations ship with the merge.** Flat SQL in `supabase/migrations/`,
  applied by CI `supabase db push` on merge to `main`, types regenerated via
  `bun run gen:types`. Schema and code land in one merge — the plan therefore
  requires the schema to be purely additive and the read path to self-heal
  rather than depend on a backfill having run first.
- **No edge optimization exists yet.** `wrangler.jsonc` has no Smart Placement.
  Mutable KV stays out of scope; the win is request-path work and hop count,
  then moving the remaining hop near the VPS.

## 2. Goal and non-goals

**Goal:** replace the old `/match` data model with one first-class deck read
model. The first card is visible at first paint with no client-side
bootstrap → queue → present choreography. The request path does one bounded
operation: start/resume a deck and return the exact view the page renders.

**Cutover constraint (new in v2):** this ships as **one feature branch, no
feature flags**. That imposes two hard requirements:

- The new read path must be **self-contained on miss** — when no prebuilt
  proposal exists (fresh deploy, policy change, midnight filter rollover), the
  same entry point degrades to a *bounded* on-request build of just the first
  deck window and enqueues the full build. There is no legacy runtime fallback
  to lean on.
- The schema change must be **purely additive** and the legacy tables/RPCs left
  physically intact through the merge, so rolling back is reverting the app
  code, nothing else.

**Long-term properties this plan optimizes for:**

- One frontend source of truth for `/match` state.
- No request-time snapshot delta derivation.
- No render-time mutation disguised as a card read.
- Durable, transactional deck maintenance after decisions.
- Proposals keyed by the existing `visibility_config_hash` so first entry after
  publish is fast without creating sessions early.
- Reuse of `match_review_queue_item` + `match_review_item_visible_pair` as the
  timeline and capture authority — no parallel card store, no stored render
  JSON to drift.

**Non-goals:**

- Changing the match scoring pipeline output.
- Solving the first-ever "no snapshot exists yet" cold start; the existing
  building empty state remains.
- Mutable Cloudflare KV for deck state.
- Changing frozen-strictness-per-session semantics (a preset change still takes
  effect on the next session, not mid-pass).

## 3. Target architecture

Four pieces, three of which are mostly reuse:

1. **Proposal** — write-time, sessionless, ordered review subjects for one
   `(account, orientation, snapshot, visibility_config_hash)`. Answers: "under
   this policy, what would the review order be?" Built for all strictness
   presets so a preset change hits a ready proposal. Carries a small
   **promotion seed**: pre-filtered visible pairs for only the first few
   subjects, so first-window capture is pure SQL.
2. **Deck** — the active session's read-model head, stored as new columns on
   `match_review_session` (`active_proposal_id`, `deck_revision`,
   `resume_position`). The session's `match_review_queue_item` rows remain the
   timeline; nothing about decision authority moves.
3. **Cards** — existing capture: `match_review_item_visible_pair` rows written
   by the existing atomic capture RPC. Render payloads are **derived at read
   time inside one RPC** (the `present_match_review_item_fast` pattern,
   generalized to both orientations) — never stored as JSON, so there is no
   payload version to drift and dismissed suggestions disappear on the next
   read with zero rebuild work.
4. **Deck jobs** — a dedicated durable job table drained by the existing VPS
   worker, serialized per `(account, orientation)`. Publish builds proposals,
   appends active sessions, and captures ahead of the user.

```
WRITE TIME (VPS worker, nobody waiting)
  snapshot publish / playlist-filter change / repair
    └─ match_review_deck_job rows, serialized per account+orientation
         ├─ build_proposals: subject order + promotion seed, all presets
         ├─ append_sessions: proposal delta → existing insert RPCs + ledger
         └─ capture_ahead: capture pairs for the next deck window

READ TIME (Cloudflare Worker, user waiting)
  GET /match
    ├─ session from cookie cache                      0 DB hops in cache window
    ├─ loader: startOrResumeMatchDeck                 one bounded server fn
    │    ├─ active deck → one RPC returns MatchDeckView (joins captured pairs)
    │    ├─ no session + ready proposal → in-RPC promotion, same response
    │    └─ no proposal → bounded first-window build in TS + enqueue full build
    └─ stream HTML with card #1 baked in              no Suspense waterfall

ACTION TIME (user acting)
  submitMatchDeckAction
    ├─ one atomic RPC: decision rows + deck advance + revision + job row
    ├─ response carries the promoted next card when already captured
    └─ waitUntil only wakes the worker; correctness never depends on it
```

Why this is faster: `/match` reads one prepared view instead of resuming a
queue, reading it, and presenting a card as dependent operations. Promotion is
bounded to the proposal's subject list (one bulk `INSERT … SELECT`) plus the
seed window, not a snapshot-size derivation. Joining captured pairs inside one
RPC on the VPS costs milliseconds; it is hop count that dies, and it dies to
one.

Why this is more reliable: decisions and deck state move together in one
transaction; background work is durable job rows, not best-effort `waitUntil`;
the frontend renders one deck query instead of three interdependent caches; and
because render payloads are derived at read from captured pairs + live
exclusion of dismissed decisions, there is no stored-document overwrite race
and no stale-payload class of bugs at all.

## 4. Public deck contract

One query contract for the route:

```ts
type MatchDeckView = {
  version: 1;
  accountId: string;
  orientation: MatchOrientation; // "song" | "playlist"
  sessionId: string;
  snapshotId: string;
  visibilityConfigHash: string;
  revision: number;
  progress: {
    total: number;
    remaining: number;
    caughtUp: boolean;
    hiddenReviewItemCount: number;
  };
  /** Ordered unresolved item ids — the client-navigable timeline. */
  itemIds: string[];
  cards: {
    current: MatchDeckCard | null;
    next: MatchDeckCard | null;
  };
};

type MatchDeckCard = {
  itemId: string;
  position: number;
  /** Reuses the existing card read union: ready | unavailable | retryable-error,
   *  subject + suggestions + (playlist arm) suggestionTotal + nextCursor. */
  presentation: MatchReviewItemRead;
};

type MatchDeckAction =
  | { type: "add-suggestion"; itemId: string; suggestionId: string }
  | { type: "dismiss-suggestion"; itemId: string; suggestionId: string }
  | { type: "finish-card"; itemId: string }
  | { type: "dismiss-card"; itemId: string };
```

Decisions baked into this contract:

- **`visibilityConfigHash`, not `policyHash`** — the existing concept (C9 in the
  MSR terminology worksheet) is reused verbatim.
- **`itemIds` stays.** Previous/Next navigation over unresolved items is an
  existing UX behavior (`effectiveItemIds` in `match.tsx`). The deck view ships
  the ordered id list (cheap — ids only) plus two hydrated cards; other cards
  hydrate through `readMatchDeckCard` (§8) exactly like today's per-card
  queries, minus the capture side effect.
- **`MatchReviewItemRead` is reused** as the card payload rather than a new
  presentation type. As part of this refactor its song arm gains
  `suggestionTotal` and `nextCursor` (normally `null`) so both orientations
  share one pagination contract, and song-mode capture gets a cap
  (`SONG_CARD_SUGGESTION_CAP`) alongside the existing
  `PLAYLIST_CARD_SUGGESTION_CAP = 100` so no card can grow without limit.
- The suggestion cursor stays `MatchReviewItemSuggestionCursor`
  (`{ fitScore, modelRank, songId }`) — it already matches the captured-pair
  ordering. The `nextCursor` derivation currently duplicated in three places
  (`readPlaylistCardFromCapture`, its legacy twin, and the fast-path branch)
  collapses into one shared helper used by the deck read RPC wrapper.

`matchReviewBootstrapQueryOptions`, `matchReviewQueryOptions`, and
`presentMatchReviewItemQueryOptions` are not shaped around this contract and are
deleted in the cutover commit — there is no compatibility period (§12).

## 5. Storage model

All new tables follow the house RLS convention (deny-all policy + service-role
access; SECURITY DEFINER RPCs with pinned `search_path` and explicit
revoke/grant). Column vocabulary follows the MSR terminology worksheet:
`fit_score`, `model_rank`, `visible_rank`, `orientation`, `available_at`,
`source_fit_score`.

### 5.1 Proposal tables

`match_review_proposal`

- `id`
- `account_id`, `orientation`
- `snapshot_id`
- `visibility_config_hash`
- `strictness_preset`, `strictness_min_score`
- `read_time_filters_hash` (component hash, for midnight-rollover diagnostics)
- `status`: `building | ready | stale | failed`
- `total_subjects`, `hidden_review_item_count`
- `created_at`, `updated_at`
- unique `(account_id, orientation, snapshot_id, visibility_config_hash)`

`match_review_proposal_subject`

- `proposal_id`, `position`
- `orientation`, `song_id` / `playlist_id` (exactly-one-subject CHECK, mirroring
  `match_review_queue_item`)
- `source_fit_score`
- `was_new_at_enqueue`

`match_review_proposal_seed_pair` — **window-bounded, not full pair order**

- `proposal_id`, `subject_position`
- `song_id`, `playlist_id`
- `fit_score`, `model_rank`, `visible_rank`
- covers only the first `PROMOTION_SEED_SUBJECTS` (≈3) subjects, capped per
  card — ≤ a few hundred rows per proposal

Rationale: full pair order already lives in `match_result_ranking`; duplicating
it per proposal × 3 presets is pure write amplification. The seed exists for
exactly one reason: promotion must capture the first window's visible pairs in
pure SQL, and playlist match filters are evaluated in TypeScript only
(`passesAllMatchFilters`) — so the worker pre-filters the seed at build time,
and the promotion RPC copies seed rows into `match_review_item_visible_pair`
(re-checking `match_decision` exclusions in SQL, same pattern as
`present_match_review_item_fast`). Cards beyond the seed window are captured by
the `capture_ahead` job or, worst case, materialized on demand (§8).

### 5.2 Deck state — columns on `match_review_session`

No new deck table. Add to `match_review_session`:

- `active_proposal_id` (nullable FK)
- `deck_revision` int, default 0 — bumped by every deck-mutating action
- `resume_position` int — authoritative "resume here" pointer; client-side
  Previous/Next browsing does not touch it, decisions advance it

The session already carries the unique active-per-orientation index, frozen
strictness, and status. `match_review_queue_item` rows remain the timeline
(they already have `position`, `state pending|active|resolved`, `resolution`,
subject constraints, and per-session/per-snapshot idempotency indexes).
Progress counters are computed inside the read RPC (a `COUNT` over one
session's items is millisecond work on the VPS; the hop is what costs).

`match_review_session_snapshot` keeps its role as the applied-delta ledger —
the append job writes it exactly as `appendSnapshotDelta` does today.

### 5.3 Durable deck jobs

`match_review_deck_job` — dedicated table (the `audio_feature_backfill_job`
precedent; the generic `job` table has no payload column, and its
one-active-row-per-account-per-type partial-index idempotency is too coarse for
kind+snapshot+hash dedupe):

- `id`
- `account_id`, `orientation`
- `session_id` nullable
- `kind`: `build_proposals | append_sessions | capture_ahead | repair`
- `idempotency_key` (e.g. `build:{account}:{orientation}:{snapshot}:{hash}`),
  unique while not in a terminal status
- `status`, `attempts`, `max_attempts`, `available_at`, `heartbeat_at`,
  timestamps
- `payload jsonb`

Worker integration reuses the existing pattern wholesale: a
`claim_pending_match_review_deck_job()` SECURITY DEFINER function
(`FOR UPDATE SKIP LOCKED`, and skipping rows whose `(account_id, orientation)`
already has a `running` deck job — that is the serialization guarantee), plus
`sweep_stale_*` / `mark_dead_*` siblings, a fourth poll loop in
`src/worker/index.ts`, and optionally the `job_created` NOTIFY fast path via
the existing listener (which already handles the pgbouncer caveat).

Jobs serialized per `(account_id, orientation)` are the race-control mechanism:
publish builds, filter changes, appends, and capture-ahead cannot overwrite
each other out of order. Action RPCs insert job rows **in the same transaction**
as the decision — that is the outbox property; `waitUntil` may wake the worker
early but is never load-bearing.

## 6. Write-time proposal building

Triggers:

- successful `publish_match_snapshot` — chained in the worker right after
  `writeMatchSnapshot` inside `executeMatchSnapshotRefresh` (it already runs
  there; no new transport needed)
- playlist filter/mutation changes — the sync triggers in
  `src/lib/server/playlists.functions.ts:836,972` stop calling
  `syncActiveQueue`/`appendSnapshotDelta` and instead enqueue
  `build_proposals` (+ follow-up `append_sessions`) jobs
- repair/backfill script (also used post-deploy to warm all accounts)
- optional UTC-midnight tick for accounts whose saved filters resolve against
  "today" (the rtf hash changes at midnight); if skipped, the miss path
  self-heals at first entry

Build strategy:

- For each account and orientation, build proposals for **all strictness
  presets** (`open`, `balanced`, `strict`) under the current playlist-filter
  policy. Without full pair storage a proposal is just subject rows + a small
  seed, so 3× is cheap, and a preset change then finds a ready proposal instead
  of forcing first-entry work.
- Derivation reuses the existing shared modules — `getOrderedUndecidedSubjects`
  and the `visibility-policy.ts` predicate — so proposal order and card
  visibility agree by construction, not convention. The parity target is
  byte-for-byte agreement with what `appendSnapshotDelta` would have inserted.
- The seed for the first window is derived with the same
  `computeVisibleSuggestionList` logic used by capture today.

A proposal never creates sessions, queue items, or visible-pair rows.

## 7. Card capture and reads — formalizing the existing split

The primitives already exist; the refactor changes *when* they run and deletes
the conflation:

- **Materialize** (`capture_ahead` job, promotion seed copy, or on-demand
  fallback): create/advance the queue item, capture visible pairs
  first-write-wins via `capture_match_review_item_visible_pairs_atomic`. This
  is today's `presentMatchReviewItem` standard flow, extracted into a shared
  materializer and moved off the hot path.
- **Read** (`read_match_deck_card` RPC): generalize
  `present_match_review_item_fast` to both orientations — pure join over
  captured pairs + song/playlist metadata, dismissed pairs excluded in SQL,
  first page + total + cursor computed in one place. One idempotent write is
  folded in: `presented_at`/newness marking (`UPDATE … WHERE presented_at IS
  NULL`), which lets the separate `markMatchReviewItemPresented` endpoint — one
  POST per card today — be deleted.
- **Tail pages** (`listMatchReviewItemSuggestions`): kept, re-keyed under the
  deck query family, backed by the same shared cursor helper.

`presentMatchReviewItem` and its non-authoritative sibling `getMatchReviewItem`
(already dead from the route's perspective) are deleted in the cutover commit.
The on-demand materialize fallback inside `readMatchDeckCard` is the safety net
when the worker hasn't captured ahead yet — same authority semantics, but it is
the cold path instead of the only path.

## 8. Start/resume deck API

`startOrResumeMatchDeck` server fn + `matchDeckQueryOptions`, backed by one
`start_or_resume_match_deck(p_account_id, p_orientation,
p_visibility_config_hash, …)` RPC (the hash is computed in TS, as resume does
today):

1. **Active deck** → the RPC returns the full `MatchDeckView` in one round
   trip: session/deck columns, unresolved item ids, progress counts, and the
   current + next card payloads joined from captured pairs.
2. **No active session, ready proposal** → in-RPC promotion, same response:
   - create the session (strictness frozen from the preset);
   - bulk `INSERT … SELECT` queue items from `match_review_proposal_subject`
     (single statement; a few thousand rows is tens of ms on the VPS);
   - copy the promotion seed into `match_review_item_visible_pair` for the
     first window, re-checking `match_decision` in SQL;
   - write the `match_review_session_snapshot` ledger row;
   - enqueue a `capture_ahead` job row.
3. **No ready proposal (miss)** → the RPC reports the miss; the server fn runs
   a **bounded first-window build in TypeScript** using the existing shared
   modules (rank-ordered scan via `match_result_ranking` / `match_result`
   composite indexes, visibility predicate, cap per card), promotes just that
   window, and enqueues `build_proposals`. This costs a few extra round trips,
   happens only on fresh-deploy/policy-change/midnight-rollover entries, and
   self-heals — **there is no legacy fallback branch and no flag**.
4. **No published snapshot at all** → the existing building empty state renders,
   as today.

Because every path above is bounded, the route's loader can await this call
again — the original reason the loader was evacuated (unbounded request-time
derivation while enriching) no longer exists. Cold SSR streams HTML with card
#1 baked in; client-side navigations pay one server-fn POST.

## 9. Decision/action API

One deck-aware command boundary: `submitMatchDeckAction(MatchDeckAction)`,
dispatching to the four existing atomic RPCs
(`add_match_review_item_decision_atomic`, dismiss-suggestion, dismiss-card,
`finish_match_review_item_atomic`), each **extended** to, in the same
transaction:

- validate the item belongs to the caller's active session (they already do);
- write the authoritative decision/event rows over captured pairs (unchanged);
- advance `resume_position` (whole-card actions), bump `deck_revision`;
- insert the `capture_ahead` job row;
- return the updated revision, progress, and — when the next card's pairs are
  already captured (the normal case, since capture runs ahead) — the promoted
  next-card payload, so the client needs no follow-up fetch to keep swiping.

Mutation semantics:

- **finish-card / dismiss-card:** resolve the item, advance the deck, return
  the new current card; enqueue capture for the card after it.
- **dismiss-suggestion:** decision row only. No rebuild of anything — the next
  read derives the list from captured pairs minus dismissed decisions (the
  exclusion already lives in the read RPC's SQL). The client keeps its existing
  optimistic cache surgery, now against the deck/card caches.
- **add-suggestion:** decision row; card stays current; client patches
  added-state as today.

Stale `deck_revision` in a request is answered with the current view so the
client can reconcile by refetching one query.

## 10. Frontend route refactor

`src/routes/_authenticated/match.tsx` stops orchestrating three query families:

1. Loader: walkthrough short-circuit unchanged; otherwise await
   `startOrResumeMatchDeck` and seed `matchDeckQueryOptions(accountId, mode)`.
2. `QueueMatchPage` renders from one
   `useSuspenseQuery(matchDeckQueryOptions(...))`.
3. Navigation keeps its current shape but over deck data: `itemIds` +
   per-card `readMatchDeckCardQueryOptions(itemId)` (pure read; prefetch-ahead
   of one card stays as a cheap cache warm, no longer a correctness
   requirement).
4. Card actions call `submitMatchDeckAction`; whole-card resolutions apply the
   returned next-card payload directly to the cache.
5. Tail suggestions use the suggestions infinite query keyed under the deck
   family.
6. `MatchLoading` appears only while the loader promise streams on cold SSR or
   during the rare miss-path promotion.

Deleted from the route layer: `deriveUnresolvedIds`, `locallyResolvedIds` /
`effectiveItemIds` reconciliation (the deck view + returned-next-card make the
server authoritative after every action), both prefetch choreographies as
correctness mechanisms, the `markMatchReviewItemPresented` effect, and the
session-boundary invalidation special-casing (replaced by invalidating the one
deck key plus summary/dashboard keys).

## 11. Active sessions and new snapshots

No request-path `appendSnapshotDelta`, anywhere — including the playlist
mutation/filter sync triggers.

When a new snapshot publishes (worker, post-`writeMatchSnapshot`):

1. `build_proposals` builds fresh proposals per preset; prior proposals for the
   account+orientation are marked `stale`.
2. `append_sessions` appends newly visible, undecided proposal subjects into
   each active session's queue items via the existing insert RPCs, deduped by
   the existing partial unique indexes and prior decisions, and records the
   `(snapshot, hash)` ledger row.
3. The active user's current card is never invalidated; new subjects land after
   the current window. The client learns about them the next time the deck
   query refreshes (existing `runMatchSnapshotRefreshEffects` invalidation
   keeps working, now pointed at the deck key).

Mid-review hard reloads are stable by construction: DB deck state is what the
view renders.

## 12. Single-branch landing sequence

One feature branch, reviewable as ordered commits, merged once; CI applies
migrations then deploys. Because the read path self-heals on miss, there is no
backfill-ordering constraint — the warm script is a latency optimization, not a
correctness step.

1. **Schema + RPCs (additive only).** Proposal tables, session deck columns,
   `match_review_deck_job` + claim/sweep/dead functions,
   `start_or_resume_match_deck`, `read_match_deck_card`, extended action RPCs.
   `bun run gen:types`. Nothing legacy is dropped here.
2. **Worker: builders + jobs.** Proposal builder (all presets), seed
   derivation, `append_sessions`, `capture_ahead`, repair; fourth poll loop.
   Vitest parity suites on fixtures: proposal subject order ≡
   `appendSnapshotDelta`-would-insert; seed pairs ≡ `computeVisibleSuggestionList`.
3. **Server contracts.** `startOrResumeMatchDeck`, `readMatchDeckCard`,
   `submitMatchDeckAction`, deck query options, shared cursor helper, song-arm
   pagination fields + `SONG_CARD_SUGGESTION_CAP`.
4. **Route cutover.** `match.tsx` renders `MatchDeckView`; old orchestration
   removed from the route in the same commit as the new rendering lands (no
   dual-path state).
5. **Delete legacy.** `appendSnapshotDelta` + its playlist-sync call sites,
   `createOrResumeQueueLegacy`, `presentMatchReviewItem` +
   `getMatchReviewItem` + `markMatchReviewItemPresented`, the three legacy
   query families, `readPlaylistCardFromCapture*` duplication. Legacy SQL
   objects (`resume_match_review_session`, old insert-path helpers still used
   by jobs are kept) get dropped only in a later cleanup migration once prod
   soak confirms.
6. **Ops.** `scripts/` warm/backfill script (build proposals for all accounts),
   Smart Placement in `wrangler.jsonc`, metrics wiring (§13).

Rollback story: revert the merge commit. The additive schema tolerates old
code; the one legacy-table behavior change is the snapshot FK swap below.

**Rollback note (review M13a):** reverting the merge commit does NOT undo
`20260706000009_extend_deck_action_rpcs.sql`'s `CREATE OR REPLACE` of the four
live action RPCs (`add_match_review_item_decision_atomic`,
`dismiss_match_review_item_suggestion_atomic`, `finish_match_review_item_atomic`,
`dismiss_match_review_item_atomic`) — SQL migrations are additive/forward-only
and are not rolled back by a git revert. After reverting the app code, also run
`claudedocs/rollback/restore-pre-deck-action-rpcs.sql` by hand (service-role,
against the target database) to restore those four RPCs to their pre-branch
bodies. That script is deliberately kept outside `supabase/migrations/` so it
never auto-applies.

**Rollback note (review M13b):** `20260706000015_proposal_snapshot_fk_cascade.sql`
replaces `match_review_proposal.snapshot_id`'s FK with `ON DELETE CASCADE`.
That DDL touches the live `match_snapshot` relationship and also survives a git
revert; if rollback needs the pre-branch FK semantics, restore the prior
constraint explicitly as a follow-up DB change.

Pre-merge verification (replaces the flagged parallel-run):

- parity vitest suites from commit 2 running in CI;
- a read-only shadow-compare script in `scripts/` runnable against prod data:
  for a sample of accounts, build a proposal in memory and diff subject order
  and first-window pairs against the live `appendSnapshotDelta` +
  `computeVisibleSuggestionList` outputs;
- a staging/local end-to-end pass over: cold entry (hit), cold entry (miss),
  preset change, filter change, midnight-hash rollover, mid-session publish,
  hard reload after each action type.

## 13. Verification and metrics

Success criteria, measured the same way as the baseline:

| Metric | Baseline | Target |
| --- | --- | --- |
| Server-fn critical path, cold `/match` | ~1.1s, 2 dependent waves | 1 deck start/resume call |
| First card paint | spinner on cold load | card in first SSR render on deck hit |
| Request-time snapshot derivation | full-snapshot scan on create/resume | none (worker jobs only) |
| Card render side effects | present captures while rendering | pure read over captured pairs |
| Hard reload after swipe | depends on cache/refetch timing | DB deck state authoritative |
| Proposal miss rate at entry | n/a | near zero after warm script |
| On-demand materialize rate | 100% (every card) | rare (capture-ahead outruns swiping) |

Guardrails:

- Sentry on proposal build failure, promotion failure, deck action transaction
  failure, on-demand materialize in the read path, and deck job dead-lettering.
- PostHog: `match_deck_hit`, `match_deck_miss_reason`, `match_deck_revision`,
  `match_deck_action_type`, `match_deck_materialize_on_read`.
- Worker-side lag metric: time from publish to proposals `ready`, and from
  action to next-window captured.

## 14. Cleanup — the proof this fixed the root cause

Deleted by commits 4–5 (not "downgraded", deleted):

- `matchReviewBootstrapQueryOptions`, `matchReviewQueryOptions`,
  `presentMatchReviewItemQueryOptions` and their cache-seeding choreography.
- First-card and next-card prefetch as correctness mechanisms;
  `deriveUnresolvedIds`; `locallyResolvedIds`/`effectiveItemIds` reconciliation.
- `presentMatchReviewItem`, `getMatchReviewItem`,
  `markMatchReviewItemPresented`.
- `appendSnapshotDelta` and both playlist-sync call sites;
  `createOrResumeQueueLegacy`; the triplicated `nextCursor` derivation.

A root-cause refactor shrinks the hot path *and* the frontend state model. If
the final system still needs three query families or any request-path
snapshot-size work to render `/match`, the refactor is incomplete.

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| No-flag cutover ships a regression | Additive schema + `git revert` restores the old system intact; parity suites + shadow-compare script + staged e2e pass run pre-merge. |
| Proposal miss on first post-deploy entries | Miss path is a bounded in-request first-window build + enqueue, not a spinner; warm script removes most misses before users arrive. |
| Proposal policy drift | Proposals keyed by the existing `visibility_config_hash` (incl. UTC-today folding); filter changes enqueue rebuilds; all presets prebuilt. |
| Worker lags behind a fast swiper | `readMatchDeckCard` materializes on demand (today's semantics) — slower card, never a wrong or missing card; lag metric + Sentry watch it. |
| Deck action / job race | Same-transaction decision + revision + job row; jobs serialized per account+orientation; stale revisions answered with the current view. |
| Seed pairs stale vs decisions made after build | Promotion re-checks `match_decision` in SQL when copying seed rows (existing fast-path pattern). |
| Mid-review snapshot publish | Appends land after the current window via existing dedupe indexes; the current card is never invalidated. |
| Song-mode cards unbounded | `SONG_CARD_SUGGESTION_CAP` at capture + unified pagination contract. |
| One VPS hop remains (no KV) | Smart Placement moves the Worker near the VPS; immutable/versioned edge cache stays a later, optional project. |
