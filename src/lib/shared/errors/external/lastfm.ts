/**
 * Last.fm API error types (genre enrichment).
 */

import { TaggedError } from "better-result";

/** Rate limit exceeded (429) */
export class LastFmRateLimitError extends TaggedError("LastFmRateLimitError")<{
	retryAfter?: number;
	message: string;
}>() {
	constructor(retryAfter?: number) {
		super({
			retryAfter,
			message: retryAfter
				? `Rate limit exceeded, retry after ${retryAfter}s`
				: "Rate limit exceeded",
		});
	}
}

/** Artist/album/track not found */
export class LastFmNotFoundError extends TaggedError("LastFmNotFoundError")<{
	artist: string;
	track?: string;
	album?: string;
	message: string;
}>() {
	constructor(artist: string, track?: string, album?: string) {
		const context = track
			? `${artist} - ${track}`
			: album
				? `${artist} - ${album}`
				: artist;
		super({
			artist,
			track,
			album,
			message: `Not found on Last.fm: ${context}`,
		});
	}
}

/** Generic API error */
export class LastFmApiError extends TaggedError("LastFmApiError")<{
	code: number;
	reason: string;
	message: string;
}>() {
	constructor(code: number, reason: string) {
		super({
			code,
			reason,
			message: `Last.fm API error ${code}: ${reason}`,
		});
	}
}

/** Service configuration error (missing API key) */
export class LastFmConfigError extends TaggedError("LastFmConfigError")<{
	reason: string;
	message: string;
}>() {
	constructor(reason: string) {
		super({
			reason,
			message: `Last.fm service error: ${reason}`,
		});
	}
}

/** All Last.fm errors */
export type LastFmError =
	| LastFmRateLimitError
	| LastFmNotFoundError
	| LastFmApiError
	| LastFmConfigError;
