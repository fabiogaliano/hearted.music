# S3-11 · Feature Type Migration — SongDisplayState

## Goal

Replace `UIAnalysisStatus` with `SongDisplayState` across all feature modules and update matching status to be a sub-dimension of `analyzed` only.

## Why

`UIAnalysisStatus` (`not_analyzed | analyzing | analyzed | failed`) has no `locked` state and conflates pending with locked. `SongDisplayState` (`locked | pending | analyzing | analyzed | failed`) is the canonical replacement. All consuming components must switch.

## Depends on

- S2-01 (SongDisplayState type defined)
- S3-07 (liked songs page returns new states)
- S3-08 (stats use new states)

## Blocks

- Phase 6 (UI components consume SongDisplayState)

## Scope

- Remove `UIAnalysisStatus` from `src/features/liked-songs/types.ts`
- Import `SongDisplayState` from `src/lib/domains/billing/state.ts` in all consumers
- Update `MatchingStatus` usage: matching status is a sub-dimension of `analyzed` songs only; locked songs have no matching status
- Update all TypeScript consumers of `UIAnalysisStatus`:
  - Feature components in `src/features/liked-songs/*`
  - Feature components in `src/features/matching/*`
  - Any utility/helper that references the old type
- Update `src/features/matching/types.ts` if it has matching-status types that need adjustment

## Out of scope

- Visual/design changes for locked states (Phase 6)
- SQL RPC changes (S3-07, S3-08)
- Server function changes (already done in S3-07–S3-10)

## Likely touchpoints

| Area | Files |
|---|---|
| Feature types | `src/features/liked-songs/types.ts`, `src/features/matching/types.ts` |
| Feature components | `src/features/liked-songs/*`, `src/features/matching/*` |

## Constraints / decisions to honor

- `SongDisplayState` values are frozen: `locked | pending | analyzing | analyzed | failed`
- `not_analyzed` no longer exists — it's been split into `locked` and `pending`
- Matching status only applies to `analyzed` songs
- Do not introduce new types; use the canonical `SongDisplayState`

## Acceptance criteria

- [ ] `UIAnalysisStatus` removed from codebase
- [ ] All consumers use `SongDisplayState`
- [ ] Matching status gated behind `analyzed` state
- [ ] No TypeScript errors
- [ ] Existing UI renders without runtime errors (locked songs may use placeholder rendering)

## Verification

- `tsc --noEmit` passes
- `bun run test` passes
- Manual smoke test: liked songs page renders with mix of states

## Parallelization notes

- Touches feature type files — should land after S3-07 and S3-08
- Can run in parallel with S3-05, S3-09, S3-10

## Suggested PR title

`refactor(billing): replace UIAnalysisStatus with SongDisplayState`
