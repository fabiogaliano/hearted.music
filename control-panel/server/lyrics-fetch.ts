/**
 * Inline lyrics fetch for the control panel's lyrics review.
 *
 * The lyrics review queue only ever carried song metadata, so an operator had to
 * leave the panel, hunt lyrics on some other site, and paste them back blind.
 * This module pulls candidate lyrics on demand from LRCLIB — a public, keyless
 * API — so the operator can review and one-click a source into the editor without
 * ever leaving. It returns *several* ranked candidates (not just the single best
 * match the enrichment worker would settle on), because the whole point of a human
 * review is to let the operator pick when the automated match came up empty.
 *
 * Self-contained, like the rest of server/* — no product imports. It mirrors the
 * shape of src/lib/domains/enrichment/lyrics/providers/lrclib.ts but is trimmed to
 * what the review UI needs and takes an injectable fetch so it's unit-testable.
 */

import { read } from "./db";
import { HttpError } from "./http-error";
import { diceSimilarity } from "./similarity";

const LRCLIB_BASE_URL = "https://lrclib.net";
// LRCLIB asks clients to identify themselves (not enforced). Matches the app.
const USER_AGENT =
	"hearted-control-panel/1.0 (+https://github.com/hearted-app/hearted)";
const REQUEST_TIMEOUT_MS = 12_000;
// Enough to give the operator real choice without turning the panel into a wall
// of near-duplicate lyric bodies.
const MAX_CANDIDATES = 6;

export interface LyricsCandidate {
	// LRCLIB track id, kept only so the client can key the list stably.
	id: number | null;
	provider: "lrclib";
	trackName: string;
	artistName: string;
	albumName: string | null;
	durationSeconds: number | null;
	// LRC with [mm:ss.xx] line stamps when LRCLIB has a synced version, else null.
	syncedLyrics: string | null;
	plainLyrics: string | null;
	instrumental: boolean;
	// Combined title+artist name match against the song under review, 0–1.
	similarity: number;
	// |candidate − target| seconds; null when either duration is unknown.
	durationDelta: number | null;
}

export interface LyricsFetchQuery {
	trackName: string;
	artistName: string;
	albumName: string | null;
	durationSeconds: number | null;
}

export interface LyricsFetchResult {
	query: LyricsFetchQuery;
	candidates: LyricsCandidate[];
}

type FetchImpl = typeof fetch;

function scoreName(
	candTitle: string,
	candArtist: string,
	targetTitle: string,
	targetArtist: string,
): number {
	// Same 55/45 title/artist weighting the enrichment search strategy uses.
	return (
		diceSimilarity(candTitle, targetTitle) * 0.55 +
		diceSimilarity(candArtist, targetArtist) * 0.45
	);
}

interface LrclibTrackRaw {
	id?: unknown;
	trackName?: unknown;
	artistName?: unknown;
	albumName?: unknown;
	duration?: unknown;
	instrumental?: unknown;
	plainLyrics?: unknown;
	syncedLyrics?: unknown;
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapCandidate(
	raw: LrclibTrackRaw,
	query: LyricsFetchQuery,
): LyricsCandidate {
	const trackName = str(raw.trackName) ?? "";
	const artistName = str(raw.artistName) ?? "";
	const durationSeconds = num(raw.duration);
	const durationDelta =
		durationSeconds != null && query.durationSeconds != null
			? Math.abs(Math.round(durationSeconds - query.durationSeconds))
			: null;
	return {
		id: num(raw.id),
		provider: "lrclib",
		trackName,
		artistName,
		albumName: str(raw.albumName),
		durationSeconds,
		syncedLyrics: str(raw.syncedLyrics),
		plainLyrics: str(raw.plainLyrics),
		instrumental: raw.instrumental === true,
		similarity: scoreName(
			trackName,
			artistName,
			query.trackName,
			query.artistName,
		),
		durationDelta,
	};
}

/**
 * Rank by name similarity first, then by how close the durations are — a strong
 * duration match is a good tie-breaker between two similarly-named results. Synced
 * lyrics don't win on their own (a wrong synced version is worse than a right plain
 * one) but do break an otherwise exact tie.
 */
function rankCandidates(candidates: LyricsCandidate[]): LyricsCandidate[] {
	return [...candidates].sort((a, b) => {
		if (Math.abs(b.similarity - a.similarity) > 0.02)
			return b.similarity - a.similarity;
		const da = a.durationDelta ?? Number.POSITIVE_INFINITY;
		const db = b.durationDelta ?? Number.POSITIVE_INFINITY;
		if (da !== db) return da - db;
		const sa = a.syncedLyrics ? 0 : 1;
		const sb = b.syncedLyrics ? 0 : 1;
		return sa - sb;
	});
}

/**
 * Query LRCLIB /api/search and return ranked candidates. Pure over `fetchImpl` so
 * tests inject a fake. A 404 or empty result yields an empty candidate list (a
 * normal "nothing found" outcome); only transport/parse failures throw.
 */
export async function fetchLyricsCandidates(
	query: LyricsFetchQuery,
	fetchImpl: FetchImpl = fetch,
): Promise<LyricsFetchResult> {
	if (!query.trackName.trim()) return { query, candidates: [] };

	const url = new URL(`${LRCLIB_BASE_URL}/api/search`);
	url.searchParams.set("track_name", query.trackName);
	if (query.artistName.trim())
		url.searchParams.set("artist_name", query.artistName);
	const urlStr = url.toString();

	let res: Response;
	try {
		res = await fetchImpl(urlStr, {
			headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new HttpError(502, "Couldn't reach LRCLIB. Try again.");
	}

	if (res.status === 404) return { query, candidates: [] };
	if (!res.ok) throw new HttpError(502, `LRCLIB request failed (${res.status}).`);

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		throw new HttpError(502, "LRCLIB returned an unreadable response.");
	}
	if (!Array.isArray(raw)) return { query, candidates: [] };

	const candidates = rankCandidates(
		raw.map((t) => mapCandidate(t as LrclibTrackRaw, query)),
	).slice(0, MAX_CANDIDATES);
	return { query, candidates };
}

/**
 * Resolve the song under review to a search query, then fetch candidates. The
 * primary artist alone searches far better on LRCLIB than a comma-joined list, so
 * the derived query splits it out while overrides let the operator refine a query
 * the metadata got wrong.
 */
export async function lyricsCandidatesForSong(
	songId: string,
	overrides: { track?: string; artist?: string } = {},
	fetchImpl: FetchImpl = fetch,
): Promise<LyricsFetchResult> {
	const rows = await read<{
		name: string | null;
		artist_label: string | null;
		album_name: string | null;
		duration_ms: string | number | null;
	}>(
		`select s.name,
			array_to_string(s.artists, ', ') as artist_label,
			s.album_name, s.duration_ms
		 from public.song s where s.id = $1`,
		[songId],
	);
	const song = rows[0];
	if (!song) throw new HttpError(404, "Song not found.");

	const artistLabel = song.artist_label ?? "";
	const primaryArtist = artistLabel.split(",")[0]?.trim() ?? "";
	const durationMs = song.duration_ms == null ? null : Number(song.duration_ms);

	const query: LyricsFetchQuery = {
		trackName: overrides.track?.trim() || (song.name ?? ""),
		artistName: overrides.artist?.trim() || primaryArtist,
		albumName: song.album_name ?? null,
		durationSeconds: durationMs == null ? null : Math.round(durationMs / 1000),
	};
	return fetchLyricsCandidates(query, fetchImpl);
}
