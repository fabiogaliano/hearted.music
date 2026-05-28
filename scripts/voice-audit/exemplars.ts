// Loads the hand-polished gold Hearted analyses that anchor the pairwise judge.
// Keyed by spotifyTrackId so a stored experiment run matches its gold regardless of
// how its song label is formatted.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SongAnalysisLyricalSchema,
	type SongAnalysisLyrical,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "exemplars");

interface IndexEntry {
	key: string;
	song: string;
	spotifyTrackId: string;
	file: string;
}

export interface GoldExemplar {
	key: string;
	song: string;
	spotifyTrackId: string;
	analysis: SongAnalysisLyrical;
}

export function loadGoldExemplars(): Map<string, GoldExemplar> {
	const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf-8")) as {
		entries: IndexEntry[];
	};
	const out = new Map<string, GoldExemplar>();
	for (const entry of index.entries) {
		const raw = JSON.parse(readFileSync(join(DIR, entry.file), "utf-8"));
		const analysis = SongAnalysisLyricalSchema.parse(raw);
		out.set(entry.spotifyTrackId, {
			key: entry.key,
			song: entry.song,
			spotifyTrackId: entry.spotifyTrackId,
			analysis,
		});
	}
	return out;
}
