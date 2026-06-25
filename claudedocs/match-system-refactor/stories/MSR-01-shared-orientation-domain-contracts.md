# MSR-01 — Shared orientation and queue domain contracts

## Goal

Introduce the canonical orientation, view-mode, queue-subject, queue lifecycle, and summary DTO contracts that all later branches consume.

## Depends on / blocks

Depends on:

- Source docs in `claudedocs/match-system-refactor/`

Blocks:

- MSR-02 through MSR-38

## Scope and out of scope

In scope:

- Add `MatchOrientation = 'song' | 'playlist'` in the appropriate domain/server module.
- Add `MatchReviewSubject` as a discriminated union.
- Update exported queue DTO/result types to avoid optional `songId` / `playlistId` subject shapes.
- Introduce queue item state/resolution TS unions: `pending | active | resolved` and `added | dismissed | skipped | unavailable`.
- Add summary preview/result types with orientation.

Out of scope:

- Database migrations.
- Runtime queue behavior changes beyond compile-safe adapters.
- UI toggle or playlist-mode rendering.

## Likely touchpoints

- `src/lib/domains/taste/match-review-queue/types.ts`
- `src/lib/domains/taste/song-matching/types.ts`
- `src/lib/server/match-review-queue.functions.ts` type imports only if needed
- `src/features/matching/types.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A2, A4, A8, B1, B3, B9, B10, E8, E9.
- Use `orientation` for domain/server/schema and `mode` only for route/UI view state.
- Do not expose `{ songId?: string; playlistId?: string }` across exported server/UI boundaries.

## Acceptance criteria

- Project typecheck passes or failures are limited to intentional downstream call-site follow-ups documented in the PR.
- Domain/server exported queue types use `MatchReviewSubject` for review subjects.
- Queue lifecycle types separate state from resolution.
- No barrel exports are added.

## Notes on risks or ambiguity

- This story may require temporary adapters around existing song-only code; keep them narrow and mark removal dependencies.
- Avoid moving behavior before schema exists.
