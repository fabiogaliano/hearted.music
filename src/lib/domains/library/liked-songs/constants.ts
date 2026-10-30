/**
 * Shared liked-songs pagination constants.
 *
 * Lives in its own module (not queries.ts) so the client bundle can import the
 * page size without pulling in the server-only Supabase admin client.
 */

/** Page size the client infinite query requests and renders per page. */
export const LIKED_SONGS_PAGE_SIZE = 50;

/**
 * Older rows seeded after the selected song on a deep link, on top of the prefix
 * through it, so the selection isn't the last loaded row. About a viewport's
 * worth of rows keeps a `block: "center"` scroll from clamping to the bottom on
 * first paint; it depends on row height, not on the page size.
 */
export const LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS = 30;
