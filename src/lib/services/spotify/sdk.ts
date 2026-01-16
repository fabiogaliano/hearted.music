/**
 * Spotify SDK Factory
 *
 * Creates SDK instances from access tokens.
 * The SDK is used only for API calls - token refresh is handled by client.ts.
 */

import { SpotifyApi } from "@fostertheweb/spotify-web-sdk";
import { env } from "@/env";

/**
 * Creates a Spotify SDK instance with the given access token.
 *
 * Note: We don't pass refresh_token to the SDK because token refresh
 * is handled by our own token client (client.ts) which stores tokens
 * in Supabase. The SDK is only used for API calls.
 */
export function createSpotifyApi(accessToken: string): SpotifyApi {
	const sdk = SpotifyApi.withAccessToken(env.SPOTIFY_CLIENT_ID, {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 3600, // Doesn't matter - we handle refresh externally
		refresh_token: "", // Not used - refresh handled by client.ts
	});

	if (!sdk) {
		throw new Error("Failed to create SpotifyApi instance");
	}

	return sdk;
}

/** Re-export SpotifyApi type for consumers */
export type { SpotifyApi };
