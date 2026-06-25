# Match system terminology decisions worksheet

Date: 2026-06-25
Status: Draft worksheet for user selections

## How to use this file

For each decision, check exactly one option or write a custom selection in **Selected / notes**. The marked **recommended** option is the naming pass recommendation based on the current plan and codebase conventions.

After you fill this in, ask for the plan terminology pass. I will then patch `claudedocs/match-system-refactor/match-system-refactor-unified-plan.md` to use the selected canonical names consistently.

## Grounding notes

Files read for this terminology pass:

- `claudedocs/match-system-refactor/match-system-refactor-unified-plan.md`
- `claudedocs/crisp-metadata-hard-filters/crisp-metadata-hard-filters-terminology.md`
- `docs/architecture/matching/overview.md`
- `docs/architecture/matching/reranker.md`
- `src/lib/domains/taste/match-review-queue/types.ts`
- `src/lib/domains/taste/match-review-queue/queries.ts`
- `src/lib/domains/taste/song-matching/types.ts`
- `src/lib/domains/taste/song-matching/queries.ts`
- `src/lib/server/match-review-queue.functions.ts`
- `src/lib/server/matching.functions.ts`
- `src/lib/workflows/enrichment-pipeline/reranking.ts`
- `src/lib/workflows/match-snapshot-refresh/write-match-snapshot.ts`
- `src/lib/platform/jobs/library-processing-queue.ts`
- `src/features/matching/types.ts`
- `src/routes/_authenticated/match.tsx`
- `supabase/migrations/20260617150000_match_event_log.sql`

Observed repo naming patterns:

- DB / SQL / RPC parameters: `snake_case`, RPC args prefixed with `p_`.
- TypeScript / JSON / server function inputs: `camelCase`.
- TypeScript domain types: `PascalCase`, often `MatchReview...` for queue UI contracts.
- Module file names: `kebab-case`.
- DB status values: lowercase `snake_case` for multi-word values (`not_found`, `already_resolved`).
- Public server result reasons used by UI: lowercase `kebab-case` (`not-found`, `already-resolved`).
- Existing product route language uses **Match** / **Matching** / **strictness**.

---

## A. Product language and route vocabulary

### A1 — User-facing review modes

- [x] **A (recommended):** Product labels **Song mode** / **Playlist mode**; toggle labels `Song` / `Playlist`. Keeps copy short and matches current plan.
- [ ] **B:** Product labels **Song review** / **Playlist review**; toggle labels `Songs` / `Playlists`. More explicit, but less aligned with URL `mode`.
- [ ] **C:** Product labels **Match songs** / **Match playlists**; toggle labels `Songs` / `Playlists`. More action-oriented, but risks ambiguity about which side is the review item.

Selected / notes:

### A2 — Internal concept for song-vs-playlist direction

- [x] **A (recommended):** Canonical internal noun **orientation**; TS type `MatchOrientation`; DB column `orientation`; enum values `'song' | 'playlist'`. Distinguishes algorithm/data direction from UI view state.
- [ ] **B:** Canonical noun **mode** everywhere; TS type `MatchMode`; DB column `mode`. Shorter, but overloaded with route/search UI mode.
- [ ] **C:** Canonical noun **view**; TS type `MatchView`; DB column `view`. UI-friendly, but weaker for ranking/session semantics.

Selected / notes:

### A3 — URL/search parameter name

- [x] **A (recommended):** Search param `mode`; canonical URLs `/match` and `/match?mode=playlist`; `mode=song` normalized away. Best user-facing route language.
- [ ] **B:** Search param `orientation`; canonical URLs `/match` and `/match?orientation=playlist`. More precise, but too internal for URLs.
- [ ] **C:** Search param `view`; canonical URLs `/match` and `/match?view=playlist`. Product-friendly, but diverges from plan and existing `mode` type names.

Selected / notes:

### A4 — Product names for left-side item and right-side rows

- [ ] **A (recommended):** **review subject** for the reviewed entity; **candidate** for each suggested row; **slate** for the full ordered candidate set. Precise and matches ranking literature.
- [x] **B:** **review item** for the left-side entity; **suggestion** for each right-side row; **suggestion list** for the full ordered set. Friendlier than review subject/candidate/slate and avoids `source` conflicts.
- [ ] **C:** **query** / **document** / **result set**. Reranker-accurate, but too provider-specific for UI and queue docs.

Selected / notes:

### A5 — User-facing score label

- [ ] **A (recommended):** **match percent** in product copy; `displayScore` / `display_score` internally for captured visible rows; `fused_score` as the authoritative source. Separates user label from storage semantics.
- [ ] **B:** **match score** in product copy and `matchScore` in UI types. Matches existing `Playlist.matchScore`, but can blur display score vs ordering score.
- [ ] **C:** **fit percent** in product copy and `fitScore` internally. Clearer product language, but introduces new vocabulary.
- [x] **D** **match percent** in product copy and `fitScore` internally.

Selected / notes:

### A6 — Strictness naming

- [x] **A (recommended):** Keep **strictness** everywhere: `strictnessPreset`, `strictnessMinScore`, `strictnessScore()`, UI “strictness”. Matches existing preferences and settings.
- [ ] **B:** Rename product copy to **match threshold**, keep DB compatibility fields. More technical and less current-product aligned.
- [ ] **C:** Rename to **filter strength** in UI, keep strictness internally. Friendly, but creates two vocabularies.

Selected / notes:

### A7 — Hidden-count noun

- [x] **A:** Generalize to **hidden review item count**: `hiddenReviewItemCount` / `hiddenCount`; UI noun switches by mode (`song(s)` / `playlist(s)`). Best for orientation-aware queueing.
- [ ] **B:** Keep **hidden song count**: `hiddenSongCount`; add `hiddenPlaylistCount`. Simple, but duplicates shape per orientation.
- [ ] **C:** Use **filtered count**: `filteredCount`. Shorter, but less clear that the hidden things are review items.

Selected / notes:

### A8 — Queue/session progress language

- [ ] **A (recommended):** **active review session**, **pending count**, **caught up**, **reviewed this round**. Preserves existing UI mental model.
- [x] **B:** **active match pass**, **remaining count**, **all caught up**, **matched this round**. Better pass vocabulary, but larger copy churn.
- [ ] **C:** **active queue**, **unresolved count**, **complete**, **session recap**. Internally precise, but less user-facing.

Selected / notes:

---

## B. Core domain terms, enum values, and status values

