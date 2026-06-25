# Match System Refactor Implementation Phases

Date: 2026-06-25

## Source of truth

- `claudedocs/match-system-refactor/match-system-refactor-unified-plan.md`
- `claudedocs/match-system-refactor/match-system-terminology-decisions.md`
- Current architecture/code in matching docs, match queue, ranking, publishing, `/match`, dashboard/sidebar summary, and library-processing job paths.

## Dependency framing

The plan sections describe the target system by area. The implementation needs to land by dependency instead:

1. Shared contracts must be stable before schema/code/UI branches split.
2. Schema and generated DB types must land before server code can use orientation, ranking rows, visible-pair capture, and job availability.
3. Ranking publication must exist before read paths can rely on orientation-specific model ranks.
4. Orientation-aware queue subjects must exist before playlist-mode reads and UI can be authoritative.
5. Visible-pair capture must exist before queue mutations can validate/log the ranks the user saw.
6. UI toggle can safely launch only after server reads/mutations preserve per-orientation progress and stable visible ranks.

## Shared-contract work that must land before parallel work

These contracts should be introduced first and kept boring. Parallel implementation should not start until these names/shapes are agreed and typechecked.

- `MatchOrientation = 'song' | 'playlist'` for domain/server/schema orientation.
- `MatchViewMode = 'song' | 'playlist'` for route/UI mode.
- `MatchReviewSubject` discriminated union instead of optional `songId` / `playlistId` in exported types.
- `strictnessScore(row)` as the only strictness/match-percent source, using `fused_score ?? score`.
- Ranking contracts: `RankedPair`, `RankedSuggestionLists`, `RankingSource`, `RankingDocumentMode`, `RERANK_INSTRUCTION_BY_ORIENTATION`.
- Queue item lifecycle split: `state = pending | active | resolved`, `resolution = added | dismissed | skipped | unavailable | null`.
- Visible capture contracts: `VisibleSuggestionList`, `match_review_item_visible_pair`, `capture_match_review_item_visible_pairs_atomic`, `presentMatchReviewItem`.
- Public reason/status spelling: DB/RPC `snake_case`, UI/server result `kebab-case`.
- Query key contract with orientation in review/summary keys and item keys remaining item-id-only.
- Route search contract: `/match` is canonical song mode; `/match?mode=playlist` is playlist mode; `mode=song` and invalid values normalize away.

## Critical serial path

```txt
Baseline/contracts
  → Schema + DB types
  → Oriented ranking publication
  → Orientation-aware queue/session subjects
  → Visible suggestion-list + presentation capture
  → Captured-row mutations/event logging
  → Route/UI mode launch
  → Read-time hard filters
  → Docs/cleanup
```

## Parallelizable branches

After shared contracts and schema land, these branches can proceed mostly independently:

- **Refresh-cost branch:** job `available_at`, pending-job coalescing, superseded checks, runner/reconciler handling.
- **Ranking branch:** retention helper, oriented ranking module, reranker instruction override, snapshot hash/publish changes.
- **Preference/summary branch:** `match_view_mode`, preferred summary, dashboard/sidebar links and labels.
- **UI component branch:** playlist review item and song suggestion row prototypes against typed fixtures, before server wiring.
- **Filter branch:** predicate/metadata helper extraction can begin early, but moving filters to read-time waits for visible-list and visibility-hash contracts.

---

## Phase 0 — Baseline and shared contracts

### Goal

Create the stable language, types, and helper seams that every later phase depends on.

### Why this phase exists

The current code is song-only in the queue/UI, uses `score` for strictness/display, has playlist-oriented reranking persisted into universal `rank`, and uses queue states that mix lifecycle and outcome. If branches start before the contracts are stable, they will encode incompatible assumptions.

### Inputs/dependencies

- Source docs and terminology decisions.
- Current queue/ranking/UI files:
  - `src/lib/domains/taste/match-review-queue/types.ts`
  - `src/lib/domains/taste/song-matching/types.ts`
  - `src/lib/server/match-review-queue.functions.ts`
  - `src/lib/server/matching.functions.ts`
  - `src/features/matching/types.ts`
  - `src/routes/_authenticated/match.tsx`

### Outputs

- Canonical shared TS types and aliases.
- `strictnessScore(row)` helper with tests.
- Skeleton contracts for ranking, visible suggestion lists, route search, query keys, and public server result shapes.
- Current partial score/reranker read-path WIP reset or isolated so it cannot ship independently.

