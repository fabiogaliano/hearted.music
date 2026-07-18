/**
 * Shared playlist-draft paging constants.
 *
 * Lives in its own module (not draft-engine.ts) so the client bundle can
 * import the suggestions page size without pulling in the rest of the
 * scoring engine.
 */

/**
 * The paging contract between `useCreatePlaylistDraft` (client stride) and
 * `composePlaylistPreview` (server window width) for the suggestions tray. Both sides
 * must advance/slice by the same amount, or "Refresh suggestions" either
 * repeats songs (client stride < server width) or silently skips ranked
 * candidates (client stride > server width).
 */
export const SUGGESTIONS_COUNT = 12;
