# S6-03 · Locked Song Rendering in Liked Songs Page

## Goal

Render `locked` songs with visual distinction and unlock/explore affordance on the liked songs page.

## Why

Phase 3 introduced `locked` as a display state. The UI must now distinguish locked songs from pending/analyzed songs and provide an affordance to unlock them.

## Depends on

- S3-07 (liked songs page returns `locked` state)
- S3-11 (`SongDisplayState` type)
- S6-01 (billing state available in context)

## Blocks

- S6-04 (song selection builds on locked rendering)

## Scope

- Update liked songs page components:
  - Locked songs render with distinct visual treatment (muted, lock icon, or similar)
  - Locked songs show an "explore" or "unlock" affordance
  - Analysis text not shown for locked songs
  - Matching status not shown for locked songs
- Handle the `locked` state alongside existing `pending`, `analyzing`, `analyzed`, `failed`
- Provider-disabled: no locked songs should appear (all entitled)

## Out of scope

- Song selection multi-select (S6-04)
- Paywall (S6-05)
- Full design spec (functional state rendering is sufficient)

## Likely touchpoints

| Area | Files |
|---|---|
| Feature components | `src/features/liked-songs/*` (song list item, song card, or equivalent) |
| Route | `src/routes/_authenticated/liked-songs.tsx` |

## Constraints / decisions to honor

- `SongDisplayState` values are frozen
- Locked songs must never show analysis text
- Matching status is a sub-dimension of `analyzed` only

## Acceptance criteria

- [ ] Locked songs visually distinct from other states
- [ ] No analysis text shown for locked songs
- [ ] No matching status for locked songs
- [ ] Unlock/explore affordance present on locked songs
- [ ] Provider-disabled: no locked songs visible

## Verification

- Manual: account with mix of locked/pending/analyzed → correct rendering
- `bun run test` passes

## Parallelization notes

- Touches liked songs feature components — coordinate with S6-04
- Can run in parallel with S6-01, S6-02

## Suggested PR title

`feat(billing): locked song rendering in liked songs page`
