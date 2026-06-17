# Match Review Queue Review Findings

Date: 2026-06-16

## Comparison summary

- Direct overlap between Claude's actionable findings and my review: **1** — the user-facing `session` copy in `CompletionScreen`.
- If counting Claude's non-actionable "security rule passes" note, we also agree on that: queue mutations correctly use `queueItemId` and derive `song_id` / `source_snapshot_id` server-side.
- Several non-overlapping Claude findings are valid maintenance or scope concerns and are worth tackling.
- Several of my findings did not appear in Claude's list and should be handled before considering the refactor complete.

## Valid findings worth tackling

### 1. Dashboard CTA count can stay stale after background match refresh

**Source:** my review
**Priority:** High

`runMatchSnapshotRefreshEffects` invalidates `dashboardKeys.pageData` and `dashboardKeys.matchPreviews`, but the dashboard component subscribes to `dashboardKeys.stats` for `reviewCount`. The preview fan can update while the CTA count remains stale.

**How to fix**

- In `src/lib/hooks/useActiveJobs.ts`, also invalidate `dashboardKeys.stats(accountId)` after `syncActiveMatchReviewSession()`.
- Keep `dashboardKeys.pageData(accountId)` invalidation for future route-loader cache freshness.
- Update `src/lib/hooks/__tests__/useActiveJobs.test.ts` to assert the stats key is invalidated.

### 2. First queue creation race can temporarily render an empty/caught-up queue

**Source:** my review
**Priority:** High

In `createOrResumeQueue`, the unique-constraint fallback fetches the session another request created and returns it immediately. If that winning request has not appended snapshot items yet, this caller may fetch an empty queue and render caught-up.

**How to fix**

- In `src/lib/domains/taste/match-review-queue/service.ts`, after fetching the active session in the `ConstraintError` fallback, run the same latest-snapshot append used by the normal resume path before returning `kind: "resumed"`.
- Propagate append errors rather than returning an empty success.
- Add a service test for the constraint fallback that verifies the fetched active session is synced before return.

### 3. Skipped songs cannot currently return in a future pass

**Source:** my review
**Priority:** High / product-semantics

The plan says `Next Song` is "skip for now" and skipped songs can return in a future pass/session. The implementation has one active session per account, never completes or abandons it, and append derivation excludes every song already in the active session. A skipped song is therefore excluded indefinitely.

**How to fix**

- Decide the pass rollover rule now. Minimal option: when an active queue has no unresolved items, mark the session `completed` with `completed_at`, and let the next `/match` entry create a new active session from the latest snapshot.
- Add query/service functions to complete an active session safely.
- Ensure new queue derivation still excludes already-decided playlist pairs, while skipped songs have no negative decisions and can return.
- Add tests for: caught-up session completion, new pass creation, skipped song reappears in a later pass, dismissed songs remain excluded by decisions.

### 4. Unavailable cards are not marked presented and do not clear newness

**Source:** my review
**Priority:** Medium

The UI calls `markMatchReviewItemPresented` only when `getMatchReviewItem` returns `status: "ready"`. Unavailable cards are still presented to the user, but remain `pending` until skipped and their song newness is not cleared.

**How to fix**

- In `src/routes/_authenticated/match.tsx`, call `markMatchReviewItemPresented` for `ready` and `unavailable` item reads. Avoid calling it for `error` if ownership or data integrity is unknown.
- In `markItemPresented`, await `clearSongNewness` inside a `try/catch` instead of fire-and-forget. Swallow failures as intended, but do not risk serverless termination dropping the write.
- Add tests that unavailable item presentation marks the queue item presented and that successful presentation calls `clearSongNewness(accountId, songId, now)`.

### 5. User-facing copy still says "session"

**Source:** both reviews
**Priority:** Low

`src/features/matching/sections/CompletionScreen.tsx` renders "Reviewed this session". The plan asks to avoid frontend terms like `session`.

**How to fix**

- Change the copy to something like "Reviewed this round" or "Recently reviewed".
- Keep analytics/internal event names separate; this is only a user-facing copy issue.

### 6. Duplicated queue derivation logic in the route

