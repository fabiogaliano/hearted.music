# Match system refactor — implementation story index

Source docs:

- `match-system-refactor-unified-plan.md`
- `match-system-terminology-decisions.md`
- `match-system-refactor-implementation-phases.md`

Granularity: small PRs per change set. Each story is intended to be independently reviewable and executable by an AI coding agent with explicit dependencies.

Output shape: one file per story in this directory, plus `../story-dependency-map.md` for dependency and merge-risk guidance.

## Critical path summary

```text
Shared contracts
  -> Schema and generated DB types
  -> Refresh coalescing foundation
  -> Oriented ranking publication
  -> Orientation-aware queue/summaries/preferences
  -> Visible suggestion-list capture
  -> Captured-row mutations
  -> Route/UI mode launch
  -> Read-time filters
  -> Docs/regression hardening
```

## Story dependency graph

```text
MSR-01 Shared orientation and queue domain contracts
├─ MSR-02 Strictness score helper
├─ MSR-03 Route search and query-key contracts
└─ MSR-04 Ranking and visible-list contract skeletons

Schema lane:
MSR-04 -> MSR-05 Ranking schema and publish shell
MSR-01 + MSR-05 -> MSR-06 Queue/session orientation schema
MSR-06 -> MSR-07 Visible-pair/event/decision schema
MSR-05 -> MSR-08 Preference/job availability schema

Refresh-cost lane:
MSR-08 -> MSR-09 Refresh debounce
MSR-09 -> MSR-10 Superseded refresh core
MSR-10 -> MSR-11 Superseded reconciler/recovery

Ranking lane:
MSR-02 + MSR-04 -> MSR-12 Stored pair retention
MSR-04 -> MSR-13 Reranker instruction/doc builders
MSR-05 + MSR-12 + MSR-13 -> MSR-14 Song-oriented ranking
MSR-14 -> MSR-15 Playlist + combined ranking
MSR-13 + MSR-15 -> MSR-16 Ranking config hash
MSR-05 + MSR-15 + MSR-16 -> MSR-17 Atomic ranking publication

Queue/preference lane:
MSR-06 + MSR-17 -> MSR-18 Orientation sessions/subjects
MSR-18 + MSR-02 -> MSR-19 Ordered subjects/visibility hash
MSR-03 + MSR-19 -> MSR-20 Orientation server functions/query keys
MSR-08 + MSR-20 -> MSR-21 Preferred summary/dashboard/sidebar

Visible capture + mutation lane:
MSR-04 + MSR-17 + MSR-19 -> MSR-22 Visible suggestion-list helper
MSR-07 + MSR-22 -> MSR-23 Capture RPC
MSR-20 + MSR-22 + MSR-23 -> MSR-24 presentMatchReviewItem
MSR-24 -> MSR-25 Song-mode captured rendering
MSR-23 + MSR-24 -> MSR-26 Add mutation
MSR-24 + MSR-26 -> MSR-27 Dismiss mutation
MSR-24 + MSR-26 + MSR-27 -> MSR-28 Finish/skip mutation

Route/UI lane:
MSR-03 + MSR-20 + MSR-21 + MSR-25 -> MSR-29 Route mode bootstrap
MSR-29 -> MSR-30 Header toggle
MSR-24 + MSR-28 + MSR-29 + MSR-30 -> MSR-31 Session composition
MSR-31 -> MSR-32 Playlist review item section
MSR-26 + MSR-31 + MSR-32 -> MSR-33 Song suggestions section
MSR-28 + MSR-31 + MSR-33 -> MSR-34 Copy and states

Read-time filter lane:
MSR-09 + MSR-20 -> MSR-35 Change facts/filter-only sync
MSR-19 + MSR-22 + MSR-35 -> MSR-36 Read-time filter hash/predicates
MSR-36 -> MSR-37 Filter metadata retryable append

Plan-gap closure (orchestrator-added):
MSR-34 [PLAN-GAP] -> MSR-39 Functional playlist ready-path

Final hardening:
MSR-11 + MSR-34 + MSR-37 + MSR-39 -> MSR-38 Docs/regression hardening
```

## Stories

