/**
 * Last.fm API service for genre tag lookups.
 *
 * Uses album -> artist fallback chain (track tags are too sparse).
 * Returns top 3 genres filtered through canonical whitelist.
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	LastFmApiError,
	LastFmConfigError,
	type LastFmError,
	LastFmNotFoundError,
	LastFmRateLimitError,
} from "@/lib/shared/errors/external/lastfm";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";
import { extractPrimaryArtist, normalizeAlbumName } from "./normalize";
import {
	type GenreLookupResult,
	type GenreSourceLevel,
	LastFmAlbumTopTagsResponseSchema,
	LastFmArtistTopTagsResponseSchema,
	LastFmErrorResponseSchema,
	type LastFmTag,
} from "./types";
import { canonicalizeGenre, isGenre } from "./whitelist";

const BASE_URL = "https://ws.audioscrobbler.com/2.0";
const MAX_GENRES = 3;
// Bound each call so a hung upstream can't pin a worker slot indefinitely.
const REQUEST_TIMEOUT_MS = 15_000;

// Shared across all instances so concurrent worker jobs respect a single rate limit
const sharedLimiter = new ConcurrencyLimiter(5, 50, 200);

// Retry only transient cases: rate limits (error 29) and our synthesized
// network/parse failures (code 0). Real API error codes (not-found, config)
// would fail identically, so don't.
function isLastFmRetryable(error: LastFmError): boolean {
	if (error instanceof LastFmRateLimitError) return true;
	if (error instanceof LastFmApiError) return error.code === 0;
	return false;
}

function lastFmRetryAfterMs(error: LastFmError): number | undefined {
	return error instanceof LastFmRateLimitError && error.retryAfter
		? error.retryAfter * 1000
		: undefined;
}

const LASTFM_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 15_000,
	isRetryable: isLastFmRetryable,
	getRetryAfterMs: lastFmRetryAfterMs,
} as const;

export class LastFmService {
	private readonly apiKey: string;
	private readonly limiter = sharedLimiter;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	/**
	 * Get top tags for an album.
	 */
	async getAlbumTopTags(
		artist: string,
		album: string,
	): Promise<Result<GenreLookupResult | null, LastFmError>> {
		const params = new URLSearchParams({
			method: "album.getTopTags",
			artist,
			album,
			api_key: this.apiKey,
			autocorrect: "1",
			format: "json",
		});

		return withRetry(
			() =>
				this.limiter.run(async () => {
					const fetchResult = await Result.tryPromise({
						try: () =>
							fetch(`${BASE_URL}?${params}`, {
								signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
							}),
						catch: (e) =>
							new LastFmApiError(0, e instanceof Error ? e.message : String(e)),
					});

					if (Result.isError(fetchResult)) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							fetchResult.error,
						);
					}

					const jsonResult = await Result.tryPromise({
						try: () => fetchResult.value.json(),
						catch: () => new LastFmApiError(0, "Failed to parse JSON response"),
					});

					if (Result.isError(jsonResult)) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							jsonResult.error,
						);
					}

					// Try error response first
					const errorParse = LastFmErrorResponseSchema.safeParse(
						jsonResult.value,
					);
					if (errorParse.success) {
						const data = errorParse.data;
						if (data.error === 29) {
							return Result.err<GenreLookupResult | null, LastFmError>(
								new LastFmRateLimitError(),
							);
						}
						if (data.error === 6) {
							return Result.err<GenreLookupResult | null, LastFmError>(
								new LastFmNotFoundError(artist, undefined, album),
							);
						}
						return Result.err<GenreLookupResult | null, LastFmError>(
							new LastFmApiError(data.error, data.message),
						);
					}

					// Validate success response
					const parseResult = LastFmAlbumTopTagsResponseSchema.safeParse(
						jsonResult.value,
					);
					if (!parseResult.success) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							new LastFmApiError(
								0,
								`Invalid API response: ${parseResult.error.message}`,
							),
						);
					}

					return Result.ok<GenreLookupResult | null, LastFmError>(
						this.tagsToResult(parseResult.data.toptags.tag, "album"),
					);
				}),
			LASTFM_RETRY_OPTIONS,
		);
	}

	/**
	 * Get top tags for an artist.
	 */
	async getArtistTopTags(
		artist: string,
	): Promise<Result<GenreLookupResult | null, LastFmError>> {
		const params = new URLSearchParams({
			method: "artist.getTopTags",
			artist,
			api_key: this.apiKey,
			autocorrect: "1",
			format: "json",
		});

		return withRetry(
			() =>
				this.limiter.run(async () => {
					const fetchResult = await Result.tryPromise({
						try: () =>
							fetch(`${BASE_URL}?${params}`, {
								signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
							}),
						catch: (e) =>
							new LastFmApiError(0, e instanceof Error ? e.message : String(e)),
					});

					if (Result.isError(fetchResult)) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							fetchResult.error,
						);
					}

					const jsonResult = await Result.tryPromise({
						try: () => fetchResult.value.json(),
						catch: () => new LastFmApiError(0, "Failed to parse JSON response"),
					});

					if (Result.isError(jsonResult)) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							jsonResult.error,
						);
					}

					// Try error response first
					const errorParse = LastFmErrorResponseSchema.safeParse(
						jsonResult.value,
					);
					if (errorParse.success) {
						const data = errorParse.data;
						if (data.error === 29) {
							return Result.err<GenreLookupResult | null, LastFmError>(
								new LastFmRateLimitError(),
							);
						}
						if (data.error === 6) {
							return Result.err<GenreLookupResult | null, LastFmError>(
								new LastFmNotFoundError(artist),
							);
						}
						return Result.err<GenreLookupResult | null, LastFmError>(
							new LastFmApiError(data.error, data.message),
						);
					}

					// Validate success response
					const parseResult = LastFmArtistTopTagsResponseSchema.safeParse(
						jsonResult.value,
					);
					if (!parseResult.success) {
						return Result.err<GenreLookupResult | null, LastFmError>(
							new LastFmApiError(
								0,
								`Invalid API response: ${parseResult.error.message}`,
							),
						);
					}

					return Result.ok<GenreLookupResult | null, LastFmError>(
						this.tagsToResult(parseResult.data.toptags.tag, "artist"),
					);
				}),
			LASTFM_RETRY_OPTIONS,
		);
	}

	/**
	 * Get tags with fallback chain: album -> artist.
	 * Track-level tags are skipped as they're too sparse on Last.fm.
	 */
	async getTagsWithFallback(
		artist: string,
		_track: string,
		album?: string,
	): Promise<Result<GenreLookupResult | null, LastFmError>> {
		const primaryArtist = extractPrimaryArtist(artist);

		// Try album first if provided
		if (album) {
			const normalizedAlbum = normalizeAlbumName(album);
			const albumResult = await this.getAlbumTopTags(
				primaryArtist,
				normalizedAlbum,
			);

			if (Result.isError(albumResult)) {
				if (!(albumResult.error instanceof LastFmNotFoundError)) {
					return albumResult;
				}
			} else if (albumResult.value !== null) {
				return Result.ok(albumResult.value);
			}
		}

		// Fallback to artist
		const artistResult = await this.getArtistTopTags(primaryArtist);
		if (Result.isError(artistResult)) return artistResult;

		return Result.ok(artistResult.value);
	}

	/**
	 * Convert raw tags to normalized result.
	 * Filters through genre whitelist and limits to MAX_GENRES.
	 */
	private tagsToResult(
		tags: LastFmTag[],
		sourceLevel: GenreSourceLevel,
	): GenreLookupResult | null {
		// Filter to recognized genres, canonicalize, and deduplicate
		const seen = new Set<string>();
		const dedupedTags: Array<{ name: string; count: number }> = [];

		for (const t of tags) {
			if (!isGenre(t.name)) continue;
			const canonical = canonicalizeGenre(t.name);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			dedupedTags.push({ name: canonical, count: t.count });
		}

		if (dedupedTags.length === 0) {
			return null; // Triggers fallback
		}

		const topGenres = dedupedTags.slice(0, MAX_GENRES);

		return {
			tags: topGenres.map((t) => t.name),
			tagsWithScores: topGenres.map((t) => ({
				name: t.name,
				score: t.count,
			})),
			sourceLevel,
			source: "lastfm" as const,
		};
	}
}

/**
 * Factory function to create LastFmService.
 * Returns Result.err(LastFmConfigError) if LASTFM_API_KEY is not configured,
 * so callers handle the missing-key case through the Result contract rather
 * than a separate null branch.
 */
export function createLastFmService(): Result<
	LastFmService,
	LastFmConfigError
> {
	const apiKey = env.LASTFM_API_KEY;

	if (!apiKey) {
		return Result.err(
			new LastFmConfigError("LASTFM_API_KEY is not configured"),
		);
	}

	return Result.ok(new LastFmService(apiKey));
}
