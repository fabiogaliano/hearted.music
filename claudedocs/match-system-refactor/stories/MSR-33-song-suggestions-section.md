# MSR-33 — Song suggestions section and playlist-mode add flow

## Goal

Add compact song suggestion rows for playlist mode and wire Add to add the suggestion song to the review playlist.

## Depends on / blocks

Depends on:

- MSR-26
- MSR-31
- MSR-32

Blocks:

- MSR-34

## Scope and out of scope

In scope:

- Create `SongSuggestionsSection`.
- Render match percent, album art with Spotify play overlay, song name/artist, and Add/Added action.
- Make only the suggestion list scroll inline with controls pinned outside.
- Wire playlist-mode add calls using `suggestionId` from song suggestions.
- Keep rows visible and Added after add; do not re-dense ranks.
- Add stories/tests for long lists, added state, disabled state, and keyboard order.

Out of scope:

- Changing song-mode match rows.
- New copy beyond Add/Added.
- Server mutation internals already handled in MSR-26.

## Likely touchpoints

- `src/features/matching/components/SongSuggestionsSection.tsx`
- `src/features/matching/components/SongSection.tsx` for play affordance reuse
- `src/features/matching/sections/MatchingSession.tsx`
- Stories/tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` H10, F4.
- Reuse existing row rhythm and Spotify play affordance.
- Keyboard order per row: play/preview control, then Add button.

## Acceptance criteria

- Playlist-mode rows show song suggestions and match percent from `fitScore`.
- Add action adds suggestion song to review playlist.
- Long suggestion lists scroll without moving controls.
- Added rows remain visible with stable visible ranks.

## Notes on risks or ambiguity

- Avoid copying large song-section logic if a small shared concrete helper can be extracted without a barrel.