### B1 — Orientation enum values

- [x] **A (recommended):** Enum values `'song' | 'playlist'`. Short, URL-safe, and already in the plan.
- [ ] **B:** Enum values `'song_subject' | 'playlist_subject'`. More explicit in DB, but noisy everywhere.
- [ ] **C:** Enum values `'song_to_playlist' | 'playlist_to_song'`. Fully explicit, but long and easy to confuse with action direction.

Selected / notes:

### B2 — UI mode type name

- [x] **A (recommended):** `MatchViewMode = 'song' | 'playlist'` for route/UI props, distinct from `MatchOrientation`. Good boundary between UI and domain.
- [ ] **B:** Reuse `MatchOrientation` in UI instead of `MatchViewMode`. Fewer types, but exposes domain naming to UI.
- [ ] **C:** `MatchMode = 'song' | 'playlist'`. Short, but increases collision with search param and domain orientation.

Selected / notes:

### B3 — Queue subject discriminated union

- [ ] **A (recommended):** `ReviewSubject = { orientation: 'song'; songId: string } | { orientation: 'playlist'; playlistId: string }`. Makes illegal subject states unrepresentable while avoiding review-item/product wording in domain code.
- [x] **B:** `MatchReviewSubject = { orientation: 'song'; songId: string } | { orientation: 'playlist'; playlistId: string }`. More domain-specific, but longer.
- [ ] **C:** `{ songId?: string; playlistId?: string }` with an `orientation` field. Minimal DB mapping, but allows invalid states in exported types.

Selected / notes:

### B4 — Suggestion ordering object

- [x] **A (recommended):** `VisibleSuggestionList` with `subject` and `suggestions`. Friendly, uses selected suggestion-list language, and still describes the captured ordered set.
- [ ] **B:** `PresentedSuggestionList` with `subject` and `suggestions`. Emphasizes UI presentation, but capture happens after derivation.
- [ ] **C:** `MatchReviewCardData`. UI-friendly, but too broad for shared derivation/capture logic.

Selected / notes:

### B5 — Rank semantics

- [ ] **A (recommended):** `servedRank` / `served_rank` = rank from `match_result_ranking`; `displayRank` / `display_rank` = dense captured visible rank. Matches existing `match_event.served_rank` and plan.
- [x] **B:** `modelRank` / `visibleRank`. Clearer to humans, but diverges from existing `served_rank` column but we can alter column name.
- [ ] **C:** `rankingRank` / `presentationRank`. Very explicit, but awkward and verbose.

Selected / notes:

### B6 — Ranking score semantics

- [x] **A (recommended):** `orderingScore` / `ordering_score` for the exact sort score; `rerankerScore` / `reranker_score` for raw provider score. Matches the plan and avoids overloading `score`.
- [ ] **B:** `servedScore` / `rerankScore`. Shorter, but `servedScore` can be confused with display percent.
- [ ] **C:** `rankScore` / `providerScore`. Clearer distinction, but less aligned with existing reranker naming.

Selected / notes:

### B7 — Ranking source enum values

- [x] **A (recommended):** `RankingSource = 'rerank' | 'fused_fallback'`. Explicit fallback source and plan-compatible.
- [ ] **B:** `RankingSource = 'reranker' | 'fallback'`. Friendlier, but less precise about fallback basis.
- [ ] **C:** `RankingSource = 'provider' | 'fused'`. Short, but hides that provider means reranker.

Selected / notes:

### B8 — Ranking document mode enum values

- [x] **A (recommended):** `RankingDocumentMode = 'analysis' | 'metadata'`; DB column `document_mode`. Matches existing docs and hash language.
- [ ] **B:** `RerankDocumentMode = 'analysis' | 'metadata'`. More specific to reranker, but ranking table is broader than provider calls.
- [ ] **C:** `DocumentRichness = 'rich' | 'metadata'`. Product-neutral, but less concrete and not current code vocabulary.

Selected / notes:

### B9 — Queue item states

- [ ] **A (recommended):** Keep existing `QueueItemState = 'pending' | 'presented' | 'completed' | 'skipped' | 'unavailable'`. Avoids migration churn.
- [ ] **B:** Rename `presented` to `captured`. More aligned with visible-pair capture, but loses UI event meaning.
- [x] **C:** Split state and resolution more strictly: states `pending | active | resolved`, resolution carries outcome. Cleaner model, but larger refactor.

Selected / notes:

### B10 — Queue item resolutions

- [x] **A (recommended):** Keep `QueueItemResolution = 'added' | 'dismissed' | 'skipped' | 'unavailable'`. Matches existing event language.
- [ ] **B:** Use `matched | rejected | skipped | unavailable`. More product-like, but diverges from `match_decision.decision`.
- [ ] **C:** Use `accepted | dismissed | skipped | unavailable`. Standard review terminology, but “accepted” does not match add-to-playlist action.

Selected / notes:

### B11 — Capture RPC statuses

- [x] **A (recommended):** `captured`, `already_captured`, `empty`, `not_found`, `already_resolved`, `invalid_input`. Follows existing RPC status style.
- [ ] **B:** `created`, `exists`, `empty`, `not_found`, `already_resolved`, `invalid_input`. More CRUD-like, but less domain-specific.
- [ ] **C:** `inserted`, `unchanged`, `empty`, `not_found`, `resolved`, `invalid`. Shorter, but less consistent with existing status values.

Selected / notes:

### B12 — Public server reason spelling

- [x] **A (recommended):** Use `kebab-case` public reasons (`not-found`, `already-resolved`, `not-visible`) and map DB `snake_case` statuses at boundaries. Matches current public server contracts.
- [ ] **B:** Use `snake_case` in public server results too. Reduces mapping, but diverges from current UI-facing reason strings.
- [ ] **C:** Use camelCase reasons (`notFound`, `alreadyResolved`). TS-native, but inconsistent with existing union values.

Selected / notes:

---

## C. Schema, tables, columns, constraints, and indexes

### C1 — Orientation-specific ranking table name

- [x] **A (recommended):** `match_result_ranking`. Reads as ranking rows attached to `match_result`; matches plan.
- [ ] **B:** `match_result_served_rank`. Emphasizes served order, but table stores score/source/document mode too.
- [ ] **C:** `match_slate_ranking`. Strong slate terminology, but less obviously tied to `match_result` FK.

Selected / notes:

### C2 — Ranking table required columns

