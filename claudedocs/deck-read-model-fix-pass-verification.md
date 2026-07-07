# Deck read model — fix-pass verification review

Branch: `claude/match-deck-read-model-orchestrate-kzd5xs` @ `45431347`.
Scope: the three fix commits (`933a4c2b` SQL, `c42b6a8d` worker/domain,
`45431347` server/client) that patched H1–H4 / M1–M13 from
`claudedocs/deck-read-model-review-consolidated.md`, plus a validity pass on
the orchestrator's final report, the deviation log
(`claudedocs/orchestration-deck-read-model-fixes-decisions.md`), and the GPT
review claims.

Method: four independent fresh-context review agents (one per fix commit +
one cross-cutting gaps/claims checker), each adversarially re-verifying every
finding's fix against the code at HEAD, plus an independent re-run of all
gates in this session.

Gates re-verified independently: `tsgo --noEmit` (app + worker) clean, `biome
check` clean over 1022 files, `bun run test` — 302 files passed / 1 skipped,
3382 tests passed / 8 skipped / 11 todo, zero failures. The orchestrator's
"all gates green" claim is accurate.

**Follow-up patch + verification applied at HEAD (2026-07-07):** the branch now
patches N1/N2/N3/N4/N5/N7/N8/N9 and materially narrows N10, and the main
deferred G1 non-negotiables have been re-run locally:
- `SUPABASE_DISABLE_TELEMETRY=1 supabase db reset --local` replayed cleanly
  through `20260707000016`; local `schema_migrations` now ends at `000016` on a
  from-scratch DB.
- The load-bearing hash check now passed on the reset DB: a seeded local
  account+snapshot produced a `resolveVisibilityConfigHash` value that matched
  the `buildOneProposal` row byte-for-byte, `start_or_resume_match_deck` missed
  before the build, missed with a wrong hash after the build, and HIT branch 2
  with a ready current card when called with the computed hash.
- `bun run test` was re-run after the reset and remained green at 302 passed / 1
  skipped / 3382 tests passed / 8 skipped / 11 todo.
- `src/routes/_authenticated/match.tsx` now auto-retries baked
  `retryable-error` cards once through the authoritative card read before
  seeding cache, with route tests covering the cold-entry case.
- `src/lib/domains/taste/match-review-queue/deck-jobs.ts` and
  `src/worker/poll-match-deck-jobs.ts` now surface settlement-guard 0-row
  matches via `.select("id")` + `log.warn`.
- `src/lib/server/match-deck.functions.ts` now falls back to computing the real
  hash when the null-hash probe hits a legacy active session with no
  `visibilityConfigHash`.
- `supabase/migrations/20260707000016_match_review_deck_job_claim_priority_index.sql`
  restores index support for the M2 kind-priority claim ordering.
- Dead `updateQueueItemPresented` code and its query-level tests were removed.
- New targeted regression tests now cover `proposal-builder.ts`,
  `session-appender.ts`, and `poll-match-deck-jobs.ts`.
- `docs/architecture/matching/deck-read-model-plan.md` now documents the
  M13(b) FK rollback caveat, and stale `appendSnapshotDelta` docstrings were
  updated in `proposal-builder.ts` / `session-appender.ts`.

---

## 1. Per-finding verdicts

