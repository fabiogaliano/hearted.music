# MSR-11 — Superseded refresh reconciler and terminal recovery

## Goal

Teach library-processing reconciliation to recover and continue correctly after a match refresh exits superseded.

## Depends on / blocks

Depends on:

- MSR-10

Blocks:

- MSR-38

## Scope and out of scope

In scope:

- Add `MatchSnapshotChanges.superseded` and the `match_snapshot_superseded` change kind.
- Record job execution measurement outcome `superseded` and mark job completed, not failed.
- Update reconciler to clear matching active job, not advance `settledAt`, and emit a fresh ensure if requested work remains.
- Update terminal recovery to replay `match_snapshot_superseded` for completed superseded jobs.
- Add runner/reconciler tests.

Out of scope:

- Ranking-specific cancellation checkpoints.
- Job debounce logic already handled by MSR-09.

## Likely touchpoints

- `src/lib/workflows/library-processing/reconciler.ts`
- `src/lib/workflows/library-processing/runner.ts`
- `src/lib/workflows/library-processing/types.ts`
- `src/worker/execute.ts`
- Measurement/recovery tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E17.
- Superseded jobs are completed/non-error.
- `settledAt` must not advance for superseded jobs.

## Acceptance criteria

- Superseded jobs do not retry as failures.
- Reconciler emits a fresh ensure when `requestedAt > settledAt` and active job is clear.
- Terminal recovery classifies prior superseded measurements correctly.
- No Sentry/error capture occurs for intended supersession.

## Notes on risks or ambiguity

- The active job id check must not clear a newer active job accidentally.
