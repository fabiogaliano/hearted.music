/**
 * Result wrappers for Spotify SDK calls.
 */

import { Result } from "better-result";
import {
	SpotifyApiError,
	SpotifyAuthError,
	type SpotifyError,
	SpotifyRateLimitError,
} from "@/lib/errors/spotify";

/**
 * Wraps a Spotify SDK call and converts errors to typed SpotifyError values.
 *
 * @example
 * const result = await fromSpotify(() => sdk.currentUser.profile());
 */
export async function fromSpotify<T>(
	fn: () => Promise<T>,
): Promise<Result<T, SpotifyError>> {
	return Result.tryPromise({
		try: fn,
		catch: (error) => mapSpotifyError(error),
	});
}

/**
 * Wraps a Spotify SDK call with automatic retry on rate limits.
 *
 * @example
 * const result = await fromSpotifyWithRetry(
 *   () => sdk.currentUser.tracks.savedTracks(50, 0),
 *   { maxRetries: 3 }
 * );
 */
export async function fromSpotifyWithRetry<T>(
	fn: () => Promise<T>,
	options: { maxRetries?: number } = {},
): Promise<Result<T, SpotifyError>> {
	const { maxRetries = 3 } = options;

	return Result.tryPromise(
		{
			try: fn,
			catch: (error) => mapSpotifyError(error),
		},
		{
			retry: {
				times: maxRetries,
				delayMs: 1000,
				backoff: "exponential",
			},
		},
	);
}

function mapSpotifyError(error: unknown): SpotifyError {
	if (typeof error === "object" && error !== null && "status" in error) {
		const httpError = error as {
			status: number;
			message?: string;
			headers?: { get?: (key: string) => string | null };
		};
		const status = httpError.status;
		const message = httpError.message ?? "Unknown error";

		switch (status) {
			case 401:
				return new SpotifyAuthError("expired");

			case 403:
				return new SpotifyAuthError("revoked");

			case 429: {
				const retryAfter = httpError.headers?.get?.("Retry-After");
				const retryMs = retryAfter
					? Number.parseInt(retryAfter, 10) * 1000
					: 1000;
				return new SpotifyRateLimitError(retryMs);
			}

			default:
				return new SpotifyApiError({ status, message });
		}
	}

	return new SpotifyApiError({
		status: 500,
		message: error instanceof Error ? error.message : String(error),
	});
}