- [x] **A (recommended):** `snapshot_id`, `song_id`, `playlist_id`, `orientation`, `rank`, `ordering_score`, `reranker_score`, `source`, `document_mode`, `created_at`. Complete and matches TS shape.
- [ ] **B:** Same, but rename `rank` to `served_rank`. More explicit, but table already represents served ranking and existing SQL rank conventions use `rank`.
- [ ] **C:** Same, but rename `ordering_score` to `score`. Shorter, but repeats the current overload problem.

Selected / notes:

### C3 — Ranking table source/document CHECK values

- [x] **A (recommended):** `source IN ('rerank', 'fused_fallback')`, `document_mode IN ('analysis', 'metadata')`. Directly mirrors TS enum names.
- [ ] **B:** `source IN ('reranker', 'fallback')`, `document_mode IN ('analysis', 'metadata')`. Friendlier source values, but less precise.
- [ ] **C:** `source IN ('provider', 'fused')`, `document_mode IN ('analysis', 'metadata')`. Short, but provider-specific meaning is implicit.

Selected / notes:

### C4 — Ranking uniqueness/index names

- [x] **A (recommended):** `idx_match_result_ranking_song_slate_rank_unique` and `idx_match_result_ranking_playlist_slate_rank_unique`. Long but self-documenting.
- [ ] **B:** `idx_match_result_ranking_song_rank_unique` and `idx_match_result_ranking_playlist_rank_unique`. Shorter, but omits slate semantics.
- [ ] **C:** `idx_match_result_ranking_subject_rank_unique`. One naming pattern for both, but actual indexes differ by subject column.

Selected / notes:

### C5 — Session orientation column and active-session index

- [x] **A (recommended):** Add `match_review_session.orientation`; index `idx_match_review_session_one_active_per_orientation`. Clear and plan-compatible.
- [ ] **B:** Add `match_review_session.mode`; index `idx_match_review_session_one_active_per_mode`. Shorter, but internal mode overload.
- [ ] **C:** Add `match_review_session.subject_type`; index `idx_match_review_session_one_active_per_subject_type`. Very explicit, but not reused by ranking.

Selected / notes:

### C6 — Queue item subject columns and constraint

- [x] **A (recommended):** Add `orientation`, nullable `song_id`, nullable `playlist_id`; constraint `match_review_queue_item_exactly_one_subject`. Clear DB shape while exported types use `MatchReviewSubject`.
- [ ] **B:** Replace `song_id` with `subject_id` plus `subject_type`. More compact, but loses FKs to both `song` and `playlist`.
- [ ] **C:** Keep `song_id` NOT NULL and add separate playlist queue table. Strong constraints, but fragments queue logic.

Selected / notes:

### C7 — Queue item visible-pair capture timestamp

- [x] **A (recommended):** `visible_pairs_captured_at`. Precise and matches table name.
- [ ] **B:** `slate_captured_at`. Shorter and slate-oriented, but less obvious that rows live in visible-pair table.
- [ ] **C:** `presented_at` only. Avoids a new timestamp, but cannot distinguish old presentation marking from row capture.

Selected / notes:

### C8 — Queue item uniqueness indexes

- [x] **A (recommended):** `idx_match_review_queue_item_session_song_subject`, `idx_match_review_queue_item_session_playlist_subject`, plus snapshot variants. Explicit and consistent.
- [ ] **B:** `idx_match_review_queue_item_session_subject_song`, `...subject_playlist`. Groups “subject” earlier, but less natural in current index style.
- [ ] **C:** Use one expression/partial index naming pattern `idx_match_review_queue_item_unique_subject`. Shorter, but hides per-orientation implementation.

Selected / notes:

### C9 — Session snapshot visibility hash column

- [x] **A (recommended):** `visibility_config_hash`; TS `visibilityConfigHash`; input type `QueueVisibilityConfigHashInput`. Explicitly tied to queue visibility.
- [ ] **B:** `read_filter_hash`; TS `readFilterHash`. Shorter, but omits strictness/orientation parts of the hash input.
- [ ] **C:** `queue_config_hash`; TS `queueConfigHash`. Broad, but could be confused with write-time queue settings.

Selected / notes:

### C10 — User preference column for last selected match view

- [x] **A (recommended):** `user_preferences.match_view_mode`; helpers `getPreferredMatchViewMode` / `setPreferredMatchViewMode`. Product-friendly and plan-compatible.
- [ ] **B:** `user_preferences.match_orientation`; helpers `getPreferredMatchOrientation` / `setPreferredMatchOrientation`. More domain-consistent, but less user preference-like.
- [ ] **C:** `user_preferences.last_match_mode`; helpers `getLastMatchMode` / `setLastMatchMode`. Clear temporal meaning, but less tied to navigation summaries.

Selected / notes:

### C11 — Captured visible-pair table name

- [x] **A (recommended):** `match_review_item_visible_pair`. Matches existing queue item naming and says exactly what is captured.
- [ ] **B:** `match_review_visible_slate_pair`. More slate-centric, but less directly linked to queue item row.
- [ ] **C:** `match_review_presented_pair`. Shorter, but weaker about visibility/filtering semantics.

Selected / notes:

### C12 — Captured visible-pair table columns

- [ ] **A (recommended):** `queue_item_id`, `session_id`, `account_id`, `snapshot_id`, `orientation`, `song_id`, `playlist_id`, `served_rank`, `display_rank`, `display_score`, `captured_at`. Complete and mirrors event context.
- [ ] **B:** Same but replace `display_score` with `match_score`. UI-friendly, but obscures that this is the score displayed after strictness/read filters.
- [ ] **C:** Same but replace `served_rank` with `ranking_rank`. Avoids “served” ambiguity, but diverges from existing `match_event.served_rank`.
- [x] **D:** `queue_item_id`, `session_id`, `account_id`, `snapshot_id`, `orientation`, `song_id`, `playlist_id`, `model_rank`, `visible_rank`, `fit_score`, `captured_at`. Inferred from A5 (`fitScore`) and B5 (`modelRank` / `visibleRank`).

Selected / notes:

### C13 — Captured visible-pair indexes

- [x] **A (recommended):** `idx_match_review_item_visible_pair_queue_visible_rank` and `idx_match_review_item_visible_pair_account_queue`. Matches selected `visible_rank` terminology and access paths in plan.
- [ ] **B:** `idx_match_review_item_visible_pair_item_rank` and `idx_match_review_item_visible_pair_account_item_rank`. Shorter aliases, but less consistent with `queue_item_id` column.
- [ ] **C:** Only primary key plus one `queue_item_id` index. Simpler, but underspecifies display-rank uniqueness.

