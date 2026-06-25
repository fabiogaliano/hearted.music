# Orchestration deviation log — match-system-refactor

Run start commit: `bc257dda`
Date: 2026-06-25

This log records decisions made during orchestrated execution that were **not** spelled out in the plan, plus any unresolved issues left after the bounded patch loop.

## Format

`- [MSR-XX] decision — one-line rationale`

## Entries

- [MSR-01] `MatchReviewSummaryResult` defined in domain `types.ts` alongside the existing server-local `MatchReviewSummaryResult` in `match-review-queue.functions.ts` — two types with the same name exist in different modules temporarily; the story's compile-safe-adapter clause permits this until a later story migrates callers.
