/**
 * LyricsService - Genius-based lyrics fetching with annotations.
 *
 * Ported from v0 (old_app) with minimal changes:
 * - Uses TaggedError pattern for errors (matching v1 conventions)
 * - ConcurrencyLimiter(5, 50-200ms jitter) for rate limiting (5-20 req/sec)
 * - Search strategy with 0.6 threshold, 55/45 title/artist weights
 */

import { Result } from "better-result";
import { env } from "@/env";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	GeniusConfigError,
	type GeniusError,
	GeniusFetchError,
	GeniusNotFoundError,
	GeniusParseError,
} from "@/lib/shared/errors/external/genius";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

import { getSongLyricsDocument, upsertSongLyrics } from "./queries";
import type {
	ResponseHitsResult,
	ResponseReferents,
	SearchResponse,
} from "./types/genius.types";
import { formatLyricsCompact } from "./utils/lyrics-formatter";
import { parseLyrics } from "./utils/lyrics-parser";
import {
	type TransformedLyricsBySection,
	transformLyrics,
} from "./utils/lyrics-transformer";
import {
	debugCandidates,
	findBestMatch,
	generateQueryVariants,
} from "./utils/search-strategy";

interface LyricsServiceConfig {
	accessToken: string;
}

/**
 * Injected by the analysis layer to compress annotations before formatting, keeping this
 * service free of any LLM dependency. Returns Map<normalizedText, distilledText> and must
 * never throw — distillation is an optimization, not a hard dependency.
 */
export type LyricsDistiller = (
	sections: TransformedLyricsBySection[],
) => Promise<Map<string, string>>;

// Shared across all instances so concurrent worker jobs respect a single rate limit
const sharedLimiter = new ConcurrencyLimiter(5, 50, 200);
// Bound each call so a hung upstream can't pin a worker slot indefinitely.
const REQUEST_TIMEOUT_MS = 15_000;

// Retry only transient fetch failures: network/timeout (no status) or 5xx.
// 4xx, parse failures, and not-found are permanent. Genius exposes no
// Retry-After, so plain bounded backoff is all we apply.
function isGeniusRetryable(error: GeniusError): boolean {
	if (error instanceof GeniusFetchError) {
		return error.statusCode === undefined || error.statusCode >= 500;
	}
	return false;
}

const GENIUS_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 15_000,
	isRetryable: isGeniusRetryable,
} as const;

export class LyricsService {
	private readonly baseUrl = "https://api.genius.com";
	private readonly authHeaders: Record<string, string>;
	private readonly limiter = sharedLimiter;

	constructor(config: LyricsServiceConfig) {
		if (!config.accessToken) {
			throw new GeniusConfigError("Access token is required");
		}

		this.authHeaders = {
			Authorization: `Bearer ${config.accessToken}`,
		};
	}

