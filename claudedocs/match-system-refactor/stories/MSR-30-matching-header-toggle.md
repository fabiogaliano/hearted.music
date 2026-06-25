# MSR-30 — Accessible Matching header Song/Playlist toggle

## Goal

Add the compact accessible Song/Playlist segmented toggle beside the match count.

## Depends on / blocks

Depends on:

- MSR-29

Blocks:

- MSR-31
- MSR-34

## Scope and out of scope

In scope:

- Update `MatchingHeaderProps` with mode, disabled state, and mode-change callback.
- Render two real buttons labelled `Song` and `Playlist` beside the count.
- Implement `aria-pressed`, disabled styling, keyboard activation through native buttons, and no-op current-mode activation.
- Call route navigation through `onModeChange`; preference update can be invoked by the parent after navigation is requested.
- Add component tests or stories for selected/disabled states.

Out of scope:

- Full session remount/reset behavior.
- Playlist-mode body components.
- Dashboard/sidebar preference behavior already in MSR-21.

## Likely touchpoints

- `src/features/matching/sections/MatchingHeader.tsx`
- `src/features/matching/Matching.tsx` prop plumbing
- Stories/tests

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` H1, A1, B2.
- No explanatory UI beyond toggle.
- Disabled keeps styling with opacity/cursor and native `disabled`.

## Acceptance criteria

- Toggle appears beside the count in header.
- Selected button exposes `aria-pressed="true"` and unselected exposes false.
- Buttons are disabled while mode changes/actions are pending.
- Activating the current mode does not navigate or update preference.

## Notes on risks or ambiguity

- Focus should remain on the activated button after navigation; if remounting disrupts this, document and test the chosen handling.
