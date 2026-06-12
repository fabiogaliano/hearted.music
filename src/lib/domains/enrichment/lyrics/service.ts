/**
 * LyricsService - Provider-ordered lyrics fetching (LRCLIB → Genius fallback).
 *
 * Provider order (Decision 1): LRCLIB first, Genius fallback only when LRCLIB
 * returns no record (not_found). LRCLIB's instrumental flag is authoritative.
 *
 * Spurious-match override (Decision 4): LRCLIB instrumental:true overrides a
 * Genius lyric match whose combined confidence is below MIN_COMBINED_SCORE (0.6).
 * A high-confidence Genius match stays lyrical even if LRCLIB says instrumental.
 *
 * Genius instrumental-page detection (Decision 2): when the Genius lyrics
 * container is absent and the page carries the known instrumental marker, the
 * outcome is instrumental rather than a parse error.
 *
 * Preserved from v0 (ported):
 * - ConcurrencyLimiter(5, 50-200ms jitter) for rate limiting
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

import {
	createLrclibProvider,
	type LrclibError,
	type LrclibProvider,
} from "./providers/lrclib";
import { upsertFetchOutcome } from "./queries";
import type {
	ResponseHitsResult,
	ResponseReferents,
	SearchResponse,
} from "./types/genius.types";
import type { LyricsOutcome } from "./types/lyrics.types";
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

// The Genius page includes this string verbatim when the track is instrumental.
// It is copy, not an API contract — the snapshot test pins it so a copy change
// breaks loudly rather than silently routing the track through the parse-error path.
export const GENIUS_INSTRUMENTAL_MARKER = "This song is an instrumental";

// Minimum combined similarity score to trust a Genius match as lyrical even
// when LRCLIB reports instrumental:true (Decision 4). Mirrors MIN_COMBINED_SCORE
// from utils/search-strategy.ts.
const GENIUS_LYRIC_CONFIDENCE_FLOOR = 0.6;

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

/** Parameters for a provider-ordered lyrics fetch. */
export interface FetchOutcomeParams {
	songId: string;
	artist: string;
	song: string;
	/** Album name for LRCLIB's full track signature (/api/get). */
	albumName?: string;
	/** Track duration in milliseconds for LRCLIB's ±2s matching. */
	durationMs?: number;
	/** Optional distiller for Genius annotation compression (optimization only). */
	distiller?: LyricsDistiller;
}

// Typed result from the internal HTML fetch, discriminated by whether the page
// is a lyrics page or the Genius instrumental page.
type FetchedHtml =
	| {
			kind: "sections";
			sections: ReturnType<typeof parseLyrics>;
	  }
	| { kind: "instrumental" };

// SearchSong now carries the match score so callers can apply Decision 4.
type SearchHit = ResponseHitsResult & { score: number };

export class LyricsService {
	private readonly baseUrl = "https://api.genius.com";
	private readonly authHeaders: Record<string, string>;
	private readonly limiter = sharedLimiter;
	private readonly lrclib: LrclibProvider;

