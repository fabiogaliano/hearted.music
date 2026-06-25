# MSR-10 — Superseded refresh core outcome and checkpoints

## Goal

Let stale running match refresh jobs exit cooperatively as superseded before expensive work or publication.

## Depends on / blocks

Depends on:

- MSR-09

Blocks:

- MSR-11
- MSR-15

## Scope and out of scope

In scope:

- Add `isMatchRefreshJobSuperseded` helper.
- Add `MatchSnapshotRefreshExecuteResult` `superseded` variant.
- Insert checkpoints after profiling, candidate loading, exclusion/filter loading, before embedding load, before `matchBatch`, and before publish.
- Return superseded without throwing or reporting an error.
- Add tests for newer request marker and active-job mismatch.

Out of scope:

- Ranking-loop checkpoint; add in MSR-15 after ranking module exists.
- Reconciler terminal recovery details beyond minimal compile support.

## Likely touchpoints

- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- `src/lib/workflows/library-processing/runner.ts` or execution boundary
- `src/worker/execute.ts`
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E17.
- Use status `superseded`, not stale/cancelled.
- If `satisfies_requested_at` is null, skip cooperative cancellation for that legacy job.

## Acceptance criteria

- A superseded refresh publishes nothing.
- Supersession is treated as a non-error execution outcome.
- Checkpoints exist before the expensive stages listed in scope.
- Legacy jobs with null `satisfies_requested_at` do not guess at staleness.

## Notes on risks or ambiguity

- Ensure exceptions still surface for real failures; supersession must not swallow unrelated errors.
