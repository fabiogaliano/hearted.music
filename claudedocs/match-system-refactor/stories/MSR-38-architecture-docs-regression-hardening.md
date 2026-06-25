# MSR-38 — Architecture docs, stories, and regression hardening

## Goal

Update documentation and regression coverage so future work preserves the new oriented ranking and captured-rank semantics.

## Depends on / blocks

Depends on:

- MSR-11
- MSR-34
- MSR-37

Blocks:

- Release readiness

## Scope and out of scope

In scope:

- Update matching architecture overview for pair retention, oriented ranking, fused-score strictness, atomic publish, queue orientation, and visible capture.
- Update reranker docs to distinguish ranking from provider reranking.
- Document legacy `match_result.score/rank` compatibility semantics.
- Add/refresh UI stories for `SongMode` and `PlaylistMode`.
- Remove temporary wrappers or document follow-up if still required.
- Add final regression tests for acceptance criteria not covered by prior stories.

Out of scope:

- New product features.
- Deleting legacy `match_result.score/rank` columns.
- Changing implemented behavior from the accepted plan.

## Likely touchpoints

- `docs/architecture/matching/overview.md`
- `docs/architecture/matching/reranker.md`
- `src/features/matching/**/*.stories.tsx`
- Relevant tests under `src/**/__tests__/`
- `claudedocs/match-system-refactor/**` sync notes if needed

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` I1, I2, I3, I4, H1-H11.
- Docs must not describe reranker score as strictness/display source.
- No production read path should use `match_result.rank` as authoritative orientation-specific rank.

## Acceptance criteria

- Architecture docs match implemented semantics.
- Stories cover song and playlist modes.
- Regression tests or stories cover unified-plan acceptance criteria where practical.
- Temporary compatibility wrappers are removed or clearly documented with owners/follow-ups.

## Notes on risks or ambiguity

- Docs often lag implementation; verify code paths before documenting final claims.
