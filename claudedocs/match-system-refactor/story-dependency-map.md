# Match system refactor — story dependency map

Date: 2026-06-25
Status: Implementation dependency and parallelization map

## Sources read

- `match-system-refactor-unified-plan.md`
- `match-system-terminology-decisions.md`
- `match-system-refactor-implementation-phases.md`
- `stories/README.md`
- `stories/MSR-01-shared-orientation-domain-contracts.md` through `stories/MSR-38-architecture-docs-regression-hardening.md`

## Legend

- **Hard edge:** explicit semantic dependency from the plan/phases.
- **Merge-risk edge:** not a semantic dependency, but hot-file overlap suggests serializing or stacking PRs.

## 1. Hard dependency DAG

```text
Foundation gate:
MSR-01 -> MSR-02, MSR-03, MSR-04
MSR-01/02/03/04 block all downstream implementation lanes.

Schema:
MSR-04 -> MSR-05 -> MSR-06 -> MSR-07
MSR-05 -> MSR-08

Refresh cost:
MSR-08 -> MSR-09 -> MSR-10 -> MSR-11

Ranking:
MSR-02 + MSR-04 -> MSR-12
MSR-04 -> MSR-13
MSR-05 + MSR-12 + MSR-13 -> MSR-14 -> MSR-15 -> MSR-16 -> MSR-17
MSR-05 + MSR-15 + MSR-16 -> MSR-17

Queue and summaries:
MSR-06 + MSR-17 -> MSR-18 -> MSR-19 -> MSR-20 -> MSR-21
MSR-03 also feeds MSR-20.
MSR-08 also feeds MSR-21.

Visible capture and actions:
MSR-17 + MSR-19 -> MSR-22
MSR-07 + MSR-22 -> MSR-23
MSR-20 + MSR-22 + MSR-23 -> MSR-24 -> MSR-25
MSR-23 + MSR-24 -> MSR-26 -> MSR-27 -> MSR-28

Route/UI launch:
MSR-03 + MSR-20 + MSR-21 + MSR-25 -> MSR-29 -> MSR-30
MSR-24 + MSR-28 + MSR-29 + MSR-30 -> MSR-31 -> MSR-32 -> MSR-33 -> MSR-34
MSR-26 also feeds MSR-33.

Read-time filters:
MSR-09 + MSR-20 -> MSR-35
MSR-19 + MSR-22 + MSR-35 -> MSR-36 -> MSR-37

Final:
MSR-11 + MSR-34 + MSR-37 -> MSR-38
```

## 2. Critical serial paths

### User-facing playlist mode launch

```text
MSR-01 -> MSR-04 -> MSR-05 -> MSR-06 -> MSR-18 -> MSR-19 -> MSR-20
  -> MSR-22 -> MSR-23 -> MSR-24 -> MSR-25 -> MSR-29 -> MSR-30
  -> MSR-31 -> MSR-32 -> MSR-33 -> MSR-34
```

Important joins:

- MSR-24 also requires ranking publication through MSR-17.
- MSR-31 also requires captured-row mutations through MSR-28.
- MSR-29 also requires preferred summaries through MSR-21.

### Correct rank publication and logging

```text
MSR-01 -> MSR-04 -> MSR-05 -> MSR-12 -> MSR-13 -> MSR-14 -> MSR-15
  -> MSR-16 -> MSR-17 -> MSR-22 -> MSR-23 -> MSR-24 -> MSR-26 -> MSR-27 -> MSR-28
```

### Refresh cost reduction

```text
MSR-08 -> MSR-09 -> MSR-10 -> MSR-11
```

This can land before or alongside ranking once schema exists.

### Read-time hard filters

```text
MSR-09 + MSR-20 -> MSR-35
MSR-19 + MSR-22 + MSR-35 -> MSR-36 -> MSR-37
```

## 3. Shared-contract stories that must land first

1. **MSR-01 — Shared orientation and queue domain contracts**
   - Owns `MatchOrientation`, `MatchReviewSubject`, queue lifecycle, and summary DTO vocabulary.
2. **MSR-02 — Strictness score helper**
   - Establishes `strictnessScore(row)` as the only strictness/match-percent source.
3. **MSR-03 — Route search and query-key contracts**
   - Stabilizes canonical URL behavior and query-key shape before UI/server branches split.
4. **MSR-04 — Ranking and visible-list contract skeletons**
   - Stabilizes ranking and presentation-capture type names before ranking/read branches split.

## 4. Parallelizable groups after the foundation/schema gates

