# MSR-04 — Ranking and visible-suggestion-list contract skeletons

## Goal

Create compile-stable contracts for oriented ranking and presentation capture without implementing the heavy pipeline yet.

## Depends on / blocks

Depends on:

- MSR-01
- MSR-02

Blocks:

- MSR-13
- MSR-14
- MSR-15
- MSR-22
- MSR-24

## Scope and out of scope

In scope:

- Create `src/lib/workflows/enrichment-pipeline/match-ranking.ts` with exported ranking types and instruction constants.
- Create `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts` with exported visible-list types only, or a not-yet-wired pure placeholder if needed for type imports.
- Add no-op or explicitly unimplemented internal functions only where required for compilation; do not wire production paths to placeholders.
- Add lightweight contract tests where valuable.

Out of scope:

- Actual reranking calls.
- DB publication.
- Capture RPC implementation.
- Read-path migration.

## Likely touchpoints

- `src/lib/workflows/enrichment-pipeline/match-ranking.ts`
- `src/lib/domains/taste/match-review-queue/visible-suggestion-list.ts`
- `src/lib/integrations/reranker/service.ts` type imports only if needed

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` B4, B6, B7, B8, E1, E2, E3, E5, F1, F2, G1, G2.
- Use `RankedSuggestionLists`, `RankedPair`, `RankingSource`, and `RankingDocumentMode` names.
- Use suggestion-list terminology, not slate, in new public names.

## Acceptance criteria

- Ranking contract module exports the selected types/constants from the concrete file.
- Visible suggestion list type includes orientation, subject, pair IDs, `fitScore`, `modelRank`, and `visibleRank`.
- No production caller depends on fake ranking or fake capture behavior.

## Notes on risks or ambiguity

- This is a shared-contract gate; avoid large behavior changes so downstream branches can rebase cleanly.
