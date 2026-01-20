/**
 * LyricsService - Genius-based lyrics fetching with annotations.
 *
 * Ported from v0 (old_app) with minimal changes:
 * - Uses TaggedError pattern for errors (matching v1 conventions)
 * - ConcurrencyLimiter(5, 50-200ms jitter) for rate limiting (5-20 req/sec)
 * - Search strategy with 0.6 threshold, 55/45 title/artist weights
 */

import wretch from "wretch";
import { Result } from "better-result";
import { ConcurrencyLimiter } from "@/lib/utils/concurrency";
import {
	GeniusNotFoundError,
	GeniusParseError,
	GeniusFetchError,
	GeniusConfigError,
	type GeniusError,
} from "@/lib/errors/external/genius";

import {
	type ResponseHitsResult,
	type ResponseReferents,
	type SearchResponse,
} from "./types/genius.types";
import { LyricsParser } from "./utils/lyrics-parser";
import {
	LyricsTransformer,
	type TransformedLyricsBySection,
} from "./utils/lyrics-transformer";
import { formatLyricsCompact } from "./utils/lyrics-formatter";
import {
	debugCandidates,
	findBestMatch,
	generateQueryVariants,
} from "./utils/search-strategy";

// ============================================================================
// Types
// ============================================================================

export interface LyricsServiceConfig {
	accessToken: string;
}

export { type TransformedLyricsBySection } from "./utils/lyrics-transformer";

// Re-export errors for consumers
export {
	GeniusNotFoundError,
	GeniusParseError,
	GeniusFetchError,
	GeniusConfigError,
	type GeniusError,
};

// ============================================================================
// Service
// ============================================================================

export class LyricsService {
	private readonly baseUrl = "https://api.genius.com";
	private readonly client: ReturnType<typeof wretch>;
	// Up to 5 concurrent in-flight requests, with 50-200ms jitter between request starts
	private readonly limiter = new ConcurrencyLimiter(5, 50, 200);

	constructor(config: LyricsServiceConfig) {
		if (!config.accessToken) {
			throw new GeniusConfigError("Access token is required");
		}

		this.client = wretch(this.baseUrl).headers({
			Authorization: `Bearer ${config.accessToken}`,
		});
	}

	/**
	 * Fetches lyrics with annotations for a song.
	 * Returns Result with GeniusError on failure.
	 */
	public async getLyrics(
		artist: string,
		song: string,
	): Promise<Result<TransformedLyricsBySection[], GeniusError>> {
		const searchResult = await this.searchSong(artist, song);
		if (Result.isError(searchResult)) {
			return Result.err(searchResult.error);
		}

		const [lyricsResult, referentsResult] = await Promise.all([
			this.fetchLyrics(searchResult.value.url),
			this.fetchReferents(searchResult.value.id),
		]);

		if (Result.isError(lyricsResult)) {
			return Result.err(lyricsResult.error);
		}
		if (Result.isError(referentsResult)) {
			return Result.err(referentsResult.error);
		}

		return Result.ok(
			LyricsTransformer.transform(lyricsResult.value, referentsResult.value),
		);
	}

	/**
	 * Fetches lyrics formatted with annotations (for analysis pipeline).
	 * Returns Result with section headers and annotation lines.
	 */
	public async getLyricsText(
		artist: string,
		song: string,
	): Promise<Result<string, GeniusError>> {
		const sectionsResult = await this.getLyrics(artist, song);
		if (Result.isError(sectionsResult)) {
			return Result.err(sectionsResult.error);
		}
		return Result.ok(formatLyricsCompact(sectionsResult.value));
	}