### Key touchpoints

- `src/lib/domains/taste/song-matching/queries.ts`
- `src/lib/domains/taste/match-review-queue/types.ts`
- `src/features/matching/types.ts`
- `src/features/matching/queries.ts`

### Risks

- Accidentally exposing nullable `{ songId?: string; playlistId?: string }` across server/UI boundaries.
- Leaving some read paths on `score` while others move to `fused_score`.
- Starting UI/server branches with different names for the same concepts.

### Parallelizable within phase

- Type definitions and helper tests.
- Query-key contract changes.
- Route-search parser/normalizer tests.

### Exit criteria

- The project typechecks with new shared types available.
- `strictnessScore` is tested and imported by at least one existing read/queue derivation path or ready for migration.
- No new code depends on reranker `score` for strictness/match percent.

---

## Phase 1 — Schema, RPC shells, and generated DB types

### Goal

Make the database able to represent orientation-specific ranking, independent match passes, captured visible pairs, preferred match mode, and delayed job claims.

### Why this phase exists

Server code cannot safely become orientation-aware until rows can store orientation and valid subjects. Mutations cannot validate shown suggestions until captured visible pairs exist. Refresh coalescing cannot land without `job.available_at`.

### Inputs/dependencies

- Phase 0 contracts.
- Existing migrations:
  - `20260615220229_match_review_queue.sql`
  - `20260617150000_match_event_log.sql`
  - `20260617160000_capture_snapshot_playlist_profile.sql`
  - `20260327200650_add_library_processing_claim_helpers.sql`

### Outputs

- `match_result_ranking` table and uniqueness indexes.
- `match_review_session.orientation` and one-active-per-orientation index.
- `match_review_queue_item.orientation`, nullable `song_id`, `playlist_id`, `source_fit_score`, `visible_pairs_captured_at`, subject check, partial unique indexes.
- Queue lifecycle constraints for `pending | active | resolved` plus separate resolution.
- `match_review_session_snapshot.visibility_config_hash` in primary key.
- `user_preferences.match_view_mode`.
- `match_review_item_visible_pair` table and indexes.
- `match_event` / `match_decision` rename/add columns for `served_orientation`, `model_rank`, `visible_rank`.
- `job.available_at` and claim indexes.
- RPC definitions/shells for capture/add/dismiss/finish with target signatures.
- Regenerated `src/lib/data/database.types.ts`.

### Key touchpoints

- `supabase/migrations/**`
- `src/lib/data/database.types.ts`
- RPC grants/search-path hardening migrations.

### Risks

- Nullable `song_id` with old unique indexes would allow duplicate playlist-mode rows.
- Migrating `match_review_session_snapshot` primary key can break idempotency if callers are not updated quickly.
- Renaming event/decision rank columns requires all SQL and TS callers to move together.
- RPC shells must preserve older publish callers without nested rankings.

### Parallelizable within phase

- Ranking table migration.
- Queue/session migration.
- Visible-pair/event/decision migration.
- Job `available_at` migration.
- Preference column migration.

### Exit criteria

- Migrations apply cleanly.
- Generated DB types include all new columns/tables/RPCs.
- Existing tests either pass or fail only on expected compile-time call-site migrations.

---

## Phase 2 — Refresh coalescing foundation

### Goal

Reduce wasted refresh work before enabling both ranking orientations.

### Why this phase exists

Computing both orientations can increase reranker cost. Pending-job debounce and cooperative supersession are mostly independent of match UI and should land before costlier ranking behavior.

### Inputs/dependencies

- Phase 1 job schema.
- Current job orchestration:
  - `src/lib/platform/jobs/library-processing-queue.ts`
  - `src/lib/workflows/library-processing/scheduler.ts`
  - `src/lib/workflows/library-processing/reconciler.ts`
  - `src/lib/workflows/library-processing/types.ts`
  - `src/lib/workflows/library-processing/runner.ts`
  - `src/worker/execute.ts`
  - `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`

### Outputs

- Claim RPC only claims `available_at <= now()`.
- `resolveMatchRefreshAvailableAt` and debounce map by change kind.
- `ensureMatchSnapshotRefreshJob` updates pending jobs instead of returning unchanged.
- Pending job update preserves/ORs `needsTargetSongEnrichment`.
- `isMatchRefreshJobSuperseded` helper.
- Non-error `superseded` execution outcome, measurement outcome, reconciler change, terminal recovery behavior.
- Superseded checks at existing expensive boundaries; ranking loop checkpoint added later in Phase 3.