	// fetch resolves non-2xx responses instead of rejecting, so the !ok throw
	// inside the try is what surfaces HTTP errors; Result.tryPromise also
	// captures timeouts and JSON-parse failures as a typed GeniusError.
	private async getJson<T>(path: string): Promise<Result<T, GeniusError>> {
		const url = `${this.baseUrl}${path}`;
		return Result.tryPromise({
			try: async () => {
				const response = await fetch(url, {
					headers: this.authHeaders,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (!response.ok) {
					throw new GeniusFetchError(url, response.status);
				}
				return (await response.json()) as T;
			},
			catch: (error) =>
				error instanceof GeniusFetchError ? error : new GeniusFetchError(url),
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
			transformLyrics(lyricsResult.value, referentsResult.value),
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

	/**
	 * Returns cached lyrics when available; otherwise fetches from Genius,
	 * persists the structured sections for the song, and returns compact text
	 * for analysis. Cache read/write failures are logged but never block fetches.
	 */
	public async fetchAndStoreLyrics(
		songId: string,
		artist: string,
		song: string,
		options?: { distiller?: LyricsDistiller },
	): Promise<Result<string, GeniusError>> {
		const sectionsResult = await this.resolveSections(songId, artist, song);
		if (Result.isError(sectionsResult)) {
			return Result.err(sectionsResult.error);
		}
		const sections = sectionsResult.value;

		const distillations = options?.distiller
			? await options.distiller(sections)
			: undefined;

		return Result.ok(
			formatLyricsCompact(
				sections,
				distillations ? { distillations } : undefined,
			),
		);
	}

	/**
	 * Returns the song's lyrics sections from cache, or fetches from Genius and persists
	 * them. Cache read/write failures are logged but never block the fetch.
	 */
	private async resolveSections(
		songId: string,
		artist: string,
		song: string,
	): Promise<Result<TransformedLyricsBySection[], GeniusError>> {
		const cachedResult = await getSongLyricsDocument(songId);
		if (Result.isOk(cachedResult) && cachedResult.value !== null) {
			return Result.ok(cachedResult.value.sections);
		}
		if (Result.isError(cachedResult)) {
			console.warn(
				`[LyricsService] Failed to read cached lyrics for ${songId} (${artist} - ${song}): ${cachedResult.error.message}`,
			);
		}

		const sectionsResult = await this.getLyrics(artist, song);
		if (Result.isError(sectionsResult)) {
			return Result.err(sectionsResult.error);
		}

		const sections = sectionsResult.value;

		const saveResult = await upsertSongLyrics(songId, sections);
		if (Result.isError(saveResult)) {
			console.warn(
				`[LyricsService] Failed to persist lyrics for ${songId} (${artist} - ${song}): ${saveResult.error.message}`,
			);
		}

		return Result.ok(sections);
	}

	private async searchSong(
		artist: string,
		song: string,
	): Promise<Result<ResponseHitsResult, GeniusError>> {
		const queryVariants = generateQueryVariants(artist, song);
		// biome-ignore lint/style/noProcessEnv: dev-only debug flag, intentionally not part of validated env
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

			const responseResult = await withRetry(
				() => this.limiter.run(() => this.getJson<SearchResponse>(searchPath)),
				GENIUS_RETRY_OPTIONS,
			);
			if (Result.isError(responseResult)) {
				lastError = responseResult.error;
				if (debug) {
					console.warn(
						`[LyricsService] Search failed for "${query}": ${lastError.message}`,
					);
				}
				continue;
			}
			hadSuccessfulResponse = true;

			const hits = responseResult.value.response?.hits;
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
		const result = await this.limiter.run(() =>
			this.getJson<{ response?: { referents?: ResponseReferents[] } }>(
				`/referents?song_id=${songId}&text_format=plain&per_page=${perPage}&page=${page}`,
			),
		);
		// Page doesn't exist or error - return empty
		if (Result.isError(result)) return [];
		return result.value.response?.referents || [];
	}

	private async fetchLyrics(url: string): Promise<
		Result<
			Array<{
				type: string;
				lines: Array<{ id: number; text: string }>;
				annotationLinks: Record<string, number[]>;
			}>,
			GeniusError
		>
	> {
		const responseResult = await withRetry(
			() =>
				this.limiter.run(() =>
					Result.tryPromise({
						try: async () => {
							const res = await fetch(url, {
								signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
							});
							if (!res.ok) {
								throw new GeniusFetchError(url, res.status);
							}
							return res.text();
						},
						catch: (error) =>
							error instanceof GeniusFetchError
								? error
								: new GeniusFetchError(url),
					}),
				),
			GENIUS_RETRY_OPTIONS,
		);
		if (Result.isError(responseResult)) {
			return Result.err(responseResult.error);
		}
		const response = responseResult.value;

		if (!response.includes("lyrics-root")) {
			return Result.err(
				new GeniusParseError(url, "Lyrics content not found on page"),
			);
		}

		try {
			return Result.ok(parseLyrics(response));
		} catch (error) {
			if (error instanceof GeniusParseError) {
				return Result.err(error);
			}
			const reason = errorMessage(error);
			return Result.err(new GeniusParseError(url, reason));
		}
	}
}

/**
 * Creates a LyricsService with token from environment.
 * Returns Result instead of throwing.
 */
export function createLyricsService(): Result<
	LyricsService,
	GeniusConfigError
> {
	const accessToken = env.GENIUS_CLIENT_TOKEN;
	if (!accessToken) {
		return Result.err(
			new GeniusConfigError(
				"GENIUS_CLIENT_TOKEN environment variable is required",
			),
		);
	}
	return Result.ok(new LyricsService({ accessToken }));
}
