/**
 * LRCLIB lyrics provider.
 *
 * DECISION — User-Agent: "hearted/1.0 (https://github.com/hearted-app/hearted)"
 * LRCLIB asks clients to identify themselves in requests; the value is not
 * validated but is good citizenship. We use the app name and the GitHub org
 * URL as a contact point, matching LRCLIB's documentation examples.
 *
 * DECISION — similarity floor for /api/search results: 0.6 (the same
 * MIN_COMBINED_SCORE already established in utils/search-strategy.ts for
 * Genius). Reused for consistency; a combined title+artist score below this
 * is rejected before the duration gate so bad search hits never slip through.
 *
 * DECISION — duration tolerance: ±2 seconds, exactly as specified in
 * design.md Decision 1. LRCLIB itself uses ±2s on /api/get; we mirror that
 * tolerance when locally validating /api/search results.
 *
 * DECISION — ms→s rounding: Math.round(durationMs / 1000). LRCLIB stores
 * duration in seconds as a number (not necessarily integer in the API
 * response), so rounding is the safest conversion.
 */

import { Result, TaggedError } from "better-result";
import {
	type LrclibSearchResponse,
	LrclibSearchResponseSchema,
	type LrclibTrack,
	LrclibTrackSchema,
} from "../types/lrclib.types";
import type { LyricsOutcome } from "../types/lyrics.types";
import { calculateSimilarity } from "../utils/string-similarity";

// ── Error types ──────────────────────────────────────────────────────────────

export class LrclibFetchError extends TaggedError("LrclibFetchError")<{
	url: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(url: string, statusCode?: number) {
		super({
			url,
			statusCode,
			message: `LRCLIB fetch failed${statusCode ? ` (${statusCode})` : ""}`,
		});
	}
}

export class LrclibParseError extends TaggedError("LrclibParseError")<{
	url: string;
	reason: string;
	message: string;
}>() {
	constructor(url: string, reason: string) {
		super({ url, reason, message: `LRCLIB response parse failed: ${reason}` });
	}
}

export type LrclibError = LrclibFetchError | LrclibParseError;

// ── Constants ─────────────────────────────────────────────────────────────────

const LRCLIB_BASE_URL = "https://lrclib.net";

// Identifies the app to LRCLIB per their request (good citizenship, not enforced).
const USER_AGENT = "hearted/1.0 (https://github.com/hearted-app/hearted)";

const REQUEST_TIMEOUT_MS = 15_000;

// Duration tolerance in seconds, mirroring LRCLIB's own matching window (design.md §1).
const DURATION_TOLERANCE_SEC = 2;

// Minimum combined title+artist similarity to accept a /api/search result.
// Mirrors the Genius search floor in utils/search-strategy.ts.
const MIN_SEARCH_SIMILARITY = 0.6;

// ── Helpers ──────────────────────────────────────────────────────────────────

function durationMatches(
	trackDurationSec: number,
	targetDurationSec: number,
): boolean {
	return (
		Math.abs(trackDurationSec - targetDurationSec) <= DURATION_TOLERANCE_SEC
	);
}

/**
 * Scores a candidate track from /api/search against target artist and title.
 * Returns a combined similarity in [0, 1] using the same 55/45 title/artist
 * weighting as the Genius search strategy.
 */
function scoreCandidateTrack(
	candidate: LrclibTrack,
	targetArtist: string,
	targetTitle: string,
): number {
	const titleScore = calculateSimilarity(candidate.trackName, targetTitle);
	const artistScore = calculateSimilarity(candidate.artistName, targetArtist);
	return titleScore * 0.55 + artistScore * 0.45;
}

function trackToLyricsOutcome(track: LrclibTrack): LyricsOutcome {
	if (track.instrumental) {
		return { kind: "instrumental", source: "lrclib" };
	}
	const text = track.plainLyrics ?? "";
	if (!text.trim()) {
		// LRCLIB has the track but no lyrics text and it is not flagged instrumental.
		// Treat as not_found so the caller falls back to Genius.
		return { kind: "not_found" };
	}
	// Confidence 1.0 because /api/get matched on the exact track signature.
	return { kind: "lyrics", text, source: "lrclib", confidence: 1.0 };
}

// ── Provider class ────────────────────────────────────────────────────────────

export interface LrclibLookupParams {
	trackName: string;
	artistName: string;
	albumName: string;
	/** Track duration in milliseconds (from the song row). Converted to seconds internally. */
	durationMs: number;
}

export class LrclibProvider {
	private readonly headers: Record<string, string> = {
		"User-Agent": USER_AGENT,
		Accept: "application/json",
	};

	/**
	 * Attempts to fetch lyrics via LRCLIB.
	 *
	 * Strategy:
	 * 1. Try /api/get with the full track signature (title + artist + album + duration).
	 * 2. On 404 TrackNotFound, try /api/search (title + artist) and locally validate
	 *    the top result by duration (±2s) and similarity (≥ 0.6).
	 * 3. If neither finds a match, returns { kind: "not_found" }.
	 *
	 * Returns an error only on transient network/parse failures, not on 404.
	 */
	async fetchLyrics(
		params: LrclibLookupParams,
	): Promise<Result<LyricsOutcome, LrclibError>> {
		const durationSec = Math.round(params.durationMs / 1000);

		const exactResult = await this.fetchExact(params, durationSec);
		if (Result.isError(exactResult)) {
			return Result.err(exactResult.error);
		}

		if (exactResult.value !== null) {
			return Result.ok(trackToLyricsOutcome(exactResult.value));
		}

		// /api/get returned 404 — try the search fallback
		const searchResult = await this.fetchViaSearch(
			params.trackName,
			params.artistName,
			durationSec,
		);
		if (Result.isError(searchResult)) {
			return Result.err(searchResult.error);
		}

		if (searchResult.value !== null) {
			const outcome = trackToLyricsOutcome(searchResult.value);
			// Search-matched lyrics get a lower confidence than exact-match.
			if (outcome.kind === "lyrics") {
				return Result.ok({ ...outcome, confidence: 0.8 });
			}
			return Result.ok(outcome);
		}

		return Result.ok({ kind: "not_found" });
	}

	/**
	 * Queries /api/get with the full track signature.
	 * Returns null when LRCLIB has no record (404), or the track on success.
	 */
	private async fetchExact(
		params: LrclibLookupParams,
		durationSec: number,
	): Promise<Result<LrclibTrack | null, LrclibError>> {
		const url = new URL(`${LRCLIB_BASE_URL}/api/get`);
		url.searchParams.set("track_name", params.trackName);
		url.searchParams.set("artist_name", params.artistName);
		url.searchParams.set("album_name", params.albumName);
		url.searchParams.set("duration", String(durationSec));

		const urlStr = url.toString();

		return Result.tryPromise({
			try: async () => {
				const res = await fetch(urlStr, {
					headers: this.headers,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});

				if (res.status === 404) {
					// LRCLIB 404 body: { code: 404, name: "TrackNotFound" }
					return null;
				}

				if (!res.ok) {
					throw new LrclibFetchError(urlStr, res.status);
				}

				const raw: unknown = await res.json();
				const parsed = LrclibTrackSchema.safeParse(raw);
				if (!parsed.success) {
					throw new LrclibParseError(
						urlStr,
						parsed.error.issues.map((i) => i.message).join("; "),
					);
				}
				return parsed.data;
			},
			catch: (err) => {
				if (
					err instanceof LrclibFetchError ||
					err instanceof LrclibParseError
				) {
					return err;
				}
				return new LrclibFetchError(urlStr);
			},
		});
	}

	/**
	 * Queries /api/search and picks the best match validated by duration and
	 * name similarity. Returns null if no candidate passes the filters.
	 */
	private async fetchViaSearch(
		trackName: string,
		artistName: string,
		targetDurationSec: number,
	): Promise<Result<LrclibTrack | null, LrclibError>> {
		const url = new URL(`${LRCLIB_BASE_URL}/api/search`);
		url.searchParams.set("track_name", trackName);
		url.searchParams.set("artist_name", artistName);

		const urlStr = url.toString();

		return Result.tryPromise({
			try: async () => {
				const res = await fetch(urlStr, {
					headers: this.headers,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});

				if (!res.ok) {
					throw new LrclibFetchError(urlStr, res.status);
				}

				const raw: unknown = await res.json();
				const parsed = LrclibSearchResponseSchema.safeParse(raw);
				if (!parsed.success) {
					throw new LrclibParseError(
						urlStr,
						parsed.error.issues.map((i) => i.message).join("; "),
					);
				}

				return this.pickBestSearchResult(
					parsed.data,
					trackName,
					artistName,
					targetDurationSec,
				);
			},
			catch: (err) => {
				if (
					err instanceof LrclibFetchError ||
					err instanceof LrclibParseError
				) {
					return err;
				}
				return new LrclibFetchError(urlStr);
			},
		});
	}

	/**
	 * Filters search results by duration tolerance then picks the highest-scoring
	 * candidate by combined title+artist similarity (≥ 0.6 required).
	 */
	private pickBestSearchResult(
		candidates: LrclibSearchResponse,
		trackName: string,
		artistName: string,
		targetDurationSec: number,
	): LrclibTrack | null {
		const durationFiltered = candidates.filter((c) =>
			durationMatches(c.duration, targetDurationSec),
		);

		if (durationFiltered.length === 0) return null;

		let best: LrclibTrack | null = null;
		let bestScore = -1;

		for (const candidate of durationFiltered) {
			const score = scoreCandidateTrack(candidate, artistName, trackName);
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}

		if (best === null || bestScore < MIN_SEARCH_SIMILARITY) return null;
		return best;
	}
}

export function createLrclibProvider(): LrclibProvider {
	return new LrclibProvider();
}
