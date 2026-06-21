# CMHF-13 — Thread filters through production editor

## Goal

Thread parsed `matchFilters` through the real playlist detail editor and render the Ladle-approved display/editor components with local draft state.

## Depends on / blocks

- Depends on: CMHF-06 and CMHF-09.
- Blocks: CMHF-14, CMHF-15, and CMHF-17.

## Scope

In scope:

- Extend `PlaylistSummary` with `matchFilters`.
- Map playlist rows to parsed filters in `PlaylistsCoverFlowScreen` or the agreed read-model helper.
- Thread saved and draft filters through `SpotlightPanel` and `WritingSurface` with `matchIntent` and `genrePills`.
- Render active filters outside edit mode as display-only compact chips under intent/genres.
- Render Advanced filters in edit mode below Genres and above Save/Cancel.
- Preserve existing `playlist.isTarget` gating.
- Keep local draft reset/cancel behavior for all three fields.
- Update stories to use production-shaped props.

Out of scope:

- Calling the production options RPC.
- Calling the combined save RPC.
- Save error handling.
- Vocal detector auto-fill.

## Likely touchpoints

- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/types.ts`
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.stories.tsx`

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 6 and 7.

- `matchIntent`, `genrePills`, and `matchFilters` share one draft and one Save/Cancel flow.
- Outside edit mode, filter chips are display-only; editing/removal requires entering edit mode.
- Active chips are visible source-of-truth, not hidden behavior.
- Non-target playlists do not expose the match-config editor.
- Advanced filters starts open in edit mode when filters exist.

## Acceptance criteria

- `PlaylistSummary` includes normalized `matchFilters`.
- Opening the editor seeds draft description, genres, and filters together.
- Cancel restores all three fields to saved values locally.
- Collapsed display shows saved active filter chips under existing intent/genre area.
- Non-target playlists still hide the editor area.
- Existing onboarding guided mode behavior remains intact.
- Updated Ladle stories render with production-shaped filter props.

## Notes on risks or ambiguity

- Current `SpotlightPanel` owns draft state and synchronously closes on save; defer persistence behavior changes to CMHF-15 but avoid making that harder.
- Be careful not to expose remove buttons outside edit mode.