| Finding | Verdict | Notes |
|---|---|---|
| H1 mark_dead lease | **FIXED** | Predicate now matches sweep's staleness test exactly; pending-at-max still dead-letters; sweep/mark_dead row sets disjoint by construction. Follow-up observability gap N2 is now patched at HEAD. |
| H2 stale resurrection | **FIXED** | Both guards landed (`proposal-builder.ts:319-340` ready-flip re-check; `session-appender.ts:234-244` superseded outcome, settles `completed`). Residual TOCTOU shrank from build-duration to one query gap — consistent with the finding's ask. No misclassification path on snapshot-fetch error (propagates as defer). |
| H3 promotion trust | **FIXED** | Unique indexes match the builder's actual dedup (Map-keyed), so legitimate builds can't trip them; `20260706000013` byte-identical to 000008 except the two `ON CONFLICT DO NOTHING` clauses; position holes foreclosed at source by the proposal PK. |
| H4 not-entitled deadlock | **FIXED** | The capture/R-E half is fixed (`captureVisiblePairsAtomic([])` stamp, correct `empty`-status semantics), and the promotion seed-window twin is now masked at the route boundary by auto-retrying baked `retryable-error` cards through the authoritative card read before render. |
| M1 build-key hash | **FIXED** | All 4 sites, key matches plan §5.3; helper's hash composition byte-identical to the request path's (same trio, same nowMs semantics). Worker site correctly uses `@sentry/bun` `Sentry.captureException`, not the Cloudflare-only `captureServerError`. Tests non-vacuous. |
| M2 kind priority | **FIXED** | Ordering exactly as the finding recommended. Inverse starvation (capture flood starving builds) is the designed trade-off, unbounded but accepted. Follow-up index gap N4 is now patched at HEAD. |
| M3 position race | **FIXED** | Any ConstraintError now defers; retry recomputes positions fresh (all-or-nothing batch); bounded by `max_attempts=3` → dead-letter, no spin. |
| M4 rebuild window | **FIXED (no code change — claim verified sound)** | The upsert's `onConflict` matches the real 4-column unique constraint, so `status:'building'` commits in the DO UPDATE SET before delete-subjects. Comment added; reasoning independently confirmed. |
| M5 append→capture chain | **FIXED** | Idempotency key byte-identical to the action RPCs' `v_idem_key`. The no-defer-on-enqueue-failure reasoning verified true (replay short-circuits, would never re-attempt the chain) — lost chains recover only via later publish/action/M2 priority, as the log discloses. |
| M6 newness clearing | **FIXED** | SQL upsert semantically identical to old `clearSongNewness` (same columns, same conflict target, same server clock domain); gated song + `p_mark_presented` only. TS deletion complete (zero references). N7 and N8 are now cleaned up. |
| M7 stale-rejection reconcile | **FIXED** | Applied at all three sites. Stronger than the deviation log's own argument: `already_resolved`/`not_found` are derived from the same state predicate that selects "current", so the fresh view's head can never be the rejected item — the itemId-change release is DB-guaranteed, soft-lock structurally unreachable. |
| M8 building recovery | **FIXED** | Bounded `refetchInterval` (3s × 5), baseline ref reset on gate flap, no hooks/StrictMode hazard (callback runs in the query observer, not render). Cap-exhausted → refocus fallback = the finding's own accepted "bounded" outcome. |
| M9 prefetch clobber | **FIXED** | Awaited `cancelQueries` on exactly the keys about to be written, same key factory as the prefetch; all 6 `applyResolvedView` call sites await it. |
| M10 discarded round trips | **FIXED** | Null-probe reasoning verified against the *live* 000013 body (branch 1 never reads the hash; NULL never matches branch 2 → guaranteed branch-3 fallthrough). Metrics unskewed (`emitEntryMetrics` false on the action path). Follow-up hash-contract gap N3 is now patched at HEAD. |
| M11 active_proposal_id | **FIXED** | `finalizeAppliedAppend` + `advanceActiveProposalOnReplay` close the partial-failure strand; 4-column proposal scoping guarantees hash equality; "not ready → skip" branch sound. Residual: a strand with no subsequent publish stays stale — same metadata-drift class the original finding accepted. |
| M12 seed nowMs | **FIXED** | Threaded through both branches; `card-materializer.ts` deliberately untouched (not a shared-nowMs batch). No other `Date.now()` in the seed/hash path. |
| M13 rollback story | **FIXED** | FK cascade landed (correct auto-generated constraint name); rollback script **byte-diffed** against the four claimed source migrations — zero diff. Plan §12 now documents M13(b)'s FK rollback caveat; N6 (DDL pattern) remains as a low-level follow-up note. |

**Bottom line: all 17 findings are now fixed at HEAD. This review pass surfaced
ten follow-ups of its own; N1/N2/N3/N4/N5/N7/N8/N9 are now patched locally,
G1's reset replay + hash-parity gates are now done, and the remaining open
items are N6 plus the narrowed N10/manual browser/ops verification tail.**

---

## 2. New issues found in the fixes (this pass)

### N1 [RESOLVED] — H4's promotion seed-window twin was live and user-visible
**Status at HEAD now:** fixed client-side in `src/routes/_authenticated/match.tsx`
by auto-retrying baked `retryable-error` cards through the authoritative
`readMatchDeckCard` query before seeding the long-lived card cache. Route tests
cover the retry path.

The orchestrator's report lists this as a non-blocking follow-up; two
independent reviewers traced it end-to-end and it's a real first-paint
regression surface:
- `buildSeedForSubject` returns `[]` for a not-entitled subject
  (`proposal-builder.ts:190-192`) → no `match_review_proposal_seed_pair` row.
- The promotion captured-empty stamp is keyed off seed-pair rows
  (`20260706000013…:186-195`) → that position never gets stamped.