	private async searchSong(
		artist: string,
		song: string,
	): Promise<Result<ResponseHitsResult, GeniusError>> {
		const queryVariants = generateQueryVariants(artist, song);
		const debug = process.env.DEBUG_LYRICS_SEARCH === "true";
		let lastError: GeniusError | undefined;
		let hadSuccessfulResponse = false;

		if (debug) {
			console.log(
				`[LyricsService] Searching: ${artist} - ${song} (${queryVariants.length} variants)`,
			);
		}

		// Try each query variant until we find a good match
		for (const query of queryVariants) {
			const searchQuery = encodeURIComponent(query);
			const searchPath = `/search?q=${searchQuery}`;
			const searchUrl = `${this.baseUrl}${searchPath}`;
			try {
				const response: SearchResponse = await this.limiter.run(() =>
					this.client.get(searchPath).json(),
				);
				hadSuccessfulResponse = true;

				const hits = response.response?.hits;
				if (!hits || hits.length === 0) continue;

				const results = hits
					.map((hit) => hit.result)
					.filter((r): r is ResponseHitsResult => !!r?.url);

				if (debug) debugCandidates(results, artist, song);

				const match = findBestMatch(results, artist, song, query);
				if (match) {
					if (debug) {
						console.log(
							`[LyricsService] Match found: ${match.result.primary_artist.name} - ${match.result.title} (${(match.score * 100).toFixed(0)}%)`,
						);
					}
					return Result.ok(match.result);
				}
			} catch (error) {
				lastError =
					error instanceof GeniusFetchError || error instanceof GeniusParseError
						? error
						: error instanceof GeniusNotFoundError
							? error
							: new GeniusFetchError(searchUrl);
				if (debug) {
					console.warn(
						`[LyricsService] Search failed for "${query}": ${lastError.message}`,
					);
				}
				// Try next variant
			}
		}

		if (!hadSuccessfulResponse && lastError) {
			return Result.err(lastError);
		}

		return Result.err(new GeniusNotFoundError(artist, song));
	}

	private async fetchReferents(
		songId: number,
	): Promise<Result<ResponseReferents[], GeniusError>> {
		const perPage = 50;

		// Fire all 4 pages in parallel - most songs have <200 annotations
		// Using allSettled so one failed page doesn't break the whole fetch
		const results = await Promise.allSettled([
			this.fetchReferentsPage(songId, 1, perPage),
			this.fetchReferentsPage(songId, 2, perPage),
			this.fetchReferentsPage(songId, 3, perPage),
			this.fetchReferentsPage(songId, 4, perPage),
		]);

		// Extract successful results only
		const referents = results
			.filter(
				(r): r is PromiseFulfilledResult<ResponseReferents[]> =>
					r.status === "fulfilled",
			)
			.flatMap((r) => r.value);

		return Result.ok(referents);
	}

	private async fetchReferentsPage(
		songId: number,
		page: number,
		perPage: number,
	): Promise<ResponseReferents[]> {
		try {
			const response = (await this.limiter.run(() =>
				this.client
					.url(
						`/referents?song_id=${songId}&text_format=plain&per_page=${perPage}&page=${page}`,
					)
					.get()
					.json(),
			)) as { response?: { referents?: ResponseReferents[] } };
			return response.response?.referents || [];
		} catch {
			// Page doesn't exist or error - return empty
			return [];
		}
	}

	private async fetchLyrics(
		url: string,
	): Promise<
		Result<
			Array<{
				type: string;
				lines: Array<{ id: number; text: string }>;
				annotationLinks: Record<string, number[]>;
			}>,
			GeniusError
		>
	> {
		let response: string;
		try {
			response = await this.limiter.run(() => wretch(url).get().text());
		} catch (error) {
			if (error instanceof GeniusFetchError) {
				return Result.err(error);
			}
			return Result.err(new GeniusFetchError(url));
		}

		if (!response.includes("lyrics-root")) {
			return Result.err(
				new GeniusParseError(url, "Lyrics content not found on page"),
			);
		}

		try {
			return Result.ok(LyricsParser.parse(response));
		} catch (error) {
			if (error instanceof GeniusParseError) {
				return Result.err(error);
			}
			const reason = error instanceof Error ? error.message : String(error);
			return Result.err(new GeniusParseError(url, reason));
		}
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a LyricsService with token from environment.
 * Returns Result instead of throwing.
 */
export function createLyricsService(): Result<LyricsService, GeniusConfigError> {
	const accessToken = process.env.GENIUS_CLIENT_TOKEN;
	if (!accessToken) {
		return Result.err(
			new GeniusConfigError(
				"GENIUS_CLIENT_TOKEN environment variable is required",
			),
		);
	}
	return Result.ok(new LyricsService({ accessToken }));
}