**Source:** Claude
**Priority:** Low / maintenance

`queue-helpers.ts` exports tested `deriveUnresolvedIds` and `deriveCaughtUp`, but `match.tsx` inlines equivalent filter/sort logic. It is correct today, but future changes could update only the tested helper and leave the route stale.

**How to fix**

- Import `deriveUnresolvedIds` and `deriveCaughtUp` in `src/routes/_authenticated/match.tsx`.
- Replace the inline unresolved-id `useMemo` and caught-up boolean with the helper calls.
- Keep the existing helper tests as the route logic contract.

### 7. `playlistKeys.all` invalidation is outside the plan

**Source:** Claude
**Priority:** Low / performance

`runMatchSnapshotRefreshEffects` invalidates all playlist queries after match snapshot refresh. The plan's Phase 6 invalidation list does not include playlist data; this may be a carry-over from enrichment invalidation and can trigger unnecessary playlist page refetches.

**How to fix**

- Remove `playlistKeys.all` invalidation unless match snapshot refresh actually changes playlist data.
- If it is intentional, keep it but add a comment explaining which playlist-derived data changes and why the broader invalidation is required.
- Update the `useActiveJobs` tests for the final invalidation set.

### 8. Out-of-scope audio-feature-backfill migration is bundled into this refactor

**Source:** Claude
**Priority:** Low / branch hygiene

`supabase/migrations/20260616120000_settle_backfill_optional_params.sql` is unrelated to the match review queue refactor.

**How to fix**

- If keeping the branch focused, move this migration and its related code/test changes to a separate branch/change.
- If it must stay bundled, call it out explicitly in the PR description as an unrelated safe migration.
- Remove the trailing blank line flagged by `git diff --cached --check` at the end of that migration.

### 9. Missing server-function tests for queue entry points

**Source:** Claude
**Priority:** Medium

The server tests cover item reads and mutations, but not `startOrResumeMatchReview` and `getMatchReview`, which are the route entry points.

**How to fix**

- Add tests in `src/lib/server/__tests__/match-review-queue.functions.test.ts` importing `startOrResumeMatchReview` and `getMatchReview`.
- Cover: no snapshot/no active queue, active queue with unresolved items, active queue caught up, domain/service error surfaces as user-safe thrown error.
- Verify returned `caughtUp` is derived from queue item states, not null song data.

### 10. Missing positive test for clearing newness on presentation

**Source:** Claude
**Priority:** Medium

There is a negative test ensuring newness is not cleared when no eligible row is updated, but the positive path does not assert `clearSongNewness` is called with the expected account and song.

**How to fix**

- Add a positive service test around `markItemPresented`.
- Assert `clearSongNewness` receives the account id, song id, and an ISO-ish timestamp.
- If changing the service to await-and-swallow, add a test that a `clearSongNewness` rejection does not fail the presented transition.

### 11. Sidebar/dashboard sync behavior could use one higher-level test

**Source:** Claude
**Priority:** Low / confidence

There is a unit test that invalidates the summary key after sync, but no higher-level test tying sync completion to summary consumers.

**How to fix**

- At minimum, extend `useActiveJobs` tests to assert `matchReviewSummaryKeys.summary(accountId)` and dashboard stats/previews are invalidated together.
- If a React hook test harness is already available, add an integration-style test for `useActiveJobCompletionEffects` falling edge from running to complete.

## Not carrying forward as actionable

### Security rule concern

Claude's security pass note is correct: match-page queue mutations take `queueItemId`, verify ownership, and derive `song_id` / `source_snapshot_id` server-side. No action needed.

### Completion-screen total count inconsistency

Claude flagged `completionStats.totalSongs` as inconsistent with the card-stack denominator. In the current component, `CompletionScreen` does not render `stats.totalSongs`, so this is not a visible UI bug today. If that field remains unused, consider removing or renaming it later, but it is not a queue-refactor blocker.

### "Skip writes no decisions" test gap

This is already covered at the server-function level: the skip test asserts `mockUpsertMatchDecision` and `mockUpsertMatchDecisions` are not called. A DB/RPC integration test could add confidence, but the claimed missing server-function assertion is not accurate.
