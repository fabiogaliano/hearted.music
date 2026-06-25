# MSR-25 — Song-mode captured rendering and liked-song ranking migration

## Goal

Move existing song-mode card reads to captured rows while preserving current UX, and use song-oriented ranking for liked-song suggestions without capture.

## Depends on / blocks

Depends on:

- MSR-24

Blocks:

- MSR-29
- MSR-31

## Scope and out of scope

In scope:

- Update existing song-mode active card server/client query flow to render from `presentMatchReviewItem`.
- Ensure visible match percent uses captured `fitScore`.
- Keep side-effect-free prefetch only for non-authoritative warming.
- Update liked-song suggestion read path to use song orientation ranking directly without presentation capture.
- Add regression tests for song-mode ordering and stable visible ranks after retry.

Out of scope:

- Playlist-mode UI rendering.
- Mutation rewrites beyond necessary compatibility.
- Component visual redesign.

## Likely touchpoints

- `src/lib/server/match-review-queue.functions.ts`
- `src/features/matching/queries.ts`
- `src/routes/_authenticated/match.tsx`
- `src/lib/server/matching.functions.ts` or liked-song suggestion path
- Tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` A5, E10, I1, I2.
- Song mode should remain visually equivalent; this story is server/read behavior, not UI redesign.
- Liked-song suggestions are not queue presentation events and do not use capture.

## Acceptance criteria

- Song-mode cards show suggestions ordered by song-oriented ranking.
- Visible ranks remain stable across retry/refetch.
- Match percent uses `fitScore`/strictness score.
- Prefetch data is not used as authoritative card render data.

## Notes on risks or ambiguity

- This bridge story may expose old UI assumptions about `playlist` suggestions only; keep playlist-mode types compile-safe for later UI stories.