### Key touchpoints

- `claim_pending_library_processing_job` migration/RPC.
- `ensureMatchSnapshotRefreshJob`.
- `executeMatchSnapshotRefreshJob` / `executeMatchSnapshotRefresh`.
- library-processing changes/reconciler/runner tests.

### Risks

- Marking superseded jobs as failed would trigger incorrect retry/error behavior.
- Advancing `settledAt` for superseded jobs would hide newer requests.
- Pending immediate triggers must be able to pull a debounced job forward to `available_at = now()`.

### Parallelizable within phase

- SQL claim/index changes.
- Ensure/update behavior.
- Reconciler/runner outcome handling.
- Checkpoint helper tests.

### Exit criteria

- Pending match refresh jobs are not claimed before `available_at`.
- Repeated playlist config saves coalesce into one pending job.
- A superseded running job exits completed/superseded, publishes nothing, and causes a fresh ensure when needed.

---

## Phase 3 — Oriented ranking and atomic publication

### Goal

Publish orientation-specific suggestion-list ranks for both song and playlist modes while keeping `match_result` as the shared pair table.

### Why this phase exists

Read paths and event logs need ranks from the exact suggestion-list orientation. The current `rerankMatches` groups by playlist and mutates `score`/`rank` as if they were universal.

### Inputs/dependencies

- Phase 0 ranking contracts.
- Phase 1 `match_result_ranking` schema and publish RPC support.
- Phase 2 superseded helper for checkpoints.
- Current code:
  - `src/lib/domains/taste/song-matching/service.ts`
  - `src/lib/workflows/enrichment-pipeline/reranking.ts`
  - `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
  - `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
  - `src/lib/domains/taste/song-matching/cache.ts`
  - `src/lib/domains/enrichment/embeddings/hashing.ts`
  - `src/lib/integrations/reranker/service.ts`

### Outputs

- `retainStoredMatchPairs` using song-top-N / playlist-top-N union.
- `src/lib/workflows/enrichment-pipeline/match-ranking.ts`.
- `rankSongSuggestionLists` and `rankPlaylistSuggestionLists`.
- `RerankerService.rerank(query, candidates, { instruction })` without mutating shared service config.
- Row-level `source`, `ordering_score`, `reranker_score`, `document_mode` semantics.
- `MATCH_RANKING_ORIENTATIONS = ['song', 'playlist']`.
- `hashRankingConfig` with `rk_` prefix and `rankingConfigHash` in `snapshotHash`.
- `publish_match_snapshot` inserts nested ranking rows atomically and still accepts legacy payloads.
- Legacy `match_result.score/rank` mirrors song-orientation compatibility where possible.
- Superseded checkpoint inside ranking between suggestion lists.

### Key touchpoints

- Matching service retention/ranking tests.
- Reranker service/provider tests.
- Snapshot hash tests.
- Publish RPC integration tests.

### Risks

- Stored pair retention can starve playlist mode if union logic is wrong.
- Partial rerank tails must be `fused_fallback`, not `rerank`.
- Hashing only `MATCHING_ALGO_VERSION` is insufficient; snapshots dedupe by `snapshot_hash`.
- Ranking table uniqueness requires dense ranks per suggestion list.

### Parallelizable within phase

- Retention helper and tests.
- Reranker instruction override.
- Ranking module implementation.
- Hash/publish migration.

### Exit criteria

- New snapshots contain `match_result_ranking` rows for both orientations.
- Legacy publish without `rankings` still works.
- Strictness/match-percent paths do not read `ordering_score`/`reranker_score`.
- A snapshot is forced after ranking config/schema changes even if candidates/playlists are unchanged.

---

## Phase 4 — Orientation-aware queue, summaries, and preferences

### Goal

Represent active match passes independently per orientation and expose orientation-scoped server contracts and summaries.

### Why this phase exists

Playlist mode cannot safely exist if it shares one active session and song-only queue item shape with song mode. Dashboard/sidebar summaries need the user’s preferred mode without overriding an explicit `/match` URL.

### Inputs/dependencies

- Phase 0 subject/query-key/preference contracts.
- Phase 1 queue/session/preference schema.
- Phase 3 ranking rows available for read-time ordering.
- Current code:
  - `src/lib/domains/taste/match-review-queue/service.ts`
  - `src/lib/domains/taste/match-review-queue/queries.ts`
  - `src/lib/server/match-review-queue.functions.ts`
  - `src/lib/server/dashboard.functions.ts`
  - `src/routes/_authenticated/-components/Sidebar.tsx`
  - `src/lib/domains/library/accounts/preferences-queries.ts`

