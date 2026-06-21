# CMHF-03 — Advanced filters shell and active chips prototype

## Goal

Prototype the Advanced filters shell and active chip row in Ladle with local state, without server or persistence wiring.

## Depends on / blocks

- Depends on: CMHF-01.
- Blocks: CMHF-04, CMHF-05, CMHF-06, and later production UI integration.

## Scope

In scope:

- Add presentational components for compact active filter chips and the Advanced filters collapsible shell.
- Compose the shell below Genres and above Save/Cancel in the `WritingSurface` Ladle harness.
- Support local draft mutation for chip removal.
- Implement fixed chip order: languages, release year, liked date, vocals.
- Implement Advanced filters trigger label, count, `aria-expanded`, and click/keyboard toggle.
- Add initial Ladle states for no filters, active filters, collapsed/expanded, and narrow width.

Out of scope:

- Full language picker.
- Full release-year and liked-date editors.
- Server option loading.
- Production `PlaylistsCoverFlowScreen` wiring.

## Likely touchpoints

- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/components/explorations/WritingSurface.stories.tsx`
- New component files under `src/features/playlists/components/explorations/` or a nearby match-filter UI subdirectory.
- `src/features/playlists/components/explorations/playlist-explorations.css` if styling needs shared classes.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 1, 7, and 10.

- UI section label is **Advanced filters**.
- Active count counts visible chips, not filter families.
- Language chips are one per selected language.
- Chips use compact value-only labels.
- Outside edit mode, chips are display-only.
- In edit mode, chip removal mutates the draft immediately; Save/Cancel remains the confirmation boundary.
- Advanced filters starts open when any saved/draft filters exist and remains open for that edit session once opened.

## Acceptance criteria

- Story shows no-filter collapsed state.
- Story shows multiple active compact chips in fixed filter-type order.
- Removing a chip updates only the local draft.
- Removing the last language chip omits the `languages` filter.
- Advanced filters trigger is a real button with accurate `aria-expanded` and active count.
- Trigger works with click, Enter, and Space.
- Existing intent and genre edit flows still work in stories.

## Notes on risks or ambiguity

- Visual spacing/density details are intentionally left for Ladle review, but behavior and accessibility cannot drift from decisions.
- Keep this story server-free so it can land before CMHF-07/CMHF-08.
