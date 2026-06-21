# CMHF-15 — Combined save, error, and cancel integration

## Goal

Switch the production playlist editor to `savePlaylistMatchConfig` with one draft, normalized save reconciliation, and inline failure handling.

## Depends on / blocks

- Depends on: CMHF-07, CMHF-13, and CMHF-14.
- Blocks: production editor completion and CMHF-17.

## Scope

In scope:

- Replace production calls to `savePlaylistMatchIntent` and `savePlaylistGenrePills` with `savePlaylistMatchConfig`.
- Change `SpotlightPanel`/caller save contract from fire-and-forget `void` to async success/error handling.
- Preserve draft and keep edit mode open while save is pending or if save fails.
- Close edit mode only after save succeeds.
- Reconcile local saved state to normalized server response values.
- Show inline save error near Save.
- Invalidate playlist management query after successful save.
- Keep `markMetadataChanged()` behavior aligned with existing playlist session flow.
- Remove old production callers of separate save functions; delete old functions only if tests/callers are updated safely.
- Add/update tests or stories for save success, save failure, and normalized response reconciliation.

Out of scope:

- Server implementation of `savePlaylistMatchConfig`.
- Options RPC implementation.
- Vocal detector auto-fill.

## Likely touchpoints

- `src/features/playlists/PlaylistsCoverFlowScreen.tsx`
- `src/features/playlists/components/explorations/SpotlightPanel.tsx`
- `src/features/playlists/components/explorations/WritingSurface.tsx`
- `src/features/playlists/queries.ts`
- `src/lib/server/playlists.functions.ts` imports/callers.
- Ladle stories or component tests for async save states.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 6, 7, and 10.

- Save uses `playlistId`, `matchIntent`, `genrePills`, `matchFilters`.
- Draft remains until save succeeds.
- Save failure keeps editor open and preserves draft.
- Save success reconciles immediately to normalized response values.
- Invalidation failure inside the server is a degraded success from the UI perspective.
- Query invalidation still runs after successful save.

## Acceptance criteria

- Production editor no longer saves intent and genres through separate parallel RPC calls.
- Save button shows pending state and prevents duplicate submits.
- Save failure shows inline error near Save and preserves all draft fields.
- Cancel restores all three fields from saved local state.
- Save success closes editor and collapsed display shows normalized server response values.
- Playlist management query invalidates after success.
- Relevant `bun run test` and `bun run ladle:build` pass for touched UI.

## Notes on risks or ambiguity

- Current `SpotlightPanel.save` optimistically closes before persistence; this is the main behavior to reverse.
- Be explicit about async return type so story harnesses can simulate failure.