### Outputs

- `fetchActiveSession(accountId, orientation)` and `insertMatchReviewSession({ ...orientation })`.
- `createOrResumeQueue`, append/sync, and pass rollover orientation-aware.
- `getOrderedUndecidedSubjects` with song-mode newness priority and playlist-mode fit-score ordering.
- `MatchReviewQueueItemDto` exposes `subject: MatchReviewSubject`.
- Orientation-scoped `startOrResumeMatchReview`, `getMatchReview`, `getMatchReviewSummary`.
- `getPreferredMatchReviewSummary` uses `user_preferences.match_view_mode`.
- `getPreferredMatchViewMode` / `setPreferredMatchViewMode` helpers.
- Query keys include orientation for review/summary; preferred summary has its own key.
- `syncActiveMatchReviewSessions` syncs all active orientations.
- Dashboard/sidebar summary/link behavior follows saved preference.

### Key touchpoints

- Queue repository mappers.
- Queue service append/idempotency.
- Dashboard aggregate functions.
- Sidebar nav config/link target.
- `useActiveJobs` invalidation roots.

### Risks

- Existing song-mode queue must remain compatible through migration defaults.
- Session snapshot idempotency must include visibility hash without blocking same-snapshot newly visible subjects later.
- Dashboard/sidebar must use preference, while `/match` must use URL as source of truth.

### Parallelizable within phase

- Preference helpers and summary delegation.
- Queue repository type migration.
- Subject derivation helper.
- Query key migration.

### Exit criteria

- A user can have one active song session and one active playlist session.
- Song-mode queue behavior remains equivalent except for using `strictnessScore`.
- Preferred summary/dashboard/sidebar use saved mode.
- `/match` route callers can request a specific orientation without relying on preference state.

---

## Phase 5 — Visible suggestion-list and presentation capture

### Goal

Make the first presented suggestion list the authority for visible ranks and action validation.

### Why this phase exists

Ranks can drift after decisions or filter changes. Add/dismiss/skip must log the ranks the user actually saw, not ranks recomputed later.

### Inputs/dependencies

- Phase 1 visible-pair schema and capture RPC.
- Phase 3 orientation rankings.
- Phase 4 orientation-aware queue subjects/sessions.
- Existing card read paths:
  - `getMatchReviewItem`
  - `getMatchResultDetailsForSong`
  - `getMatchDecisionsForSongs`
  - playlist/song ownership and entitlement queries

### Outputs

- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`.
- Orientation-specific ownership/entitlement checks.
- Strictness filtering via `strictnessScore`.
- Decided-pair removal.
- Ranking join and stable fallback ordering.
- Dense `visibleRank` assignment.
- `capture_match_review_item_visible_pairs_atomic` fully implemented.
- `presentMatchReviewItem({ itemId })` derives, captures, marks active, and returns captured rows with render data.
- Existing `getMatchReviewItem` remains side-effect-free/prefetch-only.
- Song-mode active rendering migrates to captured rows.
- Playlist-mode read shape added from the same capture path.
- Liked-song suggestions use song orientation ranking directly without capture.

### Key touchpoints

- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- `src/lib/domains/taste/song-matching/queries.ts`
- capture RPC migration/tests.

### Risks

- Prefetched `getMatchReviewItem` data must not become the authoritative rendered card after capture ships.
- Empty captures must set `visible_pairs_captured_at` and remain idempotent.
- Multi-tab retries must return existing rows, not re-dense ranks.
- Filter metadata failures need a retryable error shape, not a resolved/unavailable card.

### Parallelizable within phase

- Pure visible-list derivation tests.
- Capture RPC tests.
- Server function mapping for song-mode and playlist-mode render data.
- Liked-song suggestion migration.

### Exit criteria

- Presenting a card creates or returns stable captured visible pairs.
- Song-mode cards render from captured rows with unchanged visual behavior.
- Playlist-mode server reads return typed review item/suggestion data.
- No action path needs to reconstruct visible rank from current `match_result` rows.

---

## Phase 6 — Captured-row mutations and event logging

### Goal

Make add, dismiss, finish, and skip orientation-aware and validate every queue action against captured visible pairs.

### Why this phase exists

Once visible capture is authoritative, mutations must stop accepting client/server-derived live suggestion lists. This phase locks in correct event/decision context before UI launch.

### Inputs/dependencies

- Phase 5 captured visible-pair rows.
- Phase 1 event/decision columns and RPC signatures.
- Existing queue mutation server functions and atomic RPCs.

### Outputs

- `AddFromQueueSchema = { itemId, suggestionId }`.
- `add_match_review_item_decision_atomic(p_suggestion_song_id?, p_suggestion_playlist_id?)` validates orientation and captured pair.
- `dismiss_match_review_item_atomic` reads captured rows; server derives/captures first if needed.
- `finish_match_review_item_atomic` logs skipped events from captured rows and resolves added/skipped.
- All queue events/decisions populate `served_orientation`, `model_rank`, `visible_rank` from `match_review_item_visible_pair`.
- Direct/non-queue decisions leave served context nullable.
- Public result reasons map DB statuses to kebab-case.

### Key touchpoints

- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/domains/taste/song-matching/decision-queries.ts`
- `supabase/migrations/**match_event**`