- `start_or_resume_match_deck` bakes `cards.current`/`cards.next` by calling
  `read_match_deck_card` inline in SQL — the path the consolidated review §5
  already noted has **no** R-E fallback — so `not_captured` maps to
  `retryable-error` (`match-deck.functions.ts:386-393`).
- The route loader writes that presentation straight into the card query
  cache via `setQueryData` (`match.tsx:98-107`), bypassing the R-E-capable
  queryFn (30-min staleTime, no auto-refetch).

Net: a subject not-entitled at build time landing in the first
`PROMOTION_SEED_SUBJECTS=3` positions renders "Couldn't load this match card.
Try again." on cold entry, until the auto-enqueued `capture_ahead` job (same
transaction as promotion, M2-prioritized) fixes the stamp in the background or
the user clicks Retry (which invokes the R-E-capable queryFn — one click
resolves it). Bounded and self-healing — the "not a live deadlock" claim is
correct — but the wrong status is shown where the legacy flow showed a
skippable `unavailable` card. Rate **M** (narrow trigger window, bounded
heal), fix before or promptly after merge: stamp captured-empty in the
promotion SQL for any seed-window position lacking a seed-pair row, or
auto-retry `retryable-error` once client-side before rendering it.

### N2 [RESOLVED] — H1's settlement guards had zero observability
**Status at HEAD now:** fixed in `deck-jobs.ts` + `poll-match-deck-jobs.ts`.
`completeDeckJob`/`deferDeckJob` now `.select("id")` and return a boolean row
match; the poll loop logs `match-deck-settlement-guard-hit` on 0-row settles.

`deck-jobs.ts:74-114`: `completeDeckJob`/`deferDeckJob` now carry
`.eq("status","running")` but no `.select()`/count. A 0-row match (the guard
actually firing — job concurrently dead-lettered) returns success; PostgREST
raises no error, so `logSettlementFailure` (`poll-match-deck-jobs.ts:302-315`)
never fires. If H1's own protection is ever exercised in prod it is invisible
in every telemetry channel this job type has — unlike the
`audio-feature-backfill` precedent, whose settlement RPCs return the affected
row. Fix: `.select("id")` and `log.warn` on empty result.

### N3 [RESOLVED] — M10's null probe could corrupt `visibilityConfigHash` in the view contract
**Status at HEAD now:** fixed in `src/lib/server/match-deck.functions.ts` by
falling back to the real hash-computation path whenever the null-hash probe
returns an active session without `visibilityConfigHash`.

Live RPC body (`20260706000013`) shared section: `IF v_vc_hash IS NULL THEN
v_vc_hash := p_visibility_config_hash;` — this fallback fires when
`v_session.active_proposal_id IS NULL`. `active_proposal_id` was added by
`20260706000004` with **no backfill**; a pre-existing active session that has
had no append since (M11 backfills only on append) still has NULL there. Such
an account swiping → `submitMatchDeckAction` → null-hash probe → branch 1 hit
→ `v_vc_hash` stays NULL → falls back to the probe's NULL →
`rpc.visibilityConfigHash ?? ""` (`match-deck.functions.ts:458`) silently
returns `""`. Pre-M10 this line always received the caller's real hash.
Grep confirms **no client-side consumer** of `visibilityConfigHash` today, so
it's inert — but it's exactly the field M11 flagged as feeding PostHog props
and future hash-keyed logic. Cheap fix: in the RPC, skip the fallback when
`p_visibility_config_hash IS NULL`, or have the TS probe path null out the
field instead of coercing to `""`.

### N4 [RESOLVED] — M2's ORDER BY defeated the poll index
**Status at HEAD now:** fixed by
`supabase/migrations/20260707000016_match_review_deck_job_claim_priority_index.sql`,
which adds a partial expression index matching the claim RPC's
kind-priority/available_at/created_at ORDER BY.

The pre-M2 claim query was fully ordered by
`idx_match_review_deck_job_pending_poll (available_at, created_at) WHERE
status='pending'`. Leading with the `CASE j.kind …` expression forces a
materialize-and-sort per claim once queue depth is non-trivial — i.e. exactly
during the warm-flood scenario M2 exists for. Follow-up: expression index or
a generated `priority` column.

### N5 [RESOLVED] — Plan §12 covered M13(a) but not M13(b)
**Status at HEAD now:** fixed in
`docs/architecture/matching/deck-read-model-plan.md`; the rollback section now
calls out the FK `ON DELETE CASCADE` behavior and the need for explicit DB
follow-up if pre-branch FK semantics must be restored.

