/**
 * LyricsService — LRCLIB lyric text, enriched with Genius annotations.
 *
 * Flow (Genius HTML scrape removed — it was behind a Cloudflare JS challenge and
 * never once succeeded in production):
 *   1. LRCLIB is the sole source of lyric text. Its instrumental verdict is
 *      authoritative; its not_found is definitive. Requires album + duration.
 *   2. When LRCLIB returns lyrics, Genius is consulted via its API *only* for
 *      crowd-sourced annotations: search for the song (gated by the search
 *      confidence floor), fetch referents, and place each referent's `fragment`
 *      onto the LRCLIB lines by fuzzy match (see annotation-placement.ts).
 *
 * Annotation enrichment is best-effort: a missed Genius search, a referents
 * failure, or nothing aligning all fall back to storing the plain LRCLIB lyrics.
 * Every successful lyrics fetch logs an aggregate ("placed N/M annotations") so
 * the path is never silent.
 *
 * Preserved from v0: ConcurrencyLimiter(5, 50-200ms jitter) rate limiting; the
 * search strategy with its 0.6 title/artist floor.
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	GeniusConfigError,
	type GeniusError,
	GeniusFetchError,
	GeniusNotFoundError,
} from "@/lib/shared/errors/external/genius";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

import {
	createLrclibProvider,
	type LrclibError,
	LrclibFetchError,
	type LrclibProvider,
} from "./providers/lrclib";
import {
	createNeteaseProvider,
	type NeteaseError,
	NeteaseFetchError,
	type NeteaseProvider,
} from "./providers/netease";
import { upsertFetchOutcome } from "./queries";
import type {
	ResponseHitsResult,
	ResponseReferents,
	SearchResponse,
} from "./types/genius.types";
import type {
	LyricsOutcome,
	TransformedLyricsBySection,
} from "./types/lyrics.types";
import {
	ANNOTATION_PLACEMENT_FLOOR,
	type AnnotationPlacementResult,
	placeAnnotations,
} from "./utils/annotation-placement";
import { formatLyricsCompact } from "./utils/lyrics-formatter";
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
// 4xx and not-found are permanent. Genius exposes no Retry-After, so plain
// bounded backoff is all we apply.
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

// /api/get does a live external lookup for tracks not in LRCLIB's DB (per
// lrclib.net/docs): slow first fetch, prone to timeout under load. Retry absorbs
// it, and the slow call caches the entry so the retry usually hits it. Transient
// fetch failures only — parse errors and 4xx (incl. provider-mapped not_found) don't.
function isLrclibRetryable(error: LrclibError): boolean {
	if (!(error instanceof LrclibFetchError)) return false;
	const status = error.statusCode;
	return status === undefined || status >= 500 || status === 429;
}

const LRCLIB_RETRY_OPTIONS = {
	maxRetries: 3,
	baseDelayMs: 1_000,
	maxDelayMs: 8_000,
	isRetryable: isLrclibRetryable,
} as const;

// NetEase is the last-resort fallback, so retries stay lean. Retry transient
// transport failures (network/5xx/429) but not app-level codes such as -460
// ("Cheating", an abroad/IP block) — those won't clear within the retry window
// (a future change could route the retry through the worker's SOCKS proxy).
function isNeteaseRetryable(error: NeteaseError): boolean {
	if (!(error instanceof NeteaseFetchError)) return false;
	if (error.apiCode !== undefined) return false;
	const status = error.statusCode;
	return status === undefined || status >= 500 || status === 429;
}

const NETEASE_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 4_000,
	isRetryable: isNeteaseRetryable,
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

// Genius search hit carrying the match score (used for logging/debug only now).
type SearchHit = ResponseHitsResult & { score: number };

export class LyricsService {
	private readonly baseUrl = "https://api.genius.com";
	private readonly authHeaders: Record<string, string>;
	private readonly limiter = sharedLimiter;
	private readonly lrclib: LrclibProvider;
	private readonly netease: NeteaseProvider;

	constructor(
		config: LyricsServiceConfig,
		lrclib?: LrclibProvider,
		netease?: NeteaseProvider,
	) {
		if (!config.accessToken) {
			throw new GeniusConfigError("Access token is required");
		}

		this.authHeaders = {
			Authorization: `Bearer ${config.accessToken}`,
		};
		this.lrclib = lrclib ?? createLrclibProvider();
		this.netease = netease ?? createNeteaseProvider();
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
	 * Fetches a song's lyrics and persists exactly one song_lyrics row for the
	 * attempt. LRCLIB lyrics are enriched with Genius annotations; instrumental
	 * and not_found produce no-document sentinel rows via upsertFetchOutcome.
	 *
	 * Returns Result<LyricsOutcome, GeniusError | LrclibError>. The error channel
	 * means a transient provider failure — the outcome is unconfirmed and the song
	 * should be retried. A definitive "no lyrics" is LyricsOutcome
	 * { kind: "not_found" | "instrumental" }, not an error.
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

		const { outcome, sections } = resolved.value;

		// Single persistence call site: every successful fetch attempt writes exactly
		// one row. The lyrics case passes the annotated LRCLIB sections so the full
		// document is stored; other kinds produce no-document sentinel rows.
		if (params.songId) {
			const persistResult = await upsertFetchOutcome(
				params.songId,
				outcome,
				sections,
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
	 * Resolves the LyricsOutcome without persistence side-effects. Returns the
	 * annotated LRCLIB sections for the lyrics case (so upsertFetchOutcome stores
	 * the full document); undefined for instrumental/not_found.
	 */
	private async resolveOutcome(params: FetchOutcomeParams): Promise<
		Result<
			{
				outcome: LyricsOutcome;
				sections: TransformedLyricsBySection[] | undefined;
			},
			GeniusError | LrclibError
		>
	> {
		// LRCLIB is the sole lyric source. Without album + duration we cannot query
		// it, and with the Genius scrape gone there is no fallback → not_found.
		if (params.albumName === undefined || params.durationMs === undefined) {
			// Distinguish "inputs absent, never queried" from a genuine LRCLIB miss.
			const missing = [
				params.albumName === undefined ? "album" : null,
				params.durationMs === undefined ? "duration" : null,
			]
				.filter(Boolean)
				.join("+");
			console.info(
				`[LyricsService] not_found (missing ${missing}; LRCLIB not queried) for ${params.artist} - ${params.song}`,
			);
			return Result.ok({
				outcome: { kind: "not_found" },
				sections: undefined,
			});
		}

		// Capture the guard-narrowed inputs before the closure: TS drops the
		// non-undefined narrowing across the function boundary otherwise.
		const { albumName, durationMs } = params;

		// Shared limiter caps concurrent /api/get calls so a batch's prefetch can't
		// burst dozens of slow external lookups at once. Shared with Genius but never
		// nested (sequential here), so no deadlock. withRetry backs off outside the slot.
		const lrclibResult = await withRetry(
			() =>
				this.limiter.run(() =>
					this.lrclib.fetchLyrics({
						trackName: params.song,
						artistName: params.artist,
						albumName,
						durationMs,
					}),
				),
			LRCLIB_RETRY_OPTIONS,
		);
		if (Result.isError(lrclibResult)) {
			// LRCLIB failed transiently, so its verdict is unknown. Fall back to
			// NetEase. Only a positive NetEase verdict (lyrics/instrumental) is
			// adopted; a NetEase miss or its own failure is NOT authoritative here,
			// so we surface the original LRCLIB error and let the song be retried
			// once LRCLIB recovers — without writing an unconfirmed not_found row.
			const fallback = await this.resolveViaNetease(params, durationMs);
			if (fallback !== null) return Result.ok(fallback);
			return Result.err(lrclibResult.error);
		}

		const lrclibOutcome = lrclibResult.value;

		// LRCLIB's instrumental verdict is authoritative (the Genius override is gone).
		if (lrclibOutcome.kind === "instrumental") {
			return Result.ok({
				outcome: { kind: "instrumental", source: "lrclib" },
				sections: undefined,
			});
		}
		if (lrclibOutcome.kind === "not_found") {
			return Result.ok({ outcome: { kind: "not_found" }, sections: undefined });
		}

		// LRCLIB returned lyrics — enrich with Genius annotations (best-effort).
		return Result.ok(
			await this.finalizeLyrics(
				params,
				lrclibOutcome.text,
				"lrclib",
				lrclibOutcome.confidence,
			),
		);
	}

	/**
	 * Last-resort NetEase fallback, invoked only after LRCLIB fails transiently.
	 * Returns a resolved outcome for a positive verdict (lyrics/instrumental), or
	 * null when NetEase finds nothing or itself fails — null tells the caller to
	 * surface the original LRCLIB error so the song is retried later, rather than
	 * persisting an unauthoritative not_found. NetEase errors are swallowed here
	 * (logged): the fallback is best-effort and must never mask the LRCLIB error.
	 */
	private async resolveViaNetease(
		params: FetchOutcomeParams,
		durationMs: number,
	): Promise<{
		outcome: LyricsOutcome;
		sections: TransformedLyricsBySection[] | undefined;
	} | null> {
		const result = await withRetry(
			() =>
				this.limiter.run(() =>
					this.netease.fetchLyrics({
						trackName: params.song,
						artistName: params.artist,
						durationMs,
					}),
				),
			NETEASE_RETRY_OPTIONS,
		);
		if (Result.isError(result)) {
			console.warn(
				`[LyricsService] NetEase fallback failed for ${params.artist} - ${params.song}: ${result.error.message}`,
			);
			return null;
		}

		const outcome = result.value;
		if (outcome.kind === "instrumental") {
			console.info(
				`[LyricsService] NetEase fallback → instrumental for ${params.artist} - ${params.song}`,
			);
			return {
				outcome: { kind: "instrumental", source: "netease" },
				sections: undefined,
			};
		}
		if (outcome.kind === "not_found") {
			return null;
		}

		console.info(
			`[LyricsService] NetEase fallback → lyrics for ${params.artist} - ${params.song}`,
		);
		return this.finalizeLyrics(
			params,
			outcome.text,
			"netease",
			outcome.confidence,
		);
	}

	/**
	 * Shared lyrics finalization for LRCLIB and NetEase: enrich with Genius
	 * annotations (best-effort), apply the optional distiller, and format the
	 * compact stored text. Returns the outcome plus the annotated sections so the
	 * caller persists the full document.
	 */
	private async finalizeLyrics(
		params: FetchOutcomeParams,
		lyricText: string,
		source: "lrclib" | "netease",
		confidence: number,
	): Promise<{
		outcome: LyricsOutcome;
		sections: TransformedLyricsBySection[];
	}> {
		const placement = await this.attachAnnotations(params, lyricText);

		const distillations = params.distiller
			? await params.distiller(placement.sections)
			: undefined;

		const text = formatLyricsCompact(
			placement.sections,
			distillations ? { distillations } : undefined,
		);

		return {
			outcome: { kind: "lyrics", text, source, confidence },
			sections: placement.sections,
		};
	}

	/**
	 * Best-effort Genius annotation enrichment for LRCLIB lyrics. Never fails the
	 * result: any miss (no confident Genius match, referents failure, nothing
	 * aligning) yields the plain LRCLIB document with zero annotations.
	 */
	private async attachAnnotations(
		params: FetchOutcomeParams,
		lrclibText: string,
	): Promise<AnnotationPlacementResult> {
		const searchResult = await this.searchSong(params.artist, params.song);
		if (Result.isError(searchResult)) {
			// No confident Genius song match (or transient error) → plain lyrics.
			const plain = placeAnnotations(lrclibText, []);
			this.logPlacement(params, plain);
			return plain;
		}

		const referentsResult = await this.fetchReferents(searchResult.value.id);
		const referents = Result.isOk(referentsResult) ? referentsResult.value : [];

		const placement = placeAnnotations(lrclibText, referents, {
			floor: ANNOTATION_PLACEMENT_FLOOR,
		});
		this.logPlacement(params, placement);
		return placement;
	}

	private logPlacement(
		params: FetchOutcomeParams,
		placement: AnnotationPlacementResult,
	): void {
		console.info(
			`[LyricsService] placed ${placement.placed}/${placement.total} annotations for ${params.artist} - ${params.song}`,
		);
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

		// Page 1 first: most songs have <50 annotations, so a short page means 2-4
		// are empty. Only fan out when page 1 is full, saving 3 calls/limiter slots.
		const firstPage = await this.fetchReferentsPage(songId, 1, perPage);
		if (firstPage.length < perPage) {
			return Result.ok(firstPage);
		}

		// allSettled so one failed page doesn't break the rest; still capped at 4
		// pages (200 annotations) as before.
		const rest = await Promise.allSettled([
			this.fetchReferentsPage(songId, 2, perPage),
			this.fetchReferentsPage(songId, 3, perPage),
			this.fetchReferentsPage(songId, 4, perPage),
		]);

		const more = rest
			.filter(
				(r): r is PromiseFulfilledResult<ResponseReferents[]> =>
					r.status === "fulfilled",
			)
			.flatMap((r) => r.value);

		return Result.ok([...firstPage, ...more]);
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
}

/**
 * Creates a LyricsService wired with LRCLIB and Genius.
 * Returns Result instead of throwing.
 */
export function createLyricsService(
	lrclib?: LrclibProvider,
	netease?: NeteaseProvider,
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
		new LyricsService(
			{ accessToken },
			lrclib ?? createLrclibProvider(),
			netease ?? createNeteaseProvider(),
		),
	);
}