### Risks

- Add must reject suggestions not captured for that card, even if the pair exists in the snapshot.
- Dismiss/finish with no captured rows must follow the plan’s empty/derive behavior without writing incorrect events.
- Added decisions must prevent duplicate dismissed/skipped events for the same queue item and pair.

### Parallelizable within phase

- Add RPC/server migration.
- Dismiss RPC/server migration.
- Finish/skip RPC/server migration.
- Event/decision assertion tests.

### Exit criteria

- Song-mode add/dismiss/finish still works.
- Playlist-mode add/dismiss/finish works from the same public server functions.
- Event and decision rows carry served orientation, model rank, and captured visible rank for queue actions.
- Visible ranks do not re-dense after an add or retry.

---

## Phase 7 — Route and UI mode launch

### Goal

Ship `/match` with a URL-backed Song/Playlist toggle and swapped playlist-mode composition while preserving song-mode UX.

### Why this phase exists

The UI should be the final integration layer, not the place where rank/session/action semantics are invented. By this point, both modes have authoritative server reads and mutations.

### Inputs/dependencies

- Phase 0 route/UI contracts.
- Phase 4 orientation-scoped queue APIs and preference helpers.
- Phase 5 `presentMatchReviewItem`.
- Phase 6 captured-row mutations.
- Existing UI:
  - `src/routes/_authenticated/match.tsx`
  - `src/features/matching/Matching.tsx`
  - `src/features/matching/sections/MatchingHeader.tsx`
  - `src/features/matching/sections/MatchingSession.tsx`
  - `src/features/matching/components/MatchesSection.tsx`
  - `src/features/matching/components/SongSection.tsx`
  - `src/features/matching/components/usePlaylistTrackPreview.tsx`

### Outputs

- `validateMatchSearch`, `modeFromSearch`, `hasNonCanonicalMatchMode`.
- Route normalization with `replace: true`.
- Loader deps include mode; queue bootstrap/prefetch uses orientation.
- `QueueMatchContent` remounts by mode and resets visit-local state on mode switch.
- Header toggle beside count with accessible segmented buttons.
- `MatchingProps` uses orientation-aware review item/suggestion unions.
- Song mode remains visually equivalent.
- Playlist mode uses `PlaylistReviewItemSection` and `SongSuggestionsSection`.
- Song suggestion list scrolls inline; controls stay pinned.
- Copy updates for skip CTA, completion recap, empty/unavailable/retryable states.
- Toggle updates `match_view_mode` best-effort after navigation and invalidates preferred summary/dashboard keys.

### Key touchpoints

- Route loader/search normalization.
- Matching top-level props and session composition.
- Playlist preview hook integration.
- Spotify add flow direction in playlist mode.
- Story/test fixtures.

### Risks

- Mode switch must not destroy server progress for the other orientation.
- Focus and disabled-state behavior on toggle must remain accessible.
- Existing song-mode visual rhythm can regress during generic component refactors.
- Prefetch must use side-effect-free reads; current card render must use presentation capture.

### Parallelizable within phase

- Header toggle and route search tests.
- Playlist review item component.
- Song suggestion row component.
- Empty/completion copy updates.
- Story fixtures for both modes.

### Exit criteria

- `/match` is song mode, `/match?mode=playlist` is playlist mode.
- `mode=song` and invalid modes normalize to `/match` with replace.
- Switching modes preserves each orientation’s server queue progress.
- Song mode remains visually equivalent.
- Playlist mode can add suggested songs to the review playlist.

