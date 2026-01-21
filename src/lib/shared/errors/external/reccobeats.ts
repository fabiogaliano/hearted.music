/**
 * ReccoBeats API error types.
 *
 * ReccoBeats provides free Spotify audio features data.
 * No authentication required, but rate limited.
 */

import { TaggedError } from "better-result";

/**
 * Rate limit exceeded (HTTP 429).
 * Contains retry-after hint if available.
 */
export class ReccoBeatsRateLimitError extends TaggedError(
	"ReccoBeatsRateLimitError",
)<{
	message: string;
	retryAfterMs?: number;
}>() {
	constructor(retryAfterMs?: number) {
		super({
			message: retryAfterMs
				? `Rate limited. Retry after ${retryAfterMs}ms`
				: "Rate limited by ReccoBeats API",
			retryAfterMs,
		});
	}
}

/**
 * Track not found in ReccoBeats database.
 * Common for newer or less popular tracks.
 */
export class ReccoBeatsNotFoundError extends TaggedError(
	"ReccoBeatsNotFoundError",
)<{
	message: string;
	spotifyTrackId: string;
}>() {
	constructor(spotifyTrackId: string) {
		super({
			message: `Track not found: ${spotifyTrackId}`,
			spotifyTrackId,
		});
	}
}

/**
 * Generic ReccoBeats API error.
 */
export class ReccoBeatsApiError extends TaggedError("ReccoBeatsApiError")<{
	message: string;
	statusCode: number;
	cause?: unknown;
}>() {
	constructor(statusCode: number, message: string, cause?: unknown) {
		super({
			message: `ReccoBeats API error (${statusCode}): ${message}`,
			statusCode,
			cause,
		});
	}
}

/** Union of all ReccoBeats errors */
export type ReccoBeatsError =
	| ReccoBeatsRateLimitError
	| ReccoBeatsNotFoundError
	| ReccoBeatsApiError;
