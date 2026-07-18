/**
 * External release-year candidates for the album-grouped review queue.
 *
 * All 5,879 songs in the unresolved bucket were never auto-looked-up (they sit
 * outside the extension's liked-song path), and the app's Spotify API app is
 * blocked by the 2025 dev-mode policy (owner needs Premium), so the panel asks
 * public, keyless catalogs instead: iTunes Search first (best coverage in a
 * single request), Deezer as a fallback (its search response omits the release
 * date, so a hit costs a second per-album request — that's why it's not primary).
 *
 * Results are ranked with the same bigram similarity the lyrics finder uses and
 * cached permanently in the local store by the caller (see release-year-groups):
 * a released album's year never changes, and iTunes throttles hard (~20 req/min),
 * so every album should be paid for at most once.
 *
 * Self-contained, like the rest of server/* — injectable fetch for tests.
 */

import { HttpError } from "./http-error";
import { diceSimilarity } from "./similarity";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES = 4;
// Below this the "match" is usually a different record entirely; the operator
// still sees it (flagged low), but it never wins prefill on its own.
export const CONFIDENT_SIMILARITY = 0.65;

export interface YearCandidate {
	source: "itunes" | "deezer";
	year: number;
	// Full date when the source has one (iTunes gives ISO timestamps, Deezer
	// YYYY-MM-DD); kept for operator context, only the year is ever written.
	releaseDate: string | null;
	albumName: string;
	artistName: string;
	// Combined album+artist name match against the group under review, 0–1.
	similarity: number;
}

export interface YearFetchQuery {
	albumName: string;
	artistName: string;
}

type FetchImpl = typeof fetch;

function score(query: YearFetchQuery, albumName: string, artistName: string): number {
	// Compilations query with no artist at all (no single artist is right); the
	// album name then carries full weight instead of an unfillable artist term.
	if (!query.artistName.trim()) return diceSimilarity(albumName, query.albumName);
	// Album name dominates: compilations often list a different artist per track,
	// so a strong album match with a weak artist match is still usually right.
	return (
		diceSimilarity(albumName, query.albumName) * 0.6 +
		diceSimilarity(artistName, query.artistName) * 0.4
	);
}

function yearFromDate(value: unknown): { year: number; date: string } | null {
	if (typeof value !== "string") return null;
	const match = value.match(/^(\d{4})/);
	if (!match) return null;
	const year = Number(match[1]);
	// Sources use 0000/0001 placeholders for "unknown"; those are not answers.
	if (year < 1900) return null;
	return { year, date: value };
}

async function fetchJson(
	url: string,
	fetchImpl: FetchImpl,
	sourceLabel: string,
): Promise<unknown> {
	let res: Response;
	try {
		res = await fetchImpl(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new HttpError(502, `Couldn't reach ${sourceLabel}. Try again.`);
	}
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new HttpError(502, `${sourceLabel} request failed (${res.status}).`);
	}
	try {
		return await res.json();
	} catch {
		throw new HttpError(502, `${sourceLabel} returned an unreadable response.`);
	}
}

interface ItunesAlbumRaw {
	collectionName?: unknown;
	artistName?: unknown;
	releaseDate?: unknown;
}

async function itunesCandidates(
	query: YearFetchQuery,
	fetchImpl: FetchImpl,
): Promise<YearCandidate[]> {
	const url = new URL("https://itunes.apple.com/search");
	url.searchParams.set("term", `${query.artistName} ${query.albumName}`.trim());
	url.searchParams.set("entity", "album");
	url.searchParams.set("limit", "5");
	const raw = await fetchJson(url.toString(), fetchImpl, "iTunes");
	const results =
		raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)
			? ((raw as { results: unknown[] }).results as ItunesAlbumRaw[])
			: [];
	const candidates: YearCandidate[] = [];
	for (const r of results) {
		const parsed = yearFromDate(r.releaseDate);
		if (!parsed) continue;
		const albumName = typeof r.collectionName === "string" ? r.collectionName : "";
		const artistName = typeof r.artistName === "string" ? r.artistName : "";
		candidates.push({
			source: "itunes",
			year: parsed.year,
			releaseDate: parsed.date,
			albumName,
			artistName,
			similarity: score(query, albumName, artistName),
		});
	}
	return candidates;
}

interface DeezerAlbumRaw {
	id?: unknown;
	title?: unknown;
	artist?: { name?: unknown };
}

async function deezerCandidate(
	query: YearFetchQuery,
	fetchImpl: FetchImpl,
): Promise<YearCandidate | null> {
	const searchUrl = new URL("https://api.deezer.com/search/album");
	searchUrl.searchParams.set("q", `${query.artistName} ${query.albumName}`.trim());
	const raw = await fetchJson(searchUrl.toString(), fetchImpl, "Deezer");
	const results =
		raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
			? ((raw as { data: unknown[] }).data as DeezerAlbumRaw[])
			: [];

	// Deezer's search response has no release date, so a candidate costs a second
	// per-album request — only pay it for the single best plausible match.
	let best: { id: number; title: string; artist: string; similarity: number } | null =
		null;
	for (const r of results) {
		if (typeof r.id !== "number") continue;
		const title = typeof r.title === "string" ? r.title : "";
		const artist = typeof r.artist?.name === "string" ? String(r.artist.name) : "";
		const similarity = score(query, title, artist);
		if (!best || similarity > best.similarity) {
			best = { id: r.id, title, artist, similarity };
		}
	}
	if (!best || best.similarity < CONFIDENT_SIMILARITY) return null;

	const detail = await fetchJson(
		`https://api.deezer.com/album/${best.id}`,
		fetchImpl,
		"Deezer",
	);
	const parsed = yearFromDate(
		detail && typeof detail === "object"
			? (detail as { release_date?: unknown }).release_date
			: null,
	);
	if (!parsed) return null;
	return {
		source: "deezer",
		year: parsed.year,
		releaseDate: parsed.date,
		albumName: best.title,
		artistName: best.artist,
		similarity: best.similarity,
	};
}

/**
 * Ranked year candidates for one album group. iTunes answers alone when it has
 * a confident match; Deezer is consulted only when it doesn't, so the common
 * case costs exactly one external request.
 */
export async function fetchYearCandidates(
	query: YearFetchQuery,
	fetchImpl: FetchImpl = fetch,
): Promise<YearCandidate[]> {
	if (!query.albumName.trim() && !query.artistName.trim()) return [];

	const fromItunes = await itunesCandidates(query, fetchImpl);
	const hasConfident = fromItunes.some(
		(c) => c.similarity >= CONFIDENT_SIMILARITY,
	);
	const candidates = [...fromItunes];
	if (!hasConfident) {
		try {
			const fallback = await deezerCandidate(query, fetchImpl);
			if (fallback) candidates.push(fallback);
		} catch {
			// Deezer is best-effort garnish; an outage shouldn't hide iTunes results.
		}
	}
	return candidates
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, MAX_CANDIDATES);
}
