/**
 * Dev-only helper: fetch plain LRCLIB lyrics for an (artist, title).
 *
 * The production path (LyricsService.fetchAndStoreOutcome) requires album +
 * duration and persists a row; these dev scripts only want the raw lyric text
 * by name. With the Genius scrape removed, LRCLIB is the canonical lyric source,
 * so this searches LRCLIB and returns the best name-matched track's plain text.
 * No duration gating (scripts rarely have it), no Genius, no annotations.
 */

import { calculateSimilarity } from "@/lib/domains/enrichment/lyrics/utils/string-similarity";

const USER_AGENT = "hearted-dev/1.0 (https://github.com/hearted-app/hearted)";

interface LrclibSearchHit {
	trackName: string;
	artistName: string;
	plainLyrics: string | null;
}

export async function fetchLrclibPlainLyrics(
	artist: string,
	title: string,
): Promise<string | null> {
	const url = new URL("https://lrclib.net/api/search");
	url.searchParams.set("track_name", title);
	url.searchParams.set("artist_name", artist);

	let res: Response;
	try {
		res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	} catch {
		return null;
	}
	if (!res.ok) return null;

	const hits = (await res.json()) as LrclibSearchHit[];
	if (!Array.isArray(hits) || hits.length === 0) return null;

	let best: LrclibSearchHit | null = null;
	let bestScore = -1;
	for (const hit of hits) {
		if (!hit.plainLyrics?.trim()) continue;
		const score =
			calculateSimilarity(hit.trackName, title) * 0.55 +
			calculateSimilarity(hit.artistName, artist) * 0.45;
		if (score > bestScore) {
			bestScore = score;
			best = hit;
		}
	}

	if (!best || bestScore < 0.6) return null;
	return best.plainLyrics;
}