```text
Refresh lane:      MSR-09 -> MSR-10 -> MSR-11
Ranking lane:      MSR-12 -> MSR-13 -> MSR-14 -> MSR-15 -> MSR-16 -> MSR-17
Preference lane:   MSR-21 after MSR-20, low coupling with ranking internals
UI component lane: MSR-32 and MSR-33 after MSR-31, but watch matching hot files
Read-time filters: MSR-35 can start after MSR-09 + MSR-20; predicates wait for MSR-22
```

Safe parallel combinations:

- MSR-09/MSR-10/MSR-11 can run mostly independently of queue/UI after MSR-08, except MSR-15 adds the ranking-loop checkpoint.
- MSR-12 and MSR-13 can run in parallel after MSR-04 if they avoid overlapping `match-ranking.ts` exports.
- MSR-21 can run alongside visible capture once MSR-20 is stable.
- MSR-32 and MSR-33 can be separate PRs only after MSR-31 defines stable props and fixtures.

## 5. Merge-risk ordering from hot files

| Hot zone | Stories | Recommendation |
|---|---|---|
| `src/lib/data/database.types.ts` | MSR-05, MSR-06, MSR-07, MSR-08, RPC story type regenerations | Serialize schema PRs or rebase immediately after each migration lands. |
| `publish_match_snapshot` RPC and write path | MSR-05, MSR-16, MSR-17 | Keep MSR-05 compatibility shell small; land MSR-17 as the full behavior. |
| `src/lib/workflows/enrichment-pipeline/match-ranking.ts` | MSR-04, MSR-13, MSR-14, MSR-15 | Stack ranking PRs or assign one owner; exports are shared contracts. |
| `src/lib/server/match-review-queue.functions.ts` | MSR-18, MSR-20, MSR-24, MSR-26, MSR-27, MSR-28 | Treat server queue work as a stack; many public contracts meet here. |
| `src/lib/domains/taste/match-review-queue/queries.ts` | MSR-18, MSR-19, MSR-22, MSR-26, MSR-27, MSR-28 | Keep repository mapper changes ahead of mutation changes. |
| `src/routes/_authenticated/match.tsx` | MSR-03, MSR-25, MSR-29, MSR-31 | Route search/bootstrap changes should land before UI composition. |
| Matching UI components | MSR-30, MSR-31, MSR-32, MSR-33, MSR-34 | Stack UI PRs to protect song-mode visual equivalence. |
| Library processing reconciler/runner | MSR-09, MSR-10, MSR-11, MSR-35 | Refresh debounce/superseded stories should land before filter-only behavior. |
| Visible suggestion-list helper | MSR-04, MSR-22, MSR-36, MSR-37 | Do not fork filter/visibility logic outside the helper. |

## 6. Stories that should not run in parallel

| Stories | Reason |
|---|---|
| MSR-01 with downstream stories defining orientation/subject/lifecycle types | MSR-01 is the source of truth for shared names and illegal-state prevention. |
| MSR-05 through MSR-08 | Generated DB types and migration ordering are conflict-prone. |
| MSR-14, MSR-15, MSR-16, MSR-17 | Ranking API, hash metadata, and publication payloads are tightly coupled. |
| MSR-18, MSR-19, MSR-20 | Queue session APIs, append idempotency, and server function signatures depend on each other. |
| MSR-22, MSR-23, MSR-24 | Derivation, capture RPC, and authoritative presentation read must agree exactly. |
| MSR-26, MSR-27, MSR-28 | Queue mutation RPCs share action semantics and event/decision logging columns. |
| MSR-29 through MSR-34 | Route mode, toggle, session composition, and mode-specific UI touch the same feature files. |
| MSR-35, MSR-36, MSR-37 | Filter change facts, visibility hash, predicates, and metadata failure handling form one behavioral stack. |

## 7. Recommended waves

1. **Wave 1 — Contracts:** MSR-01, MSR-02, MSR-03, MSR-04.
2. **Wave 2 — Schema:** MSR-05, MSR-06, MSR-07, MSR-08.
3. **Wave 3 — Independent foundations:** refresh lane MSR-09/MSR-10/MSR-11 and ranking lane MSR-12/MSR-13/MSR-14/MSR-15/MSR-16/MSR-17.
4. **Wave 4 — Queue and capture authority:** MSR-18 through MSR-28.
5. **Wave 5 — Route/UI launch:** MSR-29 through MSR-34.
6. **Wave 6 — Read-time filters:** MSR-35 through MSR-37.
7. **Wave 7 — Docs/regression:** MSR-38.