---

## Phase 8 — Read-time hard filters and visibility hash

### Goal

Move safe metadata-only hard filters out of snapshot recomputation and into read-time visibility, while keeping queue append idempotency correct.

### Why this phase exists

Filter-only playlist saves should not enqueue expensive refreshes. But loosening filters can reveal subjects from the same snapshot, so queue snapshot idempotency must include visibility configuration.

### Inputs/dependencies

- Phase 1 `visibility_config_hash` schema.
- Phase 5 visible suggestion-list helper.
- Phase 4 queue append/sync orientation support.
- Existing filter code:
  - `src/lib/workflows/match-snapshot-refresh/match-filter-exclusions.ts`
  - `src/lib/workflows/match-snapshot-refresh/filter-metadata-loader.ts`
  - `src/lib/domains/taste/match-filters/**`
  - playlist-management change plumbing.

### Outputs

- Playlist-management change facts split into `targetMembershipChanged`, `scoringConfigChanged`, `readTimeFilterChanged`.
- Reconciler queues refresh only for membership/scoring changes.
- Filter-only saves call `syncActiveMatchReviewSessions` and invalidate orientation-scoped review/summary/current item queries.
- `QueueVisibilityConfigHashInput` includes orientation, strictness, read-time filter hash.
- Before moving filters, stable `readTimeFiltersHash = "write-time-filters"`.
- After moving filters, read-time hash includes target playlist filters stable-stringified by playlist id.
- Visible suggestion list applies language, vocal gender, release year, and liked-at predicates at read time.
- Intent, genre pills, and playlist membership remain refresh triggers.

### Key touchpoints

- Playlist management server functions/hooks.
- Library-processing change types and reconciler tests.
- Visible suggestion-list metadata loading.
- Queue session snapshot idempotency.
- Query invalidation in playlist save flows.

### Risks

- Captured current cards must not mutate after a filter save.
- Metadata load failure must be retryable and must not resolve queue items incorrectly.
- Loosened filters must be able to append newly visible subjects from an already-applied snapshot.
- Candidate retention may need adjustment if row volume/coverage is insufficient.

### Parallelizable within phase

- Change-fact/reconciler split.
- Filter hash helper.
- Predicate application in visible-list helper.
- UI invalidation wiring.

### Exit criteria

- Filter-only saves do not enqueue match snapshot refresh jobs.
- Active sessions can append newly visible subjects under a new visibility hash.
- Existing captured cards stay stable across filter changes.
- Safe hard filters behave with the documented AND/OR/missing-metadata semantics.

---

## Phase 9 — Documentation, cleanup, and regression hardening

### Goal

Update architecture docs, remove transitional wrappers where safe, and lock the refactor down with tests/stories.

### Why this phase exists

The refactor changes fundamental semantics: `score/rank` become legacy compatibility fields, ranking is orientation-specific, and queue events use captured visible ranks. Future work needs docs and tests that prevent sliding back to the old model.

### Inputs/dependencies

- All implementation phases.
- Existing docs:
  - `docs/architecture/matching/overview.md`
  - `docs/architecture/matching/reranker.md`

### Outputs

- Matching overview updated for pair retention, oriented ranking, fused-score strictness, atomic publish.
- Reranker docs updated to distinguish ranking vs provider rerank.
- Legacy `match_result.score/rank` compatibility documented.
- UI stories for `SongMode` and `PlaylistMode`.
- Unit/server/integration/component tests from the unified plan’s testing section.
- Temporary wrappers removed or marked with clear follow-up if still required.

### Key touchpoints

- Architecture docs.
- `claudedocs/match-system-refactor/**` if the plan needs sync notes.
- Test suites under `src/**/__tests__` and migration/integration tests.
- Story files for matching components.

### Risks

- Docs can accidentally describe the transitional `score`/`rank` fields as authoritative.
- Tests may overfit implementation details instead of public server/UI behavior.
- Old wrappers can conceal code still using song-only assumptions.

### Parallelizable within phase

- Architecture doc updates.
- UI stories.
- Test coverage by area.
- Cleanup of dead imports/modules.

### Exit criteria

- Acceptance criteria in the unified plan are covered by tests or stories where practical.
- Architecture docs match implemented semantics.
- No production read path uses `match_result.rank` as the authoritative orientation-specific rank.
- No strictness/match-percent path uses reranker score.