Selected / notes:

### C14 — Event/decision orientation columns

- [x] **A (recommended):** `served_orientation` on `match_event` and `match_decision`. Aligns with existing `served_rank` and means “mode actually served”.
- [ ] **B:** `orientation`. Shorter, but less clear for direct/non-queue decisions and future recomputations.
- [ ] **C:** `display_orientation`. UI-specific, but ranking and logging semantics are broader than display.

Selected / notes:

### C15 — Decision/event display-rank columns

- [ ] **A (recommended):** Add `display_rank` to `match_decision`; use existing `match_event.display_rank`; both populated from captured rows. Preserves current event schema.
- [x] **B:** Rename/add `visible_rank`. Clearer and inferred from B5 (`modelRank` / `visibleRank`).
- [ ] **C:** Only store display rank in `match_event`, not `match_decision`. Smaller, but queue decisions lose served display context.

Selected / notes:

### C16 — Job availability column

- [x] **A (recommended):** `job.available_at`; TS `availableAt`. Standard scheduling term and plan-compatible.
- [ ] **B:** `claim_after`; TS `claimAfter`. More operationally precise, but less conventional in job queues.
- [ ] **C:** `defer_until`; TS `deferUntil`. Clear for debounce, but less general for future scheduling.

Selected / notes:

---

## D. SQL RPCs, RPC parameters, and publication payloads

### D1 — Atomic publish payload for ranking rows

- [x] **A (recommended):** Keep `publish_match_snapshot` signature and add nested `rankings` inside each `p_results` item. Backward compatible and plan-compatible.
- [ ] **B:** Add a new `p_rankings JSONB` argument. Cleaner separation, but changes RPC signature and callers.
- [ ] **C:** Create separate `publish_match_result_rankings` RPC after snapshot publish. Simpler payloads, but breaks atomic snapshot publication.

Selected / notes:

### D2 — Publish ranking payload field names

- [x] **A (recommended):** Nested fields `orientation`, `rank`, `ordering_score`, `reranker_score`, `source`, `document_mode`. Mirrors DB columns.
- [ ] **B:** Nested fields `orientation`, `served_rank`, `ordering_score`, `reranker_score`, `source`, `document_mode`. More explicit rank field, but differs from ranking table `rank`.
- [ ] **C:** Nested fields `mode`, `rank`, `score`, `rerank_score`, `source`, `doc_mode`. Shorter, but reintroduces ambiguous `score`.

Selected / notes:

### D3 — Capture RPC name and parameters

- [x] **A (recommended):** `capture_match_review_item_visible_pairs_atomic(p_item_id, p_account_id, p_pairs)`. Consistent with existing atomic RPC naming.
- [ ] **B:** `present_match_review_item_atomic(p_item_id, p_account_id, p_pairs)`. Aligns with server function, but RPC does specifically pair capture.
- [ ] **C:** `capture_visible_slate_atomic(p_item_id, p_account_id, p_pairs)`. Shorter, but less tied to match review item domain.

Selected / notes:

### D4 — Capture RPC input row names

- [ ] **A (recommended):** `song_id`, `playlist_id`, `served_rank`, `display_rank`, `display_score`. Mirrors visible-pair table.
- [ ] **B:** `song_id`, `playlist_id`, `rank`, `display_rank`, `score`. Shorter, but ambiguous at the RPC boundary.
- [ ] **C:** `candidate_song_id`, `candidate_playlist_id`, `served_rank`, `visible_rank`, `match_score`. Direction-aware but awkward because both IDs are always a pair.
- [x] **D:** `song_id`, `playlist_id`, `model_rank`, `visible_rank`, `fit_score`. Mirrors selected visible-pair columns and score/rank vocabulary.

Selected / notes:

### D5 — Add decision RPC name and parameters

- [ ] **A (recommended):** Keep name `add_match_review_item_decision_atomic`; params `p_item_id`, `p_account_id`, `p_candidate_song_id DEFAULT NULL`, `p_candidate_playlist_id DEFAULT NULL`. Minimal rename with orientation-aware targets.
- [ ] **B:** Rename to `add_match_review_item_candidate_atomic`; same params. More accurate for playlist mode, but churns existing RPC name.
- [ ] **C:** Split into `add_song_mode_match_review_item_atomic` and `add_playlist_mode_match_review_item_atomic`. Strong explicitness, but duplicates lock/validation logic.
- [x] **D:** Keep name `add_match_review_item_decision_atomic`; params `p_item_id`, `p_account_id`, `p_suggestion_song_id DEFAULT NULL`, `p_suggestion_playlist_id DEFAULT NULL`. Keeps existing RPC action name while using selected suggestion terminology.

Selected / notes:

### D6 — Public add server input

- [ ] **A (recommended):** `AddFromQueueSchema = { itemId, candidateId }`; result `AddFromQueueResult`; server derives orientation from queue item. Clean UI contract.
- [ ] **B:** `{ itemId, candidateSongId?, candidatePlaylistId? }`. Mirrors RPC, but exposes invalid states to UI.
- [ ] **C:** Separate inputs `{ itemId, playlistId }` and `{ itemId, songId }` by server function. Explicit but duplicates public functions.
- [x] **D:** `AddFromQueueSchema = { itemId, suggestionId }`; result `AddFromQueueResult`; server derives orientation from queue item. Inferred from selected suggestion terminology.

Selected / notes:

### D7 — Dismiss RPC name and parameters

- [x] **A (recommended):** `dismiss_match_review_item_atomic(p_item_id, p_account_id)`. Pair set comes from captured visible rows.
- [ ] **B:** Keep old `p_decisions` JSONB param for transition. Easier incremental migration, but risks two authorities.
- [ ] **C:** `reject_match_review_item_atomic(p_item_id, p_account_id)`. Product-ish, but existing code uses dismiss.

Selected / notes:

### D8 — Finish RPC name and statuses

- [x] **A (recommended):** `finish_match_review_item_atomic`; statuses `completed_added`, `skipped`, `not_found`, `already_resolved`. Existing-compatible.
- [ ] **B:** `complete_match_review_item_atomic`; statuses `completed`, `skipped`, `not_found`, `already_resolved`. Simpler, but loses “completed with add” distinction.
- [ ] **C:** `resolve_match_review_item_atomic`; statuses `added`, `skipped`, `not_found`, `already_resolved`. General, but conflicts with decision value `added`.

