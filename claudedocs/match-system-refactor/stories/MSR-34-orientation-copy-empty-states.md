# MSR-34 — Orientation-aware copy, empty, unavailable, retryable, and completion states

## Goal

Finish mode-specific UI copy and state handling without adding extra product UI.

## Depends on / blocks

Depends on:

- MSR-28
- MSR-31
- MSR-33

Blocks:

- MSR-38

## Scope and out of scope

In scope:

- Make `MatchingEmptyState` orientation-aware with documented reason values.
- Update skip CTA to `Skip Song` / `Skip Playlist`.
- Keep reject CTA singular/plural behavior and final CTA `Finish matching`.
- Use `Matched this round` completion title with `ReviewedItem` thumbnails by mode.
- Render unavailable card copy by review-item noun.
- Render retryable card error with Try again and no resolve side effect.
- Update hidden-count copy nouns by mode.
- Add stories/tests for song and playlist empty/unavailable/retry/completion states.

Out of scope:

- New explanatory UI.
- Changing analytics taxonomy beyond orientation property if existing UI emits events.

## Likely touchpoints

- `src/features/matching/components/MatchingEmptyState.tsx`
- `src/features/matching/sections/MatchingSession.tsx`
- `src/features/matching/Matching.tsx`
- Stories/tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` H2, H3, H4, H5, H6, H7, H8, H9, H11.
- Copy uses review-item nouns for skipped/unavailable/filtered states.
- Retryable errors do not call finish/skip.

## Acceptance criteria

- All planned empty-state reasons render.
- Filtered copy says songs in song mode and playlists in playlist mode.
- Unavailable skip resolves the item through the normal skip/finish path.
- Retry button refetches the item query without resolving.

## Notes on risks or ambiguity

- Keep song-mode existing layout; copy changes should be surgical.
