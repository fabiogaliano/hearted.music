/**
 * Spotify Service Module
 *
 * Entry point for Spotify API operations.
 * - Token refresh is handled by client.ts with Supabase storage
 * - SDK factory creates instances for API calls
 * - SpotifyService wraps SDK with retry + pagination
 * - Refresh coordination prevents duplicate token refreshes
 */

import { getTokenByAccountId, isTokenExpired } from "@/lib/data/auth-tokens";
import { refreshTokenWithCoordination } from "./client";
import { createSpotifyApi } from "./sdk";
import { SpotifyService } from "./service";

/**
 * Gets a SpotifyService instance for the given account.
 *
 * - Retrieves tokens from Supabase
 * - Refreshes if expired (with coordination to prevent duplicates)
 * - Creates SDK instance and wraps in SpotifyService
 *
 * @example
 * ```ts
 * const spotify = await getSpotifyService(accountId);
 * const tracks = await spotify.getLikedTracks();
 * ```
 */
export async function getSpotifyService(
	accountId: string,
): Promise<SpotifyService> {
	let token = await getTokenByAccountId(accountId);

	if (!token) {
		throw new Error("No token found for account");
	}

	// Refresh if expired (with coordination)
	if (isTokenExpired(token)) {
		token = await refreshTokenWithCoordination(accountId, token);
	}

	const sdk = createSpotifyApi(token.access_token);
	return new SpotifyService(sdk);
}

/** Re-export token exchange functions for OAuth callback */
export { exchangeCodeForTokens, fetchSpotifyUser } from "./client";
export type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
} from "./service";
/** Re-export SpotifyService class and types */
export { SpotifyService } from "./service";

/** Re-export Result-based request helpers */
export {
	fetchWithRetry,
	fetchOnce,
	classifySpotifyError,
	type RetryOptions,
} from "./request";

/** Re-export pagination helpers */
export {
	fetchAllPages,
	fetchPagesIterator,
	type PaginationOptions,
} from "./pagination";

/** Re-export mappers for Spotify -> DB shapes */
export {
	mapTrackToSongInsert,
	mapTrackToLikedSongInsert,
	mapPlaylistToPlaylistInsert,
	mapTrackToPlaylistSongInsert,
	mapTracksToSongInserts,
	mapPlaylistsToPlaylistInserts,
} from "./mappers";