| ID | Title | Phase | Depends on | Blocks |
|---|---|---|---|---|
| [MSR-01](./MSR-01-shared-orientation-domain-contracts.md) | Shared orientation and queue domain contracts | Phase 0 | Source docs | MSR-02 through MSR-38 |
| [MSR-02](./MSR-02-strictness-score-helper.md) | Strictness score helper and initial score-source migration | Phase 0 | MSR-01 | MSR-12, MSR-18, MSR-22, MSR-36 |
| [MSR-03](./MSR-03-route-search-query-key-contracts.md) | Route search and query-key contracts | Phase 0 | MSR-01 | MSR-20, MSR-29, MSR-30, MSR-31 |
| [MSR-04](./MSR-04-ranking-visible-list-contract-skeletons.md) | Ranking and visible-suggestion-list contract skeletons | Phase 0 | MSR-01, MSR-02 | MSR-13, MSR-14, MSR-15, MSR-22, MSR-24 |
| [MSR-05](./MSR-05-ranking-schema-and-publish-shell.md) | Ranking schema and publish RPC compatibility shell | Phase 1 | MSR-04 | MSR-14, MSR-15, MSR-17, MSR-22 |
| [MSR-06](./MSR-06-queue-session-orientation-schema.md) | Queue/session orientation schema and lifecycle migration | Phase 1 | MSR-01, MSR-05 | MSR-18, MSR-19, MSR-20, MSR-22 |
| [MSR-07](./MSR-07-visible-pair-event-decision-schema.md) | Visible-pair capture and event/decision context schema | Phase 1 | MSR-06 | MSR-23, MSR-24, MSR-26, MSR-27, MSR-28 |
| [MSR-08](./MSR-08-preferences-job-availability-schema.md) | Match preference and job availability schema | Phase 1 | MSR-05 | MSR-09, MSR-21, MSR-29 |
| [MSR-09](./MSR-09-refresh-debounce-available-at.md) | Refresh debounce and pending-job available_at handling | Phase 2 | MSR-08 | MSR-10, MSR-35 |
| [MSR-10](./MSR-10-superseded-refresh-core.md) | Superseded refresh core outcome and checkpoints | Phase 2 | MSR-09 | MSR-11, MSR-15 |
| [MSR-11](./MSR-11-superseded-refresh-reconciler.md) | Superseded refresh reconciler and terminal recovery | Phase 2 | MSR-10 | MSR-38 |
| [MSR-12](./MSR-12-stored-pair-retention-helper.md) | Stored pair retention helper | Phase 3 | MSR-02, MSR-04 | MSR-14, MSR-15, MSR-17, MSR-36 |
| [MSR-13](./MSR-13-reranker-instruction-doc-builders.md) | Reranker instruction override and document builders | Phase 3 | MSR-04 | MSR-14, MSR-15, MSR-16 |
| [MSR-14](./MSR-14-song-oriented-ranking.md) | Song-oriented suggestion-list ranking | Phase 3 | MSR-05, MSR-12, MSR-13 | MSR-15, MSR-17, MSR-22 |
| [MSR-15](./MSR-15-playlist-ranking-and-combined-ranking.md) | Playlist-oriented and combined suggestion-list ranking | Phase 3 | MSR-14 | MSR-16, MSR-17, MSR-22, MSR-24 |
| [MSR-16](./MSR-16-ranking-config-hash.md) | Ranking config hash and snapshot invalidation | Phase 3 | MSR-13, MSR-15 | MSR-17 |
| [MSR-17](./MSR-17-atomic-ranking-publication.md) | Atomic ranking publication and legacy compatibility fields | Phase 3 | MSR-05, MSR-15, MSR-16 | MSR-18, MSR-22 |
| [MSR-18](./MSR-18-orientation-active-sessions-queue-subjects.md) | Orientation-aware active sessions and queue subjects | Phase 4 | MSR-06, MSR-17 | MSR-19, MSR-20, MSR-22 |
| [MSR-19](./MSR-19-ordered-subjects-visibility-hash.md) | Ordered undecided subjects and visibility hash idempotency | Phase 4 | MSR-18, MSR-02 | MSR-20, MSR-22, MSR-36 |
| [MSR-20](./MSR-20-orientation-server-functions-query-keys.md) | Orientation-scoped server functions, sync, and query invalidation | Phase 4 | MSR-03, MSR-19 | MSR-21, MSR-24, MSR-29, MSR-31 |
| [MSR-21](./MSR-21-preferred-summary-dashboard-sidebar.md) | Preferred match view mode, dashboard, and sidebar summaries | Phase 4 | MSR-08, MSR-20 | MSR-29, MSR-30 |
| [MSR-22](./MSR-22-visible-suggestion-list-helper.md) | Visible suggestion-list derivation helper | Phase 5 | MSR-04, MSR-17, MSR-19 | MSR-23, MSR-24, MSR-25, MSR-27, MSR-28, MSR-36 |
| [MSR-23](./MSR-23-capture-visible-pairs-rpc.md) | Capture visible pairs RPC implementation | Phase 5 | MSR-07, MSR-22 | MSR-24, MSR-26, MSR-27, MSR-28 |
| [MSR-24](./MSR-24-present-match-review-item.md) | Authoritative presentMatchReviewItem server read | Phase 5 | MSR-20, MSR-22, MSR-23 | MSR-25, MSR-26, MSR-27, MSR-28, MSR-31 |
| [MSR-25](./MSR-25-song-mode-captured-render-and-liked-ranking.md) | Song-mode captured rendering and liked-song ranking migration | Phase 5 | MSR-24 | MSR-29, MSR-31 |
| [MSR-26](./MSR-26-add-mutation-captured-visible.md) | Add mutation from captured visible pairs | Phase 6 | MSR-23, MSR-24 | MSR-27, MSR-28, MSR-33 |
| [MSR-27](./MSR-27-dismiss-mutation-captured-visible.md) | Dismiss mutation from captured visible pairs | Phase 6 | MSR-24, MSR-26 | MSR-28, MSR-31 |
| [MSR-28](./MSR-28-finish-skip-captured-visible.md) | Finish and skip from captured visible pairs | Phase 6 | MSR-24, MSR-26, MSR-27 | MSR-31, MSR-34 |
| [MSR-29](./MSR-29-match-route-mode-bootstrap.md) | /match route mode normalization and bootstrap | Phase 7 | MSR-03, MSR-20, MSR-21, MSR-25 | MSR-30, MSR-31 |
| [MSR-30](./MSR-30-matching-header-toggle.md) | Accessible Matching header Song/Playlist toggle | Phase 7 | MSR-29 | MSR-31, MSR-34 |
| [MSR-31](./MSR-31-orientation-aware-session-composition.md) | Orientation-aware Matching session composition | Phase 7 | MSR-24, MSR-28, MSR-29, MSR-30 | MSR-32, MSR-33, MSR-34 |
| [MSR-32](./MSR-32-playlist-review-item-section.md) | Playlist review item section with hover preview | Phase 7 | MSR-31 | MSR-33, MSR-34 |
| [MSR-33](./MSR-33-song-suggestions-section.md) | Song suggestions section and playlist-mode add flow | Phase 7 | MSR-26, MSR-31, MSR-32 | MSR-34 |
| [MSR-34](./MSR-34-orientation-copy-empty-states.md) | Orientation-aware copy, empty, unavailable, retryable, and completion states | Phase 7 | MSR-28, MSR-31, MSR-33 | MSR-38 |
| [MSR-35](./MSR-35-playlist-management-filter-change-facts.md) | Playlist-management change facts and filter-only sync invalidation | Phase 8 | MSR-09, MSR-20 | MSR-36, MSR-37 |
| [MSR-36](./MSR-36-read-time-filter-hash-predicates.md) | Read-time filter hash and visible-list predicates | Phase 8 | MSR-19, MSR-22, MSR-35 | MSR-37 |
| [MSR-37](./MSR-37-filter-metadata-retryable-append.md) | Filter metadata retryable errors and newly visible subject append | Phase 8 | MSR-36 | MSR-38 |
| [MSR-39](./MSR-39-functional-playlist-ready-path.md) (orchestrator-added) | Functional playlist ready-path — playlist arm in `presentMatchReviewItem`, discriminated `MatchReviewItemRead.ready`, playlist handlers in `QueueCardContent` | Phase 7.5 | MSR-34 [PLAN-GAP] | MSR-38 |
| [MSR-38](./MSR-38-architecture-docs-regression-hardening.md) | Architecture docs, stories, and regression hardening | Phase 9 | MSR-11, MSR-34, MSR-37, MSR-39 | Release readiness |

