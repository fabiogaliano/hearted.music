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

function renderExemplarRead(read: ConceptRead): string {
	const arc = read.arc
		.map((beat) => `  - [${beat.label} — ${beat.mood}] ${beat.scene}`)
		.join("\n");
	const lines = read.lines.map((l) => `  - "${l.line}"`).join("\n");
	return [
		`lens: ${read.lens}`,
		`image: ${read.image}`,
		`tension: ${read.tension}`,
		`take: ${read.take}`,
		`contradiction: ${read.contradiction ?? "(none)"}`,
		"arc:",
		arc,
		"lines:",
		lines,
		`texture: ${read.texture ?? "(none)"}`,
	].join("\n");
}

// Pure formatter for the v17 {example} slot. Renders already-selected gold reads into a few-shot
// block. It does NOT select songs, read files, or know prod-vs-eval — the caller owns selection
// (and, in eval, the leave-one-out rule). Empty input → "" so the slot collapses cleanly.
export function renderExemplarBlock(
	examples: Array<Pick<GoldExemplar, "song" | "read">>,
): string {
	if (examples.length === 0) return "";
	const blocks = examples.map(
		(ex, i) => `EXAMPLE ${i + 1} — ${ex.song}\n${renderExemplarRead(ex.read)}`,
	);
	return `WORKED EXAMPLES — finished Hearted reads at the bar you are aiming for. Study their voice and shape, then write a fresh read for the new song in the same voice. They are different songs: do not reuse their words, images, or claims.

${blocks.join("\n\n")}`;
}
