# MSR-02 — Strictness score helper and initial score-source migration

## Goal

Create the single helper for strictness and match percent so later ranking work cannot accidentally use reranker/order scores for filtering or display.

## Depends on / blocks

Depends on:

- MSR-01

Blocks:

- MSR-12
- MSR-18
- MSR-22
- MSR-36

## Scope and out of scope

In scope:

- Add `strictnessScore(row)` returning `fused_score ?? score`.
- Add unit tests for fused-score preference and legacy fallback.
- Migrate one low-risk existing strictness or display read path to prove usage.
- Document remaining callers that will move in later stories if any remain.

Out of scope:

- Full read-path rewrite.
- Changing persisted `match_result.score` / `rank` semantics.
- UI copy changes.

## Likely touchpoints

- `src/lib/domains/taste/song-matching/queries.ts` or nearby score helper module
- `src/lib/domains/taste/match-review-queue/*` if one existing derivation path is migrated
- Tests under nearby `__tests__/`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A5, A6, E7, I1, I2.
- `fused_score` is authoritative for strictness and match percent; `score` is legacy fallback only.
- Strictness never reads reranker or ordering score.

## Acceptance criteria

- `strictnessScore` is tested.
- At least one existing strictness/display code path imports the helper or a follow-up list is captured in the story PR notes.
- No code introduced in this story uses reranker score for strictness or match percent.

## Notes on risks or ambiguity

- Existing code may still use `score` in many places; do not over-expand this foundation story into the full visible-list migration.