Selected / notes:

### D9 — Server function for authoritative card presentation

- [x] **A (recommended):** `presentMatchReviewItem({ itemId })`. Clearly marks the side-effectful read.
- [ ] **B:** `getPresentedMatchReviewItem({ itemId })`. Sounds read-only despite capture side effect.
- [ ] **C:** `captureAndGetMatchReviewItem({ itemId })`. Very explicit, but awkward for callers.

Selected / notes:

### D10 — Side-effect-free prefetch read function

- [x] **A (recommended):** Keep `getMatchReviewItem` as side-effect-free/non-authoritative prefetch read. Minimal churn and plan-compatible.
- [ ] **B:** Rename to `prefetchMatchReviewItem`. More explicit, but broader caller churn.
- [ ] **C:** Delete the prefetch read and only use `presentMatchReviewItem`. Strong authority model, but loses safe warming path.

Selected / notes:

### D11 — Preferred summary function

- [x] **A (recommended):** `getPreferredMatchReviewSummary`. Clear that it uses saved preference, not explicit orientation.
- [ ] **B:** `getDefaultMatchReviewSummary`. Short, but “default” could mean song mode.
- [ ] **C:** `getMatchReviewSummaryForPreference`. Very explicit, but verbose.

Selected / notes:

### D12 — Active queue sync function

- [x] **A (recommended):** Plural `syncActiveMatchReviewSessions` returning `{ results: Array<{ orientation, appendedCount }> }`. Clear behavior change from single orientation to all active sessions.
- [ ] **B:** Keep singular `syncActiveMatchReviewSession`, but make it sync all. Avoids caller churn, but name lies.
- [ ] **C:** `syncAllActiveMatchReviewQueues`. Queue-precise, but diverges from existing session naming.

Selected / notes:

---

## E. TypeScript types, functions, and server contracts

### E1 — Ranking module public type names

- [ ] **A (recommended):** `MatchOrientation`, `RankingSource`, `RankingDocumentMode`, `RankedPair`, `RankedMatchSlates`. Matches plan and groups ranking vocabulary.
- [ ] **B:** `MatchOrientation`, `RankSource`, `RerankDocumentMode`, `ServedRankedPair`, `MatchSlateRankings`. More explicit, but inconsistent prefixing.
- [ ] **C:** `MatchMode`, `RankSource`, `DocumentMode`, `RankedMatch`, `RankedMatches`. Shorter, but less precise.
- [x] **D:** `MatchOrientation`, `RankingSource`, `RankingDocumentMode`, `RankedPair`, `RankedSuggestionLists`. Inferred from selected suggestion-list vocabulary.

Selected / notes:

### E2 — Ranking module function names

- [ ] **A (recommended):** `rankMatchSlates`, `rankSongSlates`, `rankPlaylistSlates`. Slate language matches orientation ranking.
- [ ] **B:** `rankMatches`, `rankSongMatches`, `rankPlaylistMatches`. Simpler, but too close to legacy `rerankMatches` and pair-level matching.
- [ ] **C:** `buildMatchRankings`, `buildSongRankings`, `buildPlaylistRankings`. Emphasizes persisted rows, but less action-specific.
- [x] **D:** `rankMatchSuggestionLists`, `rankSongSuggestionLists`, `rankPlaylistSuggestionLists`. Inferred from selected suggestion-list vocabulary.

Selected / notes:

### E3 — Reranker instruction map name

- [x] **A (recommended):** `RERANK_INSTRUCTION_BY_ORIENTATION`. Clear and plan-compatible.
- [ ] **B:** `MATCH_RERANK_INSTRUCTIONS`. Shorter, but less explicit about keying.
- [ ] **C:** `ORIENTED_RERANK_INSTRUCTIONS`. Good conceptually, but less consistent with existing `DEFAULT_RERANK_INSTRUCTION` naming.

Selected / notes:

### E4 — Reranker service option name

- [x] **A (recommended):** `rerank(query, candidates, options?: { instruction?: string })`. Minimal and matches existing config language.
- [ ] **B:** `options?: { taskInstruction?: string }`. More provider-specific, but longer.
- [ ] **C:** `options?: { overrideInstruction?: string }`. Explicit override semantics, but noisy.

Selected / notes:

### E5 — Document builder names

- [x] **A (recommended):** `buildSongRerankDocument` and `buildPlaylistRerankDocument`. Exact and plan-compatible.
- [ ] **B:** `buildSongRankingDocument` and `buildPlaylistRankingDocument`. Broader than reranker, but these are provider documents.
- [ ] **C:** `formatSongForRerank` and `formatPlaylistForRerank`. Shorter, but less type-return-oriented.

Selected / notes:

### E6 — Pair retention helper and constants

- [x] **A (recommended):** `retainStoredMatchPairs`; constants `MATCH_STORED_PAIRS_PER_SONG`, `MATCH_STORED_PAIRS_PER_PLAYLIST`; params `perSongLimit`, `perPlaylistLimit`. Matches plan and storage semantics.
- [ ] **B:** `selectStoredMatchPairs`; constants `MATCH_RESULTS_PER_SONG`, `MATCH_RESULTS_PER_PLAYLIST`. Shorter, but “results” is overloaded.
- [ ] **C:** `retainBidirectionalMatchPairs`; constants `MATCH_RETAINED_PAIRS_PER_SONG`, `MATCH_RETAINED_PAIRS_PER_PLAYLIST`. More explicit, but verbose.

Selected / notes:

### E7 — Strictness helper name

- [x] **A (recommended):** `strictnessScore(row)`. States intended use, not source.
- [ ] **B:** `displayScore(row)`. Matches UI use, but also used for gating and queue ordering.
- [ ] **C:** `fusedOrLegacyScore(row)`. Mechanically precise, but leaks migration detail everywhere.

Selected / notes:

### E8 — Queue item DTO name

- [x] **A (recommended):** `MatchReviewQueueItemDto` with `subject: MatchReviewSubject`. Clear boundary DTO and aligns with B3.
- [ ] **B:** `MatchReviewQueueItemRead`. Aligns with `MatchReviewItemRead`, but can be confused with card read.
- [ ] **C:** `QueuedReviewSubject`. Concise, but omits queue item metadata like position/source score.

Selected / notes:

### E9 — Summary preview/result names

