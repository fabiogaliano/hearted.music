/**
 * Per-card suggestion caps, applied BEFORE capture so the captured visible-pair
 * rows (the authority finish/dismiss read) are exactly the top-N the user could
 * see and act on — a decision never touches a suggestion off the bottom of the
 * list. Ordering is deterministic (visibleRank asc), so the same top-N is shown
 * across retries.
 *
 * These live in the domain layer (not the server-fn file) so the worker's
 * card materializer can import them without pulling @tanstack/react-start into
 * the worker bundle; the server read path imports PLAYLIST_CARD_SUGGESTION_CAP
 * from here too. Phase 3 consumes SONG_CARD_SUGGESTION_CAP in the pagination
 * contract.
 */

/**
 * Max suggestion songs on a single playlist-orientation card. One hub playlist
 * can match hundreds of eligible songs and the section renders them
 * unvirtualized, so payload/parse/DOM cost all scale with the raw count.
 */
export const PLAYLIST_CARD_SUGGESTION_CAP = 100;

/**
 * Max suggestion playlists on a single song-orientation card. Song cards are
 * naturally small (target playlists per song), but the cap guarantees no card
 * can grow without bound. Mirrors the playlist cap — there is no reason for the
 * two arms to differ.
 */
export const SONG_CARD_SUGGESTION_CAP = 100;