The 11 lines added to `deck-read-model-plan.md` document the RPC-revert
companion only. The FK `ON DELETE CASCADE` on `match_review_proposal.snapshot_id`
is also a live behavior change on the legacy `match_snapshot` table that
survives a `git revert`, and the plan's "additive schema / no data migration
touched legacy tables" framing (~line 565) is now slightly inaccurate.

### N6 [L] — `20260706000015` FK swap is blocking DDL
`DROP CONSTRAINT` + `ADD CONSTRAINT … FOREIGN KEY` without
`NOT VALID`/`VALIDATE` takes a validation-scan lock. Harmless on this
near-empty table pre-launch; don't copy the pattern once tables carry real
rows.

### N7 [RESOLVED] — Dead test scaffolding left by M6
**Status at HEAD now:** fixed; the stale `updateQueueItemPresented` mock wiring
was removed from `src/lib/domains/taste/match-review-queue/__tests__/service.test.ts`.

`service.test.ts:40,205` still wires a `queries.updateQueueItemPresented`
mock in the global `beforeEach`; its only caller was deleted in the same
commit. Not flagged in the deviation log.

### N8 [RESOLVED] — `updateQueueItemPresented` was dead code
**Status at HEAD now:** fixed; the orphaned function and its query-level tests
were removed.

`queries.ts:562` has zero production callers post-M6; only its own test file
references it. The orchestrator disclosed this deliberately (green coverage,
L-cleanup) — listed here so it isn't lost.

### N9 [RESOLVED] — The L9 scope promise wasn't fully honored
**Status at HEAD now:** fixed; the stale present-tense `appendSnapshotDelta`
references in `session-appender.ts` / `proposal-builder.ts` were updated.

The scope decision said stale-comment (L9) fixes would be made "in files an M
fix already touches" — `session-appender.ts` and `proposal-builder.ts` were
heavily touched but still carry present-tense `appendSnapshotDelta` docstring
references.

### N10 [PARTIAL] — The most intricate fixed logic had no direct regression coverage
**Status at HEAD now:** materially narrowed. New targeted tests now cover
`proposal-builder.ts`, `session-appender.ts`, and `poll-match-deck-jobs.ts`.
The main remaining uncovered area from this cluster is `card-materializer.ts`
and some end-to-end worker interaction paths.

Before this patch, no test files existed for `session-appender.ts`,
`proposal-builder.ts`, `card-materializer.ts`, or `poll-match-deck-jobs.ts` —
the supersede guards, replay self-heal, and capture chain shipped with no
regression guard. That is no longer fully true: `proposal-builder.ts`,
`session-appender.ts`, and `poll-match-deck-jobs.ts` now have targeted tests,
but `card-materializer.ts` still lacks direct regression coverage.
`visible-suggestion-list.test.ts` still has no assertions on the new `nowMs`
param, and some M7/M8/M9 behavior remains better covered by end-to-end worker
paths than by isolated unit tests.

Noted, not scored (already-accepted §5 residual classes, unchanged by the fix
pass): the append-time hash uses its own `Date.now()`
(`session-appender.ts:256`) and can skew across UTC midnight vs. the
proposal's build hash → spurious `no_ready_proposal` defer; and H1's guards
add no fencing token, so a cross-process stale handler from a prior claim
generation can still settle a reclaimed job.

---

## 3. Gaps vs the plan

- **G1 — Pre-merge verification is now PARTIAL, with the two load-bearing
  gates done.** On 2026-07-07 this branch was validated against a fresh local
  DB via `SUPABASE_DISABLE_TELEMETRY=1 supabase db reset --local`, which
  replayed cleanly through `20260707000016`; the local migration table now ends
  at `000016`. The highest-risk hash gate also passed on that reset DB: a
  seeded account+snapshot was used to prove that the request-path
  `resolveVisibilityConfigHash` output matched the worker's stored
  `match_review_proposal.visibility_config_hash` byte-for-byte, that
  `start_or_resume_match_deck` missed before a build, still missed with a wrong
  hash after the build, and HIT branch 2 with a ready current card when called
  with the computed hash. Still pending under the broader G1 umbrella:
  worker-drain end-to-end (including H1/H2 regression behavior), browser/e2e
  over `/match`, and the ops pass (warm run, Smart Placement, live
  PostHog/Sentry).
- **G2 — H4 remainder** was N1 above; this is now patched at HEAD via the
  client-side baked-card auto-retry.
- All 17 H/M findings map to a commit; none silently dropped. Plan §14
  deletion list re-verified intact at HEAD (zero code references to the
  deleted symbols).

