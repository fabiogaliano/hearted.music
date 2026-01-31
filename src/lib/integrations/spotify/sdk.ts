/**
 * Spotify SDK Factory
 *
 * Creates SDK instances from access tokens.
 * The SDK is used only for API calls - token refresh is handled by client.ts.
 */

import {
	type IValidateResponses,
	SpotifyApi,
} from "@fostertheweb/spotify-web-sdk";
import { env } from "@/env";

/**
 * Custom error that includes rate limit details from HTTP headers.
 */
export class SpotifyRateLimitHttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly retryAfterSeconds: number | null,
		public readonly rateLimitInfo: {
			limit: string | null;
			remaining: string | null;
			reset: string | null;
		},
	) {
		const retryMsg = retryAfterSeconds
			? ` Retry after ${retryAfterSeconds}s.`
			: "";
		super(`Spotify rate limit (429).${retryMsg}`);
		this.name = "SpotifyRateLimitHttpError";
	}
}

/**
 * Custom response validator that extracts rate limit headers before throwing.
 * This gives us access to Retry-After and X-RateLimit-* headers.
 */
class RateLimitAwareValidator implements IValidateResponses {
	async validateResponse(response: Response): Promise<void> {
		if (response.ok) {
			return; // 2xx - all good
		}

		// Extract rate limit headers for any error response
		const retryAfter = response.headers.get("Retry-After");
		const rateLimitInfo = {
			limit: response.headers.get("X-RateLimit-Limit"),
			remaining: response.headers.get("X-RateLimit-Remaining"),
			reset: response.headers.get("X-RateLimit-Reset"),
		};

		// Log all headers for debugging
		if (response.status === 429) {
			console.warn("[Spotify SDK] Rate limit response headers:");
			console.warn("  Retry-After:", retryAfter);
			console.warn("  X-RateLimit-Limit:", rateLimitInfo.limit);
			console.warn("  X-RateLimit-Remaining:", rateLimitInfo.remaining);
			console.warn("  X-RateLimit-Reset:", rateLimitInfo.reset);

			throw new SpotifyRateLimitHttpError(
				response.status,
				retryAfter ? Number.parseInt(retryAfter, 10) : null,
				rateLimitInfo,
			);
		}

		// For other errors, try to get message from body
		let message = `Spotify API error: ${response.status}`;
		try {
			const body = await response.json();
			if (body?.error?.message) {
				message = body.error.message;
			}
		} catch {
			// Ignore JSON parse errors
		}

		throw new Error(message);
	}
}

/**
 * Creates a Spotify SDK instance with the given access token.
 *
 * Note: We don't pass refresh_token to the SDK because token refresh
 * is handled by our own token client (client.ts) which stores tokens
 * in Supabase. The SDK is only used for API calls.
 */
export function createSpotifyApi(accessToken: string): SpotifyApi {
	const sdk = SpotifyApi.withAccessToken(
		env.SPOTIFY_CLIENT_ID,
		{
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: 3600, // Doesn't matter - we handle refresh externally
			refresh_token: "", // Not used - refresh handled by client.ts
		},
		{
			responseValidator: new RateLimitAwareValidator(),
		},
	);

	if (!sdk) {
		throw new Error("Failed to create SpotifyApi instance");
	}

	return sdk;
}

/** Re-export SpotifyApi type for consumers */
export type { SpotifyApi };
