# MSR-31 — Orientation-aware Matching session composition

## Goal

Refactor the matching session container so song and playlist modes use the same server contracts while preserving independent progress.

## Depends on / blocks

Depends on:

- MSR-24
- MSR-28
- MSR-29
- MSR-30

Blocks:

- MSR-32
- MSR-33
- MSR-34

## Scope and out of scope

In scope:

- Update top-level `MatchingProps` to use `MatchingReviewItem`, `MatchingSuggestion`, `ReviewedItem`, and `CompletionStats` unions.
- Introduce `QueueMatchContent` keyed/remounted by mode.
- Reset visit-local state on mode switch while preserving server queue progress.
- Wire `presentMatchReviewItem` for active card rendering and updated add/dismiss/finish functions.
- Keep song mode using existing `SongSection` and `MatchesSection` with equivalent visuals.
- Add regression tests/stories for mode switch progress preservation.

Out of scope:

- Playlist review item component implementation.
- Song suggestions component implementation.
- Copy polish not required for base wiring.

## Likely touchpoints

- `src/features/matching/Matching.tsx`
- `src/features/matching/sections/MatchingSession.tsx`
- `src/features/matching/types.ts`
- `src/routes/_authenticated/match.tsx`
- `src/features/matching/queries.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` E10, E11, E12, F5.
- No loose optional mode-specific state; use discriminated unions.
- Item query keys remain item-id-only.

## Acceptance criteria

- Switching modes remounts local mode content and reloads orientation-scoped server progress.
- Back/Forward restores URL mode.
- Song mode remains visually equivalent.
- Current card render uses presentation capture result.

## Notes on risks or ambiguity

- This story has high merge risk with UI component stories; land it as the composition seam before detailed playlist-mode components.