## 4. Orchestrator report & deviation log — claim audit

Verified true:
- "All gates green" — independently re-run, exact numbers match.
- Migrations `000011`–`000015` exist, sequenced; `database.types.ts`
  regenerated consistently (`mark_dead…Args = { p_lease_seconds?: number }`).
- Rollback companion exists, is referenced from plan §12, and its four RPC
  bodies byte-match their claimed pre-`000009` source migrations.
- Every checkable per-fix claim in the deviation log held up under
  independent re-derivation — notably M4's "no code change needed" upsert
  argument, M10's null-probe branch analysis, M5's key parity and
  no-defer reasoning, H2(b)'s direct-guard rationale, M6's conflict-target/
  trigger claims, and M13's verbatim extraction. **No fabricated or false
  claims found.**
- Follow-up 2 (`updateQueueItemPresented` orphan) and follow-up 3 (M1
  skip-and-report at the three best-effort sites, with the correct
  worker-vs-server Sentry split) — both accurate.

Needs correction:
- Follow-up 1's framing ("not a live deadlock … worth a dedicated SQL fix
  later") was too soft; the cold-entry defect in N1 was real, though it is now
  patched at HEAD.
- The earlier "git status is clean" note was true at review time only; the
  working tree is now intentionally dirty with the follow-up fixes and this doc
  update, and the branch remains unpushed.

## 5. GPT review — what's real (validity at HEAD)

GPT claims that were **valid and are now fixed**: H1 (mark_dead lease), H4
parts 1–2 (uncaptured not-entitled skip + read-order), M1 (key hash), M5
(append→capture chain), M6 (newness regression), M7 (dropped view), M11
(active_proposal_id), M12 (seed nowMs), M13(a) (RPC revert gap).

GPT claims that were **valid, deliberately left unfixed** (out of the H/M
scope, re-confirmed still present at HEAD): L5 — warm script still
double-counts failures (`warm-match-deck-proposals.ts:244`); L6 — recovered
misses still unmeasurable (`source: "active" | "promoted"` only,
`match-deck.functions.ts:167`). The earlier "from-scratch replay not done"
claim was true at review time but is no longer true at HEAD; the local reset
replay has now been completed through `20260707000016` (see G1).

GPT claims **correctly rejected**, re-checked at HEAD:
- P4 `.in()` misuse — `filter-metadata-queries.ts` remains byte-identical to
  `main`; `queries.ts` and `visible-suggestion-list.ts` were touched by
  M6/M12 but the cited `.in()` regions are untouched, so the "pre-existing,
  wrong attribution" rejection stands (the consolidated doc's "files
  unchanged vs main" phrasing is now technically imprecise, nothing more).
- P2 `sessionStartedRef` — pre-existing, unchanged.
- "Miss path unbounded" / "TEXT returns" / "no shadow-compare" / warm
  `--help` env — all already-recorded deliberate residuals; still accurate.

GPT's blind spots stand as scored in the consolidated doc §7: it missed H2,
H3, M2, M3, M4, M9, M13(b), and the H4 action-deadlock half — all of which
were real and are now fixed. Nothing in this pass rehabilitated a rejected
GPT claim or invalidated an adopted one.

## 6. Alignment (notable)

- The M7 implementation is *provably* safe beyond the deviation log's own
  reasoning: the rejection statuses and the "current card" selection derive
  from the same DB state predicate, so the reconcile can never re-head the
  rejected item.
- The M1 worker enqueue site correctly distinguishes `@sentry/bun` from the
  Cloudflare-only `captureServerError` — an easy mistake it didn't make.
- H3's new unique indexes were checked against the builder's actual insert
  payloads (Map-keyed dedup) — legitimate builds cannot trip them; they fire
  only on genuine derivation bugs, exactly as intended.
- The one review→patch round (M11 replay self-heal) is correctly implemented,
  shared-lookup and all.

## 7. Recommended order of remaining work

1. **Before merge / before opening the PR if you want the doc fully closed
   out:** the broader manual verification tail only — worker-drain end-to-end,
   browser/e2e over `/match`, and the ops pass (warm run, Smart Placement,
   PostHog/Sentry spot-checks).
2. **Strongly preferred before/at merge:** the remaining low-level follow-ups:
   N6 (document/avoid blocking FK-swap pattern) and the narrowed N10 residual
   (`card-materializer.ts` / deeper worker interaction coverage).
3. **Post-merge follow-ups:** remaining L-level cleanup if the branch is opened
   before the manual verification tail is completed.
