# MSR-32 — Playlist review item section with hover preview

## Goal

Add the left-column playlist review item component for playlist mode using existing cover and track preview behavior.

## Depends on / blocks

Depends on:

- MSR-31

Blocks:

- MSR-33
- MSR-34

## Scope and out of scope

In scope:

- Create `PlaylistReviewItemSection`.
- Render playlist cover/name/intent or fallback subtitle.
- Use existing `Cover` placeholder behavior.
- Wire `usePlaylistTrackPreview` so hover/focus opens track preview and Escape closes it.
- Make cover/name/intent one bridged hover/focus region.
- Add story/component tests for hover/focus states where feasible.

Out of scope:

- Song suggestion rows.
- New visual chrome beyond swapped component.
- Server data shape changes.

## Likely touchpoints

- `src/features/matching/components/PlaylistReviewItemSection.tsx`
- `src/features/matching/components/usePlaylistTrackPreview.tsx`
- `src/features/matching/sections/MatchingSession.tsx`
- Stories/tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` F4, A4.
- Reuse existing playlist preview infrastructure.
- No additional UI chrome.

## Acceptance criteria

- Playlist mode left column shows playlist artwork/name/subtitle.
- Hover and keyboard focus open preview consistently with playlist rows.
- Escape closes preview.
- Song-mode section remains unchanged.

## Notes on risks or ambiguity

- Preview hooks may assume row context; keep changes reusable and avoid duplicating preview logic.