- [x] **A (recommended):** `MatchReviewSummaryPreview` and `MatchReviewSummaryResult` with `previewItems`. Plan-compatible and orientation-aware.
- [ ] **B:** `MatchReviewPreviewItem` and `MatchReviewSummary`. Stronger noun order, but churns existing result name.
- [ ] **C:** `MatchSummaryPreview` and `MatchSummaryResult`. Shorter, but less aligned with current `MatchReview...` server functions.

Selected / notes:

### E10 — Card read discriminated union fields

- [x] **A (recommended):** `MatchReviewItemRead` statuses `ready | unavailable | retryable-error`; field `mode: MatchViewMode`; `reviewItem` and `suggestions`. Clean UI domain shape.
- [ ] **B:** Statuses `ready | unavailable | error`; keep `song`/`matches` for song mode and optional playlist fields. Less churn, but invalid states possible.
- [ ] **C:** Split `SongMatchReviewItemRead` and `PlaylistMatchReviewItemRead`. Very explicit, but duplicates consumers.

Selected / notes:

### E11 — UI review item/suggestion type names

- [x] **A (recommended):** `MatchingReviewItem`, `MatchingSuggestion`, `PlaylistForMatching`, `SongForMatching`. Matches current `SongForMatching` and selected product language.
- [ ] **B:** `MatchReviewItem`, `MatchSuggestion`, `PlaylistForMatch`, `SongForMatch`. Shorter, but can collide with server `MatchReviewItemRead`.
- [ ] **C:** `ReviewItem`, `ReviewSuggestion`, `ReviewPlaylist`, `ReviewSong`. UI-specific, but less tied to matching feature names.

Selected / notes:

### E12 — Completion/reviewed item names

- [x] **A (recommended):** `ReviewedItem`; `CompletionStats` fields `totalItems`, `itemsMatched`, `totalAdditions`, `dismissedCount`, `skippedCount`. Generalizes from songs and uses selected item terminology.
- [ ] **B:** Keep `ReviewedSong`; add `ReviewedPlaylist`; stats `totalSongs` / `songsMatched` plus playlist variants. Explicit, but duplicates mode-specific structures.
- [ ] **C:** `ReviewedReviewItem`; stats `totalReviewed`, `matchedCount`, `additionCount`, `dismissedCount`, `skippedCount`. Very explicit, but awkward.

Selected / notes:

### E13 — Route search validation names

- [x] **A (recommended):** `MatchSearch`, `validateMatchSearch`, `modeFromSearch`, `hasNonCanonicalMatchMode`. Matches TanStack route terminology and plan.
- [ ] **B:** `MatchRouteSearch`, `parseMatchRouteSearch`, `orientationFromSearch`, `hasNonCanonicalOrientation`. More explicit, but exposes orientation in route layer.
- [ ] **C:** `MatchModeSearch`, `normalizeMatchMode`, `matchModeFromSearch`, `shouldNormalizeMatchMode`. UI-centric, but more verbose.

Selected / notes:

### E14 — Query key names

- [x] **A (recommended):** `reviewsRoot`, `review(accountId, orientation)`, `summariesRoot`, `summary(accountId, orientation)`, `preferredSummary(accountId)`, `item(itemId)`. Plan-compatible and existing style.
- [ ] **B:** `queuesRoot`, `queue(accountId, orientation)`, `summary...`. More accurate for queue data, but churns current `match-review` key language.
- [ ] **C:** Add orientation as an object segment: `['match-review', 'review', accountId, { orientation }]`. Self-documenting, but less common in current key style.

Selected / notes:

### E15 — Preference helper names

- [x] **A (recommended):** `getPreferredMatchViewMode` / `setPreferredMatchViewMode({ accountId, mode })`. Mirrors DB column and route mode.
- [ ] **B:** `getPreferredMatchOrientation` / `setPreferredMatchOrientation({ accountId, orientation })`. Domain precise, but less user preference-like.
- [ ] **C:** `getLastMatchMode` / `setLastMatchMode({ accountId, mode })`. Captures “last selected”, but less tied to preference docs.

Selected / notes:

### E16 — Refresh debounce helper names

- [x] **A (recommended):** `MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE`, `resolveMatchRefreshAvailableAt`, `availableAt`. Plan-compatible and explicit.
- [ ] **B:** `MATCH_SNAPSHOT_REFRESH_DEBOUNCE_MS`, `computeMatchRefreshDelayUntil`, `claimAfter`. More precise, but verbose.
- [ ] **C:** `MATCH_REFRESH_DELAY_BY_CHANGE`, `resolveDeferredClaimAt`, `deferUntil`. Clear scheduling language, but diverges from DB `available_at` recommendation.

Selected / notes:

### E17 — Superseded refresh names

- [x] **A (recommended):** `isMatchRefreshJobSuperseded`, result status `'superseded'`, change kind `'match_snapshot_superseded'`, constructor `MatchSnapshotChanges.superseded`. Matches plan.
- [ ] **B:** Use **stale**: `isMatchRefreshJobStale`, status `'stale'`, change kind `'match_snapshot_stale'`. Shorter, but less clear that a newer job/request replaces it.
- [ ] **C:** Use **cancelled**: `isMatchRefreshJobCancelled`, status `'cancelled'`, change kind `'match_snapshot_cancelled'`. Familiar, but cancellation is cooperative due to supersession.

Selected / notes:

### E18 — Playlist-management change flags

- [x] **A (recommended):** `targetMembershipChanged`, `scoringConfigChanged`, `readTimeFilterChanged`. Clean split by refresh behavior.
- [ ] **B:** `membershipChanged`, `profileConfigChanged`, `filterConfigChanged`. Shorter, but less explicit about target playlists/read-time.
- [ ] **C:** `requiresSnapshotRefresh`, `requiresQueueSync`, plus details. Direct scheduling flags, but hides why the change happened.

Selected / notes:

---

## F. Module and file names

### F1 — Orientation ranking module file

- [x] **A (recommended):** `src/lib/workflows/enrichment-pipeline/match-ranking.ts`. Kebab-case, broader than reranking, plan-compatible.
- [ ] **B:** `src/lib/workflows/enrichment-pipeline/oriented-ranking.ts`. Emphasizes new behavior, but less feature-specific.
- [ ] **C:** Keep/rename within `reranking.ts`. Minimal file churn, but legacy name no longer describes fused fallback + two orientations.

Selected / notes:

### F2 — Visible slate helper module

