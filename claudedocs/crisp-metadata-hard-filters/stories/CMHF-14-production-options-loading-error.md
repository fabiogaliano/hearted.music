# CMHF-14 — Production options loading/error wiring

## Goal

Wire `getPlaylistMatchFilterOptions` into the production editor and apply loading/error behavior without blocking intent or genre editing.

## Depends on / blocks

- Depends on: CMHF-08 and CMHF-13.
- Blocks: CMHF-15.

## Scope

In scope:

- Add/use frontend query options for `getPlaylistMatchFilterOptions`.
- Fetch options for the current account in the playlist screen or editor owner.
- Pass options/loading/error state into `WritingSurface` filter controls.
- Disable adding/editing filter values while options are loading or failed.
- Keep existing draft chips visible and removable while options are loading or failed.
- Keep intent and genre editing enabled while options are loading or failed.
- Add/update stories for loading and failed option states using production-shaped props.

Out of scope:

- Save RPC integration.
- Changing options aggregation server behavior.
- User-facing detailed error explanations.

## Likely touchpoints

- `src/features/playlists/queries.ts`
- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- Ladle stories with mocked query-like states.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 6 and 7.

- `getPlaylistMatchFilterOptions` has no `playlistId` input.
- Existing active chips remain visible on option load/error.
- Existing draft chip remove actions remain enabled.
- Expanded controls are fully disabled when options are loading or failed.
- Save remains available for intent/genre changes and sends preserved filter draft minus removed filters.
- Copy should be minimal.

## Acceptance criteria

- Options query uses a stable account-scoped query key.
- Loading state does not block opening/editing intent or genres.
- Error state does not hide existing filters.
- Chip removal still works in loading/error states.
- Add/edit controls are disabled or hidden according to option availability.
- Stories demonstrate loading and error states in both isolated `WritingSurface` and composed `SpotlightPanel` contexts.

## Notes on risks or ambiguity

- Avoid treating option-load failure as save failure; users can still save intent/genre changes and filter removals.
- Ensure saved out-of-bounds release-year/liked-date filters remain inspectable/editable when options load successfully.
