# MSR-13 — Reranker instruction override and document builders

## Goal

Prepare the reranker service and document builders for orientation-specific calls without mutating shared reranker state.

## Depends on / blocks

Depends on:

- MSR-04

Blocks:

- MSR-14
- MSR-15
- MSR-16

## Scope and out of scope

In scope:

- Update `RerankerService.rerank` to accept `options?: { instruction?: string }`.
- Propagate instruction override through provider call construction and config hashing inputs as needed.
- Add `buildSongRerankDocument` and `buildPlaylistRerankDocument` helpers.
- Preserve existing song document format and playlist intent text format.
- Add service/provider and document-builder tests.

Out of scope:

- Full oriented ranking loops.
- Snapshot publication.
- Changing default reranker instruction globally.

## Likely touchpoints

- `src/lib/integrations/reranker/service.ts`
- `src/lib/workflows/enrichment-pipeline/match-ranking.ts`
- `src/lib/workflows/enrichment-pipeline/reranking.ts` during transition
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E3, E4, E5, I3.
- Instruction override is per call and must not mutate shared service config.
- Use `RERANK_INSTRUCTION_BY_ORIENTATION`.

## Acceptance criteria

- Existing reranker callers still work without options.
- Song and playlist document builders return document mode correctly.
- Instruction override participates in the ranking/reranker config hashing path or is ready for MSR-16 to include.

## Notes on risks or ambiguity

- Provider metadata for raw rerank scores may vary; keep parsing typed and defensive.
