/**
 * Minimal LRCLIB plain-text fetch for the eval harness only.
 *
 * Unlike the production provider (providers/lrclib.ts), this does not gate on
 * album/duration — the eval just needs the canonical plain lyrics for a known
 * (artist, track), so it searches by name and keeps the best title/artist match.
 * Responses are cached to disk so re-running the scorer is offline and fast.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	lineSimilarity,
} from "./oracle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".cache");

const USER_AGENT = "hearted-eval/1.0 (https://github.com/hearted-app/hearted)";

interface LrclibSearchHit {
	trackName: string;
	artistName: string;
	plainLyrics: string | null;
	instrumental: boolean;
}

export interface LrclibResult {
	plainLyrics: string | null;
	instrumental: boolean;
	matchedTrack: string;
	matchedArtist: string;
}

function slug(artist: string, track: string): string {
	return `${artist}-${track}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export async function fetchLrclibPlain(
	artist: string,
	track: string,
): Promise<LrclibResult | null> {
	mkdirSync(CACHE_DIR, { recursive: true });
	const cachePath = join(CACHE_DIR, `lrclib-${slug(artist, track)}.json`);
	if (existsSync(cachePath)) {
		return JSON.parse(readFileSync(cachePath, "utf-8")) as LrclibResult;
	}

	const url = new URL("https://lrclib.net/api/search");
	url.searchParams.set("track_name", track);
	url.searchParams.set("artist_name", artist);

	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok) return null;

	const hits = (await res.json()) as LrclibSearchHit[];
	if (!Array.isArray(hits) || hits.length === 0) return null;

	// Pick the hit whose title+artist best matches and that actually has lyrics.
	let best: LrclibSearchHit | null = null;
	let bestScore = -1;
	for (const hit of hits) {
		const score =
			lineSimilarity(hit.trackName, track) * 0.55 +
			lineSimilarity(hit.artistName, artist) * 0.45;
		const usable = hit.instrumental || (hit.plainLyrics?.trim().length ?? 0) > 0;
		if (usable && score > bestScore) {
			bestScore = score;
			best = hit;
		}
	}

	if (!best || bestScore < 0.6) return null;

	const result: LrclibResult = {
		plainLyrics: best.plainLyrics,
		instrumental: best.instrumental,
		matchedTrack: best.trackName,
		matchedArtist: best.artistName,
	};
	writeFileSync(cachePath, JSON.stringify(result, null, "\t"));
	return result;
}