- [ ] **A (recommended):** `src/lib/domains/taste/match-review-queue/visible-slate.ts`. Co-located with queue domain and uses kebab-case.
- [ ] **B:** `src/lib/server/match-review-visible-slate.ts`. Server-boundary explicit, but separates from queue domain types.
- [ ] **C:** `src/lib/domains/taste/song-matching/visible-slate.ts`. Close to match results, but helper owns queue/session visibility.
- [x] **D:** `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`. Co-located with queue domain and aligned with selected suggestion-list vocabulary.

Selected / notes:

### F3 — Match view preference module

- [x] **A (recommended):** Add helpers to existing account preferences module (`src/lib/domains/library/accounts/preferences-queries.ts`). Matches current strictness preference location.
- [ ] **B:** New `src/lib/domains/taste/match-review-queue/preferences.ts`. Keeps match-specific code together, but splits account preference access.
- [ ] **C:** New `src/lib/server/match-view-preference.functions.ts`. Server-boundary clear, but too high-level for reusable dashboard/sidebar calls.

Selected / notes:

### F4 — UI component names for playlist mode

- [x] **A (recommended):** `PlaylistReviewItemSection` and `SongSuggestionsSection`. Mirrors selected review item/suggestion language while making roles clear.
- [ ] **B:** `PlaylistSection` and `SongSection` reused by props. Fewer components, but risks mode-specific prop branching.
- [ ] **C:** `ReviewItemSection` and `SuggestionsSection` fully generic. Elegant, but larger refactor and less immediate readability.

Selected / notes:

### F5 — Mode-scoped content component

- [x] **A (recommended):** `QueueMatchContent` keyed/remounted by `mode`. Keeps existing route vocabulary.
- [ ] **B:** `MatchReviewContent`. More aligned with server functions, but churns current component names.
- [ ] **C:** `OrientedMatchContent`. Precise, but internal jargon in UI file.

Selected / notes:

### F6 — Test/story naming

- [x] **A (recommended):** Test names include `song mode`, `playlist mode`, `orientation`, and public function names; stories `SongMode` / `PlaylistMode`. Human-readable.
- [ ] **B:** Test names include `song orientation`, `playlist orientation`; stories `SongOrientation` / `PlaylistOrientation`. More internal consistency, less product language.
- [ ] **C:** Test names use `song-subject`, `playlist-subject`; stories `SongSubject` / `PlaylistSubject`. Explicit subject role, but not route/UI vocabulary.

Selected / notes:

---

## G. Config, hash, env flags, and offer IDs

### G1 — Ranking orientations constant

- [x] **A (recommended):** `MATCH_RANKING_ORIENTATIONS: readonly MatchOrientation[] = ['song', 'playlist']`. Plan-compatible and explicit.
- [ ] **B:** `DEFAULT_MATCH_ORIENTATIONS`. Shorter, but could imply UI defaults rather than ranking work.
- [ ] **C:** `ENABLED_MATCH_ORIENTATIONS`. Reads like a feature flag, but currently hardcoded config.

Selected / notes:

### G2 — Ranking schema version constant

- [ ] **A (recommended):** `MATCH_RANKING_SCHEMA_VERSION = 'oriented-slates-v1'`. Conveys semantic reason for hash invalidation.
- [ ] **B:** `MATCH_RANKING_SCHEMA_VERSION = 'orientation-ranking-v1'`. More direct, but less tied to slate concept.
- [ ] **C:** `MATCH_RANKING_SCHEMA_VERSION = 'ranking-v2'`. Short, but less descriptive for future archaeology.
- [x] **D:** `MATCH_RANKING_SCHEMA_VERSION = 'oriented-suggestion-lists-v1'`. Inferred from selected suggestion-list vocabulary.

Selected / notes:

### G3 — Ranking config hash helper and prefix

- [x] **A (recommended):** `hashRankingConfig` with prefix `rk_`; output variable `rankingConfigHash`. Matches plan.
- [ ] **B:** `hashMatchRankingConfig` with prefix `mrank_`. More specific, but longer and inconsistent with short existing hash prefixes.
- [ ] **C:** Fold into `computeMatchSnapshotMetadata` without a named helper. Fewer exports, but less testable and less explicit.

Selected / notes:

### G4 — Stored-pair config constants

- [x] **A (recommended):** `MATCH_STORED_PAIRS_PER_SONG` and `MATCH_STORED_PAIRS_PER_PLAYLIST`. Storage semantics are clear.
- [ ] **B:** `MATCH_RETAINED_PAIRS_PER_SONG` and `MATCH_RETAINED_PAIRS_PER_PLAYLIST`. Emphasizes retention, but differs from plan wording.
- [ ] **C:** `MATCH_TOP_PAIRS_PER_SONG` and `MATCH_TOP_PAIRS_PER_PLAYLIST`. Short, but top-N is only how rows are selected, not what the snapshot stores.

Selected / notes:

### G5 — Feature/env flag policy for playlist mode ranking

- [x] **A (recommended):** No new env flag in initial refactor; compute both orientations via `MATCH_RANKING_ORIENTATIONS`. Simpler and matches plan.
- [ ] **B:** Add config/env `MATCH_PLAYLIST_RANKING_ENABLED`. Allows cost control, but introduces a partial product state.
- [ ] **C:** Add account-level feature flag `playlist_match_mode_enabled`. Enables rollout, but plan says toggle ships now and no flag is specified.

Selected / notes:

### G6 — Env flag naming if a future cost gate is needed

- [x] **A (recommended):** If needed later, use `MATCH_RANKING_ORIENTATIONS=song,playlist` rather than a boolean. Extensible.
- [ ] **B:** `MATCH_PLAYLIST_MODE_ENABLED=true`. Product-oriented, but gates UI and ranking together ambiguously.
- [ ] **C:** `ENABLE_PLAYLIST_RERANKING=true`. Specific to reranker, but ranking also has fused fallback.

Selected / notes:

### G7 — Offer IDs

- [x] **A (recommended):** No new offer IDs introduced by this plan. Match review modes are not billing offers.
- [ ] **B:** Add offer ID `playlist_match_mode` if playlist mode becomes plan-gated later. Future-proof, but speculative.
- [ ] **C:** Add offer ID `advanced_match_review` covering both modes. Broad, but not supported by current product requirements.

Selected / notes:

---

## H. UI copy, CTA labels, and analytics/event language

### H1 — Header title and toggle copy

