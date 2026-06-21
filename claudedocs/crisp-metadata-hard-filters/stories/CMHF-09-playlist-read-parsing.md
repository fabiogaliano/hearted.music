# CMHF-09 — Playlist read parsing and invalid stored-filter handling

## Goal

Ensure playlist read paths parse `playlist.match_filters` safely before UI rendering and never crash on invalid stored data.

## Depends on / blocks

- Depends on: CMHF-01 and CMHF-02.
- Blocks: CMHF-13.

## Scope

In scope:

- Add a playlist read/view-model parsing helper that converts DB `match_filters` to `PlaylistMatchFiltersV1` for UI use.
- Use forgiving read parser semantics.
- Log structured warnings for invalid stored filters with account/playlist context and parser details.
- Normalize invalid stored filters to `{ version: 1 }` without writing repairs on read.
- Thread parsed data through playlist management reads or frontend mapping as appropriate.
- Add tests for unknown stored keys, invalid known fields, logging, and side-effect-free reads.

Out of scope:

- Save repair behavior beyond ensuring later saves can write normalized draft state.
- Production UI component rendering.
- Matching refresh invalid stored-filter handling, which is covered in CMHF-11/CMHF-12.

## Likely touchpoints

- `src/lib/server/playlists.functions.ts`
- `src/lib/domains/library/playlists/queries.ts`
- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/types.ts`
- Tests around playlist management reads or view-model helpers.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 3, 6, and 7.

- Reads are side-effect free; invalid stored data is not auto-repaired on load.
- Unknown stored keys are ignored if known fields are valid.
- Invalid known-field data invalidates the whole object to `{ version: 1 }`.
- UI/view models should receive normalized `PlaylistMatchFiltersV1`, not raw JSON.
- A later explicit save repairs invalid stored rows by writing normalized draft state.

## Acceptance criteria

- Playlist management/read path includes `match_filters` after CMHF-02.
- Valid filters reach the UI/view model unchanged except normalized ordering/defaults.
- Unknown stored keys do not crash and are not surfaced to UI state.
- Invalid known fields normalize to `{ version: 1 }` and log a structured warning.
- Read path does not write back to the database.
- Tests cover malformed JSON-like shapes from DB `Json` values.

## Notes on risks or ambiguity

- Decide whether parsing belongs server-side or in a small frontend mapper, but do not let components handle raw unvalidated JSON directly.
- Logging should be useful for internal diagnosis without exposing user-facing errors.
