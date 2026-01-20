/**
 * Genius API error types (lyrics fetching).
 */

import { TaggedError } from "better-result";

/** Song not found in Genius search */
export class GeniusNotFoundError extends TaggedError("GeniusNotFoundError")<{
	artist: string;
	title: string;
	message: string;
}>() {
	constructor(artist: string, title: string) {
		super({
			artist,
			title,
			message: `Song not found: ${artist} - ${title}`,
		});
	}
}

/** Failed to parse lyrics HTML from Genius page */
export class GeniusParseError extends TaggedError("GeniusParseError")<{
	url: string;
	reason: string;
	message: string;
}>() {
	constructor(url: string, reason: string) {
		super({
			url,
			reason,
			message: `Failed to parse lyrics: ${reason}`,
		});
	}
}

/** Failed to fetch Genius page */
export class GeniusFetchError extends TaggedError("GeniusFetchError")<{
	url: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(url: string, statusCode?: number) {
		super({
			url,
			statusCode,
			message: `Failed to fetch lyrics page${statusCode ? ` (${statusCode})` : ""}`,
		});
	}
}

/** Genius service configuration error */
export class GeniusConfigError extends TaggedError("GeniusConfigError")<{
	reason: string;
	message: string;
}>() {
	constructor(reason: string) {
		super({
			reason,
			message: `Genius service error: ${reason}`,
		});
	}
}

/** All Genius/Lyrics errors */
export type GeniusError =
	| GeniusNotFoundError
	| GeniusParseError
	| GeniusFetchError
	| GeniusConfigError;