- [x] **A (recommended):** Header title remains `Matching`; toggle buttons `Song` and `Playlist`; no extra explanatory UI. Matches plan.
- [ ] **B:** Header title `Match review`; toggle buttons `Songs` and `Playlists`. More descriptive, but changes existing visual copy.
- [ ] **C:** Header title switches by mode (`Matching songs` / `Matching playlists`). Explicit, but adds repeated mode text beside toggle.

Selected / notes:

### H2 — Skip CTA copy

- [x] **A (recommended):** `Skip Song` in song mode; `Skip Playlist` in playlist mode. Clear review-item-based copy.
- [ ] **B:** Always `Skip`. Minimal, but less clear in unavailable states.
- [ ] **C:** `Next Song` / `Next Playlist`. Current-ish, but “next” hides skip semantics in event logging.

Selected / notes:

### H3 — Dismiss/reject CTA copy

- [x] **A (recommended):** Keep `Reject Match` / `Reject Matches` based on visible suggestion count. Existing product copy preserved.
- [ ] **B:** `Dismiss Match` / `Dismiss Matches`. Aligns with internal `dismissed`, but changes user-facing language.
- [ ] **C:** `Not a Fit` / `None Fit`. More natural, but bigger copy/design change.

Selected / notes:

### H4 — Finish CTA copy

- [x] **A (recommended):** Keep `Finish matching`. Existing final CTA preserved.
- [ ] **B:** `Finish review`. More aligned with match review session, but less current-product aligned.
- [ ] **C:** `Done`. Short, but less explicit.

Selected / notes:

### H5 — Completion recap title

- [ ] **A (recommended):** Keep `Reviewed this round`; thumbnails show `ReviewedItem` rows by mode. Plan-compatible.
- [x] **B:** `Matched this round`. More outcome-oriented and aligns with A8.
- [ ] **C:** `Session recap`. Clear, but less warm.

Selected / notes:

### H6 — Unavailable card copy

- [x] **A (recommended):** `This song is no longer available to match.` / `This playlist is no longer available to match.` Exact plan copy.
- [ ] **B:** `This song can’t be matched right now.` / `This playlist can’t be matched right now.` Softer, but less specific.
- [ ] **C:** `This match card is no longer available.` Generic, but avoids mode-specific copy.

Selected / notes:

### H7 — Retryable card error copy/status

- [x] **A (recommended):** Status `retryable-error`; message `Couldn’t load this match card. Try again.`; CTA `Try again`. Separates retryable from unavailable.
- [ ] **B:** Status `error`; same message and CTA. Less type churn, but loses behavior distinction.
- [ ] **C:** Status `load-failed`; message `Couldn’t load this card.`; CTA `Retry`. Short, but less current plan-compatible.

Selected / notes:

### H8 — Empty-state reason values

- [x] **A (recommended):** `no-context`, `caught-up`, `none-yet`, `no-matches`, `all-decided`, `filtered`. Matches plan and current kebab-case style.
- [ ] **B:** `missing-context`, `caught-up`, `none-yet`, `no-matches`, `all-decided`, `hidden-by-filters`. More explicit, but longer.
- [ ] **C:** Keep current reasons only and add copy branching outside. Less type churn, but weaker domain model.

Selected / notes:

### H9 — Hidden/filtered empty-state copy nouns

- [x] **A (recommended):** Use review-item nouns: `song(s)` in song mode, `playlist(s)` in playlist mode. Matches plan.
- [ ] **B:** Use generic `item(s)`. Simple, but less user-friendly.
- [ ] **C:** Use mode phrase: `Song-mode matches` / `Playlist-mode matches`. Explicit, but clunky.

Selected / notes:

### H10 — Add action copy in playlist mode rows

- [x] **A (recommended):** Reuse existing `Add` / `Added` row action copy. Minimal UI change.
- [ ] **B:** `Add Song` / `Added`. More explicit in playlist mode, but inconsistent with song-mode rows.
- [ ] **C:** `Add to Playlist` / `Added`. Very clear, but wider row label.

Selected / notes:

### H11 — Analytics event naming for queue actions

- [x] **A (recommended):** Keep existing event names where possible, add `orientation` property to events that can occur in both modes. Minimal analytics churn.
- [ ] **B:** Rename events to generic review item/suggestion names (`match_suggestion_added`, `match_review_item_dismissed`). Cleaner long-term, but migration cost.
- [ ] **C:** Separate events per mode (`song_added_to_playlist`, `playlist_mode_song_added`). Easy analysis, but duplicates taxonomy.

Selected / notes:

---

## I. Legacy compatibility vocabulary

### I1 — `match_result.score` transitional meaning

- [x] **A (recommended):** Canonical doc phrase: `score` is a **legacy compatibility ordering score**; new read paths use `match_result_ranking.ordering_score` and strictness/display use `fused_score`. Precise migration language.
- [ ] **B:** Call `score` **legacy display score**. Simpler, but no longer true after strictness/display move to `fused_score`.
- [ ] **C:** Rename/drop `score` in this refactor. Cleaner end state, but plan explicitly says not to delete it.

Selected / notes:

### I2 — `match_result.rank` transitional meaning

- [x] **A (recommended):** Canonical doc phrase: `rank` is a **legacy compatibility rank**, mirrored from song orientation when available; new read paths use `match_result_ranking.rank`. Matches plan.
- [ ] **B:** Call it **legacy song rank**. More specific, but legacy rows may not always have orientation metadata.
- [ ] **C:** Set it null for all new rows. Avoids misuse, but may break legacy readers.

Selected / notes:

### I3 — Reranker vs ranking vocabulary

- [x] **A (recommended):** Use **ranking** for persisted oriented slate order; **reranker** only for provider/cross-encoder calls. Prevents conflating fallback rows with provider-scored rows.
- [ ] **B:** Use **reranking** for the whole ordering pipeline. Matches current file name, but inaccurate when no provider score exists.
- [ ] **C:** Use **ordering** for everything. Generic and safe, but loses ML/reranker specificity where needed.

Selected / notes:

### I4 — Snapshot hash vocabulary

- [x] **A (recommended):** Use `rankingConfigHash` as one component of `snapshotHash`; do not say `MATCHING_ALGO_VERSION` alone invalidates snapshots. Precise and plan-compatible.
- [ ] **B:** Fold ranking into `configHash`. Simpler public docs, but less traceable.
- [ ] **C:** Bump `MATCHING_ALGO_VERSION` only. Minimal, but plan says insufficient unless included in hashed metadata.

Selected / notes:
