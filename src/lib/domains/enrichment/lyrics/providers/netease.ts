/**
 * NetEase Cloud Music lyrics provider — last-resort fallback for LRCLIB.
 *
 * Wired into LyricsService.resolveOutcome and consulted ONLY when LRCLIB fails
 * transiently (network/5xx after retries). LRCLIB's own not_found/instrumental
 * verdicts are authoritative and never reach here. NetEase reaches a different
 * catalog (good long-tail coverage) on independent infrastructure, so it covers
 * LRCLIB outages without trusting an unofficial endpoint for the common path.
 *
 * The two endpoints (`/api/search/get`, `/api/song/lyric`) are undocumented
 * app-internal routes — they can change or rate-limit without notice, which is
 * exactly why this lives behind a swappable provider with its own error type.
 *
 * DECISION — confidence 0.7 for every hit: lower than LRCLIB's exact (1.0) and
 * search (0.8) matches. NetEase is keyless and unvalidated by album, so its
 * results are inherently less trustworthy; the lower score reflects that.
 *
 * DECISION — validation mirrors LRCLIB's /api/search fallback: duration ±2s and
 * a combined title+artist similarity floor of 0.6. NetEase search has no album
 * gate, so this local validation is the only guard against attaching the wrong
 * song.
 */

import { Result, TaggedError } from "better-result";
import type { LyricsOutcome } from "../types/lyrics.types";
import {
	NeteaseLyricResponseSchema,
	NeteaseSearchResponseSchema,
	type NeteaseSong,
} from "../types/netease.types";
import { calculateSimilarity } from "../utils/string-similarity";

// ── Error types ──────────────────────────────────────────────────────────────

export class NeteaseFetchError extends TaggedError("NeteaseFetchError")<{
	url: string;
	/** HTTP status, when the failure was at the transport layer. */
	statusCode?: number;
	/** NetEase top-level `code` when the body returned a non-200 app-level error. */
	apiCode?: number;
	message: string;
}>() {
	constructor(url: string, opts?: { statusCode?: number; apiCode?: number }) {
		const httpPart =
			opts?.statusCode !== undefined ? ` (HTTP ${opts.statusCode})` : "";
		const apiPart =
			opts?.apiCode !== undefined ? ` (code ${opts.apiCode})` : "";
		super({
			url,
			statusCode: opts?.statusCode,
			apiCode: opts?.apiCode,
			message: `NetEase fetch failed${httpPart}${apiPart}`,
		});
	}
}

export class NeteaseParseError extends TaggedError("NeteaseParseError")<{
	url: string;
	reason: string;
	message: string;
}>() {
	constructor(url: string, reason: string) {
		super({ url, reason, message: `NetEase response parse failed: ${reason}` });
	}
}

export type NeteaseError = NeteaseFetchError | NeteaseParseError;

// ── Constants ─────────────────────────────────────────────────────────────────

const NETEASE_BASE_URL = "https://music.163.com";

// NetEase's search/lyric routes reject some clients without a browser-like
// User-Agent and a music.163.com Referer; both are required for reliable 200s.
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15_000;

// Number of search hits to validate. NetEase orders by relevance, so the right
// track is near the top; 10 gives the duration/similarity gate room to skip
// remixes and covers without paging.
const SEARCH_LIMIT = 10;

// Mirrors LRCLIB's matching window and the Genius search floor (utils).
const DURATION_TOLERANCE_SEC = 2;
const MIN_SEARCH_SIMILARITY = 0.6;

// 200 is the only success code; everything else (e.g. -460 "Cheating" for an
// abroad/IP block) is an app-level error.
const NETEASE_OK_CODE = 200;

// Every hit gets the same lowered confidence — see the DECISION note in the header.
const NETEASE_CONFIDENCE = 0.7;

// NetEase returns this exact sentinel as the lyric body for pure-music tracks.
const INSTRUMENTAL_MARKER = "纯音乐，请欣赏";

// NetEase prepends songwriting credits as pseudo-lyric lines — 作词 (lyricist),
// 作曲 (composer), 编曲 (arranger), 制作人 (producer), and their English
// equivalents — each shaped "<role> : <name>". We drop them so only sung lines
// remain in the plain-text output.
const CREDIT_LINE =
	/^\s*(作词|作曲|编曲|制作人|出品人?|监制|统筹|和声|混音|母带|后期|录音|配唱制作人|配唱|吉他|贝斯|鼓|弦乐|键盘|提琴|Produced\s+by|Producer|Written\s+by|Writer|Composed\s+by|Composer|Lyrics?|Lyricist|Arranged\s+by|Arranger|Mixing|Mixed\s+by|Mastering|Mastered\s+by|Recorded\s+by|Recording|Engineer)\s*[:：]/i;

// LRC timing tags ([mm:ss.xxx], possibly several per line) and ID tags
// ([ti:...], [ar:...], etc.) that prefix the lyric text.
const LRC_TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
const LRC_ID_TAG = /\[[a-z]+:[^\]]*\]/gi;

// ── Helpers ──────────────────────────────────────────────────────────────────

function durationMatches(
	trackDurationSec: number,
	targetDurationSec: number,
): boolean {
	return (
		Math.abs(trackDurationSec - targetDurationSec) <= DURATION_TOLERANCE_SEC
	);
}

function artistNamesOf(song: NeteaseSong): string {
	return song.artists.map((a) => a.name).join(" ");
}

/**
 * Combined title+artist similarity in [0, 1], using the same 55/45 weighting as
 * the LRCLIB and Genius search strategies.
 */
function scoreCandidate(
	candidate: NeteaseSong,
	targetArtist: string,
	targetTitle: string,
): number {
	const titleScore = calculateSimilarity(candidate.name, targetTitle);
	const artistScore = calculateSimilarity(
		artistNamesOf(candidate),
		targetArtist,
	);
	return titleScore * 0.55 + artistScore * 0.45;
}

/**
 * Parsed shape of a NetEase lyric body, before mapping to a LyricsOutcome.
 *  - instrumental: the pure-music sentinel was present
 *  - lyrics:       real sung lines remain after stripping credits/timing tags
 *  - empty:        nothing usable (uncollected track, or only credits)
 */
type ParsedLyric =
	| { kind: "instrumental" }
	| { kind: "lyrics"; text: string }
	| { kind: "empty" };

export function parseNeteaseLyric(
	rawLrc: string | null | undefined,
): ParsedLyric {
	if (!rawLrc) return { kind: "empty" };

	const lines = rawLrc
		.split("\n")
		.map((line) =>
			line.replace(LRC_TIME_TAG, "").replace(LRC_ID_TAG, "").trim(),
		)
		.filter((line) => line.length > 0);

	// The sentinel is authoritative for instrumental, even alongside credit lines.
	if (lines.some((line) => line.includes(INSTRUMENTAL_MARKER))) {
		return { kind: "instrumental" };
	}

	const lyricLines = lines.filter((line) => !CREDIT_LINE.test(line));
	if (lyricLines.length === 0) return { kind: "empty" };

	return { kind: "lyrics", text: lyricLines.join("\n") };
}

// ── Provider class ────────────────────────────────────────────────────────────

export interface NeteaseLookupParams {
	trackName: string;
	artistName: string;
	/** Track duration in milliseconds. Converted to seconds for the ±2s match. */
	durationMs: number;
}

export class NeteaseProvider {
	private readonly headers: Record<string, string> = {
		"User-Agent": USER_AGENT,
		Referer: `${NETEASE_BASE_URL}/`,
		Accept: "application/json",
	};

	/**
	 * Resolves lyrics for a track via NetEase.
	 *
	 * 1. Search `/api/search/get` for "<artist> <title>"; locally validate the
	 *    best hit by duration (±2s) and name similarity (≥ 0.6).
	 * 2. Fetch `/api/song/lyric` for the chosen id; classify the body as
	 *    instrumental (sentinel), lyrics (after stripping credits/timing), or
	 *    not_found (uncollected / empty).
	 *
	 * Returns an error only on transport/app-level failures — a clean miss is
	 * { kind: "not_found" }, not an error.
	 */
	async fetchLyrics(
		params: NeteaseLookupParams,
	): Promise<Result<LyricsOutcome, NeteaseError>> {
		const durationSec = Math.round(params.durationMs / 1000);

		const songResult = await this.search(
			params.trackName,
			params.artistName,
			durationSec,
		);
		if (Result.isError(songResult)) return Result.err(songResult.error);

		const song = songResult.value;
		if (song === null) return Result.ok({ kind: "not_found" });

		const lyricResult = await this.fetchLyric(song.id);
		if (Result.isError(lyricResult)) return Result.err(lyricResult.error);

		const parsed = lyricResult.value;
		if (parsed.kind === "instrumental") {
			return Result.ok({ kind: "instrumental", source: "netease" });
		}
		if (parsed.kind === "empty") {
			return Result.ok({ kind: "not_found" });
		}
		return Result.ok({
			kind: "lyrics",
			text: parsed.text,
			source: "netease",
			confidence: NETEASE_CONFIDENCE,
		});
	}

	/**
	 * Queries `/api/search/get` and returns the best validated hit, or null when
	 * no candidate passes the duration + similarity gate.
	 */
	private async search(
		trackName: string,
		artistName: string,
		targetDurationSec: number,
	): Promise<Result<NeteaseSong | null, NeteaseError>> {
		const url = new URL(`${NETEASE_BASE_URL}/api/search/get`);
		url.searchParams.set("s", `${artistName} ${trackName}`);
		url.searchParams.set("type", "1");
		url.searchParams.set("limit", String(SEARCH_LIMIT));
		const urlStr = url.toString();

		return Result.tryPromise({
			try: async () => {
				const res = await fetch(urlStr, {
					headers: this.headers,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (!res.ok) {
					throw new NeteaseFetchError(urlStr, { statusCode: res.status });
				}

				const raw: unknown = await res.json();
				const parsed = NeteaseSearchResponseSchema.safeParse(raw);
				if (!parsed.success) {
					throw new NeteaseParseError(
						urlStr,
						parsed.error.issues.map((i) => i.message).join("; "),
					);
				}
				if (parsed.data.code !== NETEASE_OK_CODE) {
					throw new NeteaseFetchError(urlStr, { apiCode: parsed.data.code });
				}

				const songs = parsed.data.result?.songs ?? [];
				return this.pickBestSong(
					songs,
					trackName,
					artistName,
					targetDurationSec,
				);
			},
			catch: (err) => toNeteaseError(err, urlStr),
		});
	}

	/**
	 * Filters search hits by duration tolerance, then returns the highest-scoring
	 * candidate by combined title+artist similarity (≥ 0.6 required).
	 */
	private pickBestSong(
		songs: NeteaseSong[],
		trackName: string,
		artistName: string,
		targetDurationSec: number,
	): NeteaseSong | null {
		const durationFiltered = songs.filter((s) =>
			durationMatches(Math.round(s.duration / 1000), targetDurationSec),
		);
		if (durationFiltered.length === 0) return null;

		let best: NeteaseSong | null = null;
		let bestScore = -1;
		for (const candidate of durationFiltered) {
			const score = scoreCandidate(candidate, artistName, trackName);
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}

		if (best === null || bestScore < MIN_SEARCH_SIMILARITY) return null;
		return best;
	}

	/** Fetches and classifies `/api/song/lyric` for a song id. */
	private async fetchLyric(
		songId: number,
	): Promise<Result<ParsedLyric, NeteaseError>> {
		const url = new URL(`${NETEASE_BASE_URL}/api/song/lyric`);
		url.searchParams.set("os", "osx");
		url.searchParams.set("id", String(songId));
		// lv/kv/tv = -1 requests the original, karaoke, and translated lyric
		// versions; we only read the original (lrc.lyric).
		url.searchParams.set("lv", "-1");
		url.searchParams.set("kv", "-1");
		url.searchParams.set("tv", "-1");
		const urlStr = url.toString();

		return Result.tryPromise({
			try: async () => {
				const res = await fetch(urlStr, {
					headers: this.headers,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (!res.ok) {
					throw new NeteaseFetchError(urlStr, { statusCode: res.status });
				}

				const raw: unknown = await res.json();
				const parsed = NeteaseLyricResponseSchema.safeParse(raw);
				if (!parsed.success) {
					throw new NeteaseParseError(
						urlStr,
						parsed.error.issues.map((i) => i.message).join("; "),
					);
				}
				if (parsed.data.code !== NETEASE_OK_CODE) {
					throw new NeteaseFetchError(urlStr, { apiCode: parsed.data.code });
				}

				// `uncollected`/`nolyric` are explicit verdicts; honor them before
				// falling back to inspecting the lyric body.
				if (parsed.data.uncollected === true) return { kind: "empty" as const };
				if (parsed.data.nolyric === true)
					return { kind: "instrumental" as const };

				return parseNeteaseLyric(parsed.data.lrc?.lyric);
			},
			catch: (err) => toNeteaseError(err, urlStr),
		});
	}
}

function toNeteaseError(err: unknown, url: string): NeteaseError {
	if (err instanceof NeteaseFetchError || err instanceof NeteaseParseError) {
		return err;
	}
	return new NeteaseFetchError(url);
}

export function createNeteaseProvider(): NeteaseProvider {
	return new NeteaseProvider();
}