## Shared-contract gate

Do not begin downstream queue, ranking, route/UI, mutation, or read-time filter implementation until MSR-01 through MSR-04 have landed or the branches are stacked directly on them. Do not begin server code that relies on new tables/columns until the relevant schema story and generated DB types have landed.

## Recommended implementation waves

1. **Foundation:** MSR-01 through MSR-04.
2. **Schema:** MSR-05 through MSR-08, preferably short serial PRs because `database.types.ts` is generated and conflict-prone.
3. **Parallel lanes after schema:** refresh MSR-09 through MSR-11; ranking MSR-12 through MSR-17; preference/queue MSR-18 through MSR-21 after ranking publication; UI components can prototype behind typed fixtures after MSR-31 seams exist.
4. **Authority and actions:** MSR-22 through MSR-28.
5. **Launch UI:** MSR-29 through MSR-34, plus orchestrator-added MSR-39 (functional playlist ready-path, plan-gap closure).
6. **Read-time filters:** MSR-35 through MSR-37.
7. **Final hardening:** MSR-38.

## Completion checks

- Use `bun run test` for relevant Vitest coverage.
- Regenerate `src/lib/data/database.types.ts` in schema/RPC stories.
- Do not add barrel exports.
- Do not introduce `any`, non-null assertions, or unsafe type assertions.
- Keep strictness/match percent on `strictnessScore(row)` and never on reranker/order scores.
