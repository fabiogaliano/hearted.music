/**
 * Shared liked-songs pagination constants.
 *
 * Lives in its own module (not queries.ts) so the client bundle can import the
 * page size without pulling in the server-only Supabase admin client.
 */

/** Page size the client infinite query requests and renders per page. */
export const LIKED_SONGS_PAGE_SIZE = 15;

/**
 * Larger chunk size used when walking the library server-side (slug lookup and
 * deep-link bootstrap). Fetching in bigger chunks then rechunking into
 * `LIKED_SONGS_PAGE_SIZE` pages keeps DB round-trips low for deep deep-links.
 */
export const LIKED_SONGS_BOOTSTRAP_FETCH_SIZE = 100;

/**
 * Older rows seeded after the selected song on a deep link, on top of the prefix
 * through it, so the selection isn't the last loaded row. Two client pages keeps
 * a `block: "center"` scroll from clamping to the bottom on first paint.
 */
export const LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS = 2 * LIKED_SONGS_PAGE_SIZE;
