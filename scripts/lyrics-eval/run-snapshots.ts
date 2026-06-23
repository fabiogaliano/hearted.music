#!/usr/bin/env bun
/**
 * Bootstrap eval: grades the fragment→line matcher using the committed Genius
 * snapshots as ground truth and LIVE LRCLIB text (no auth) as the target.
 *
 * The snapshots carry annotations already placed on Genius lines (the anchor
 * ground truth from the still-working local scrape). We use each annotated
 * line's Genius text as a stand-in for its referent `fragment` — faithful
 * enough to exercise the real failure modes (LRCLIB divergence, homoglyphs,
 * ad-libs, repeated lines), since the prod fragment ≈ the rendered line text.
 * The live path (run-live.ts) swaps in the real API fragments.
 *
 *   bun scripts/lyrics-eval/run-snapshots.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLrclibPlain } from "./lrclib";
import { type EvalAnnotation, type EvalSong, formatReport, scoreAll } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Frozen Genius anchor ground truth, relocated here when the live scrape path
// was retired (the production scrape was deleted in the LRCLIB-annotations change).
const SNAPSHOTS_DIR = join(__dirname, "fixtures/snapshots");
const REPORT_DIR = join(__dirname, "../../claudedocs");

interface SnapshotLine {
	id: number;
	text: string;
	annotations?: { text: string }[];
}
interface SnapshotSection {
	type: string;
	lines: SnapshotLine[];
}
interface Snapshot {
	metadata: { artist: string; song: string };
	result: SnapshotSection[];
}

function loadSnapshots(): Snapshot[] {
	return readdirSync(SNAPSHOTS_DIR)
		.filter((f) => f.endsWith(".json") && !f.includes("_"))
		.map((f) => JSON.parse(readFileSync(join(SNAPSHOTS_DIR, f), "utf-8")) as Snapshot);
}

/** Flattens snapshot sections into an ordered Genius line list + annotations. */
function flattenSnapshot(snap: Snapshot): {
	geniusLines: string[];
	annotations: EvalAnnotation[];
} {
	const geniusLines: string[] = [];
	const annotations: EvalAnnotation[] = [];
	let annId = 0;

	for (const section of snap.result) {
		for (const line of section.lines) {
			const subLines = line.text.split("\n");
			const start = geniusLines.length;
			geniusLines.push(...subLines);
			if (line.annotations?.length) {
				for (let k = 0; k < line.annotations.length; k++) {
					annotations.push({
						id: `${section.type}#${line.id}#${annId++}`,
						fragment: line.text,
						geniusLineStart: start,
					});
				}
			}
		}
	}
	return { geniusLines, annotations };
}

async function main() {
	const snapshots = loadSnapshots();
	console.log(`Loaded ${snapshots.length} snapshot songs.\n`);

	const songs: EvalSong[] = [];
	for (const snap of snapshots) {
		const { artist, song } = snap.metadata;
		const key = `${artist} - ${song}`;
		process.stdout.write(`Fetching LRCLIB: ${key} ... `);
		const lrclib = await fetchLrclibPlain(artist, song);
		if (!lrclib || !lrclib.plainLyrics) {
			console.log("MISS (no LRCLIB lyrics) — skipping");
			continue;
		}
		console.log(`ok (${lrclib.matchedArtist} - ${lrclib.matchedTrack})`);

		const { geniusLines, annotations } = flattenSnapshot(snap);
		songs.push({
			key,
			geniusLines,
			lrclibLines: lrclib.plainLyrics.split("\n"),
			annotations,
		});
	}

	console.log("");
	const report = scoreAll(songs);
	const text = formatReport(report);
	console.log(text);

	const outPath = join(REPORT_DIR, "lyrics-eval-snapshots.json");
	writeFileSync(outPath, JSON.stringify(report, null, "\t"));
	console.log(`\nFull per-annotation report → ${outPath}`);
}

main();
