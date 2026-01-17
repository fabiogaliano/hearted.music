/**
 * Spotify API error types.
 */

import { TaggedError } from "better-result";

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
	reason: "expired" | "invalid" | "revoked";
	message: string;
}>() {
	constructor(reason: "expired" | "invalid" | "revoked") {
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