	constructor(config: LyricsServiceConfig, lrclib?: LrclibProvider) {
		if (!config.accessToken) {
			throw new GeniusConfigError("Access token is required");
		}

		this.authHeaders = {
			Authorization: `Bearer ${config.accessToken}`,
		};
		this.lrclib = lrclib ?? createLrclibProvider();
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
			this.fetchHtml(searchResult.value.url),
			this.fetchReferents(searchResult.value.id),
		]);

		if (Result.isError(lyricsResult)) {
			return Result.err(lyricsResult.error);
		}
		if (Result.isError(referentsResult)) {
			return Result.err(referentsResult.error);
		}

		if (lyricsResult.value.kind === "instrumental") {
			// When fetchHtml detects the Genius instrumental marker, there are no
			// sections to return via this path. Callers needing instrumental signals
			// should use fetchAndStoreOutcome.
			return Result.err(
				new GeniusParseError(
					searchResult.value.url,
					"Page declares instrumental",
				),
			);
		}

		return Result.ok(
			transformLyrics(lyricsResult.value.sections, referentsResult.value),
		);
	}

	/**
	 * Fetches lyrics formatted with annotations.
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
	 * Provider-ordered lyrics fetch that returns a typed LyricsOutcome and
	 * persists Genius lyrics to the cache with optional distillation.
	 *
	 * Provider order:
	 * 1. LRCLIB (when albumName + durationMs are provided). Definitive outcomes
	 *    (lyrics, instrumental) are returned unless the override gate applies.
	 * 2. Genius fallback when LRCLIB returns not_found or metadata is absent.
	 *
	 * Spurious-match override (Decision 4): LRCLIB instrumental:true overrides
	 * a Genius match below GENIUS_LYRIC_CONFIDENCE_FLOOR; a high-confidence
	 * Genius match stays lyrical.
	 *
	 * Returns Result<LyricsOutcome, GeniusError | LrclibError>. The error channel
	 * means a transient provider failure — the outcome is unconfirmed and the
	 * song should be retried. A definitive "no lyrics" is represented as
	 * LyricsOutcome { kind: "not_found" | "instrumental" }, not an error.
	 */
	public async fetchAndStoreOutcome(
		params: FetchOutcomeParams,
	): Promise<Result<LyricsOutcome, GeniusError | LrclibError>> {
		const resolved = await this.resolveOutcome(params);
		if (Result.isError(resolved)) {
			// Transient provider failure — unconfirmed; do not write a row, the song
			// will be retried and we don't want to overwrite a prior good row.
			return Result.err(resolved.error);
		}

		const { outcome, geniusSections } = resolved.value;

		// Single persistence call site (Decision 5): every successful fetch attempt
		// writes exactly one row regardless of outcome kind. The Genius-lyrics case
		// passes the parsed sections so the full document is stored; all other kinds
		// produce no-document sentinel rows via upsertFetchOutcome.
		if (params.songId) {
			const persistResult = await upsertFetchOutcome(
				params.songId,
				outcome,
				geniusSections,
			);
			if (Result.isError(persistResult)) {
				console.warn(
					`[LyricsService] Failed to persist fetch outcome (${outcome.kind}) for ${params.songId} (${params.artist} - ${params.song}): ${persistResult.error.message}`,
				);
			}
		}

		return Result.ok(outcome);
	}

	/**
	 * Resolves the LyricsOutcome without any persistence side-effects.
	 * Separated from fetchAndStoreOutcome so the single-persistence-site
	 * invariant is obvious.
	 *
	 * Returns the outcome plus the parsed Genius sections when the match is a
	 * Genius lyric result; sections are undefined for all other outcomes so
	 * upsertFetchOutcome can pass them directly to the DB helper.
	 */
	private async resolveOutcome(params: FetchOutcomeParams): Promise<
		Result<
			{
				outcome: LyricsOutcome;
				geniusSections: ReturnType<typeof transformLyrics> | undefined;
			},
			GeniusError | LrclibError
		>
	> {
		// ── 1. Try LRCLIB ─────────────────────────────────────────────────────
		let lrclibInstrumental = false;

		if (params.albumName !== undefined && params.durationMs !== undefined) {
			const lrclibResult = await this.lrclib.fetchLyrics({
				trackName: params.song,
				artistName: params.artist,
				albumName: params.albumName,
				durationMs: params.durationMs,
			});

			if (Result.isOk(lrclibResult)) {
				const lrclibOutcome = lrclibResult.value;

				if (lrclibOutcome.kind === "instrumental") {
					// Remember the LRCLIB verdict; still query Genius in case it has a
					// high-confidence lyric match that should override (Decision 4).
					lrclibInstrumental = true;
				} else if (lrclibOutcome.kind === "lyrics") {
					// LRCLIB found lyrics — return immediately. No Genius fallback needed.
					// LRCLIB has no annotations so there is nothing to distill.
					return Result.ok({
						outcome: lrclibOutcome,
						geniusSections: undefined,
					});
				}
				// kind === "not_found": LRCLIB has no record, fall through to Genius.
			}
			// On LRCLIB transient error: fall through to Genius so an LRCLIB
			// outage doesn't hard-block the pipeline.
		}

		// ── 2. Genius fallback ────────────────────────────────────────────────
		const searchResult = await this.searchSong(params.artist, params.song);
		if (Result.isError(searchResult)) {
			if (lrclibInstrumental) {
				// LRCLIB said instrumental; Genius found nothing — trust LRCLIB.
				return Result.ok({
					outcome: { kind: "instrumental", source: "lrclib" },
					geniusSections: undefined,
				});
			}
			if (searchResult.error instanceof GeniusNotFoundError) {
				// Genius has no match for the track — definitive not_found. A 404 is
				// not a transient failure; the song is simply absent from Genius.
				return Result.ok({
					outcome: { kind: "not_found" },
					geniusSections: undefined,
				});
			}
			// Transient Genius error (fetch/parse/config) — unconfirmed, retry-eligible.
			return Result.err(searchResult.error);
		}

		const geniusUrl = searchResult.value.url;
		const geniusScore = searchResult.value.score;

		const [htmlResult, referentsResult] = await Promise.all([
			this.fetchHtml(geniusUrl),
			this.fetchReferents(searchResult.value.id),
		]);

		if (Result.isError(htmlResult)) {
			if (lrclibInstrumental) {
				return Result.ok({
					outcome: { kind: "instrumental", source: "lrclib" },
					geniusSections: undefined,
				});
			}
			return Result.err(htmlResult.error);
		}

		const fetched = htmlResult.value;

		// ── 2a. Genius instrumental page signal (Decision 2) ──────────────────
		if (fetched.kind === "instrumental") {
			return Result.ok({
				outcome: { kind: "instrumental", source: "genius_page" },
				geniusSections: undefined,
			});
		}

		// ── 2b. Spurious-match override (Decision 4) ──────────────────────────
		if (lrclibInstrumental && geniusScore < GENIUS_LYRIC_CONFIDENCE_FLOOR) {
			// Low-confidence Genius match + LRCLIB says instrumental → trust LRCLIB.
			return Result.ok({
				outcome: { kind: "instrumental", source: "lrclib" },
				geniusSections: undefined,
			});
		}

		// ── 2c. Genius lyric match — distill + format ────────────────────────
		const referents = Result.isOk(referentsResult) ? referentsResult.value : [];
		const geniusSections = transformLyrics(fetched.sections, referents);

		const distillations = params.distiller
			? await params.distiller(geniusSections)
			: undefined;

		const text = formatLyricsCompact(
			geniusSections,
			distillations ? { distillations } : undefined,
		);

		return Result.ok({
			outcome: {
				kind: "lyrics",
				text,
				source: "genius",
				confidence: geniusScore,
			},
			geniusSections,
		});
	}

	private async searchSong(
		artist: string,
		song: string,
	): Promise<Result<SearchHit, GeniusError>> {
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
				return Result.ok({ ...match.result, score: match.score });
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

	/**
	 * Fetches the Genius page HTML and parses it.
	 *
	 * Returns { kind: "instrumental" } when the page carries the instrumental
	 * marker but no lyrics container (Decision 2). Returns { kind: "sections" }
	 * with the parsed sections on success. Returns GeniusError on fetch/parse
	 * failures.
	 */
	private async fetchHtml(
		url: string,
	): Promise<Result<FetchedHtml, GeniusError>> {
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
		const html = responseResult.value;

		if (!html.includes("lyrics-root")) {
			return Result.err(
				new GeniusParseError(url, "Lyrics content not found on page"),
			);
		}

		try {
			const sections = parseLyrics(html);
			return Result.ok({ kind: "sections", sections });
		} catch (error) {
			// parseLyrics throws when [data-lyrics-container="true"] is absent.
			// Before surfacing a parse error, check whether the page explicitly
			// declares the track as instrumental — if so the absence of a lyrics
			// container is expected, not a provider fault (Decision 2).
			if (html.includes(GENIUS_INSTRUMENTAL_MARKER)) {
				return Result.ok({ kind: "instrumental" });
			}
			if (error instanceof GeniusParseError) {
				return Result.err(error);
			}
			const reason = errorMessage(error);
			return Result.err(new GeniusParseError(url, reason));
		}
	}
}

/**
 * Creates a LyricsService wired with LRCLIB and Genius.
 * Returns Result instead of throwing.
 */
export function createLyricsService(
	lrclib?: LrclibProvider,
): Result<LyricsService, GeniusConfigError> {
	const accessToken = env.GENIUS_CLIENT_TOKEN;
	if (!accessToken) {
		return Result.err(
			new GeniusConfigError(
				"GENIUS_CLIENT_TOKEN environment variable is required",
			),
		);
	}
	return Result.ok(
		new LyricsService({ accessToken }, lrclib ?? createLrclibProvider()),
	);
}
