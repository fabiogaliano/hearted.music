// Loads the hand-polished gold Hearted reads that anchor the pairwise judge.
// Keyed by spotifyTrackId so a stored experiment run matches its gold regardless of
// how its song label is formatted.
//
// Migrated Session 5: the gold files now carry the redesigned { read } model
// (ConceptReadSchema). Each file is { read: {...} }; we parse the read sub-object so
// the on-disk shape can later grow a { signals } sibling without touching the loader.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ConceptReadSchema,
	type ConceptRead,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";

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
	read: ConceptRead;
}

export function loadGoldExemplars(): Map<string, GoldExemplar> {
	const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf-8")) as {
		entries: IndexEntry[];
	};
	const out = new Map<string, GoldExemplar>();
	for (const entry of index.entries) {
		const raw = JSON.parse(readFileSync(join(DIR, entry.file), "utf-8")) as {
			read?: unknown;
		};
		const read = ConceptReadSchema.parse(raw.read);
		out.set(entry.spotifyTrackId, {
			key: entry.key,
			song: entry.song,
			spotifyTrackId: entry.spotifyTrackId,
			read,
		});
	}
	return out;
}
