/**
 * Shared liked-songs pagination constants.
 *
 * Lives in its own module (not queries.ts) so the client bundle can import the
 * page size without pulling in the server-only Supabase admin client.
 */

/** Page size the client infinite query requests and renders per page. */
export const LIKED_SONGS_PAGE_SIZE = 50;

/**
 * Rows a deep link seeds on each side of the selected song. The list loads
 * further in either direction from there, so this only has to cover the
 * first screen around the song.
 */
export const LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS = LIKED_SONGS_PAGE_SIZE;

/**
 * Rows a warm list needs on each side of the selected song (unless the list
 * ends there) to skip the deep-link bootstrap. About a viewport's worth keeps
 * a `block: "center"` scroll from clamping on first paint; it depends on row
 * height, not on the page size.
 */
export const LIKED_SONGS_DEEP_LINK_CENTRING_ROWS = 30;
