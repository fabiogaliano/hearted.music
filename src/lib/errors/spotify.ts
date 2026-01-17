/**
 * Spotify API error types.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Reasons for Spotify authentication failures */
export const SPOTIFY_AUTH_REASONS = z.enum(["expired", "invalid", "revoked"]);
export type SpotifyAuthReason = z.infer<typeof SPOTIFY_AUTH_REASONS>;

/** Spotify API rate limit exceeded (HTTP 429) */
export class SpotifyRateLimitError extends TaggedError(
	"SpotifyRateLimitError",
)<{
	retryAfterMs: number;
	message: string;
}>() {
	constructor(retryAfterMs: number) {
		super({
			retryAfterMs,
			message: `Spotify rate limit exceeded, retry after ${retryAfterMs}ms`,
		});
	}
}

/** Spotify access token expired or invalid */
export class SpotifyAuthError extends TaggedError("SpotifyAuthError")<{
	reason: SpotifyAuthReason;
	message: string;
}>() {
	constructor(reason: SpotifyAuthReason) {
		super({
			reason,
			message: `Spotify auth failed: ${reason}`,
		});
	}
}

/** Spotify resource not found (track, playlist, etc.) */
export class SpotifyNotFoundError extends TaggedError("SpotifyNotFoundError")<{
	resourceType: string;
	resourceId: string;
	message: string;
}>() {
	constructor(resourceType: string, resourceId: string) {
		super({
			resourceType,
			resourceId,
			message: `Spotify ${resourceType} not found: ${resourceId}`,
		});
	}
}

/** Generic Spotify API error */
export class SpotifyApiError extends TaggedError("SpotifyApiError")<{
	status: number;
	message: string;
}>() {}

/** All Spotify-related errors */
export type SpotifyError =
	| SpotifyRateLimitError
	| SpotifyAuthError
	| SpotifyNotFoundError
	| SpotifyApiError;
