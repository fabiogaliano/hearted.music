#!/usr/bin/env bun
/**
 * Characterizes the failure tail of a saved eval report at a chosen floor:
 * which annotations are misplaced (placed but landed on the wrong lyric) and
 * which are missed (a real LRCLIB home exists but the matcher dropped them).
 *
 *   bun scripts/lyrics-eval/analyze-tail.ts [reportFile] [floor]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { containmentSimilarity } from "./oracle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportFile = process.argv[2] ?? "claudedocs/lyrics-eval-live.json";
const floor = Number(process.argv[3] ?? "0.75");

interface Result {
	fragment: string;
	score: number;
	matchedText: string | null;
	annotatedGeniusLine: string;
	sameLyric: number;
	hasHome: boolean;
}
interface Report {
	songs: { key: string; results: Result[] }[];
}

const report = JSON.parse(
	readFileSync(join(__dirname, "../../", reportFile), "utf-8"),
) as Report;

const trunc = (s: string, n = 60) =>
	s.replace(/\n/g, " / ").slice(0, n).padEnd(Math.min(n, s.length));

let misplaced = 0;
let missed = 0;
// Of the misplaced, how many actually contain the referent fragment? Those are
// grader noise (the matcher found the right lyric; the anchor ground truth, not
// the matcher, is wrong). The rest are genuinely wrong placements.
let graderNoise = 0;
let genuinelyWrong = 0;

for (const song of report.songs) {
	const bad = song.results.filter((r) => {
		const placed = r.matchedText !== null && r.score >= floor;
		if (placed) return r.sameLyric < 0.8;
		return r.hasHome; // missed
	});
	if (bad.length === 0) continue;
	console.log(`\n### ${song.key}`);
	for (const r of bad) {
		const placed = r.matchedText !== null && r.score >= floor;
		if (placed) {
			misplaced++;
			const fragInMatched = containmentSimilarity(
				r.matchedText ?? "",
				r.fragment,
			);
			const noise = fragInMatched >= 0.8;
			if (noise) graderNoise++;
			else genuinelyWrong++;
			console.log(
				`  MISPLACED ${noise ? "[matcher-correct/anchor-noise]" : "[GENUINE]"} score=${r.score.toFixed(2)} sameLyric=${r.sameLyric.toFixed(2)} frag⊂matched=${fragInMatched.toFixed(2)}`,
			);
			console.log(`     fragment : ${trunc(r.fragment)}`);
			console.log(`     genius   : ${trunc(r.annotatedGeniusLine)}`);
			console.log(`     matched  : ${trunc(r.matchedText ?? "")}`);
		} else {
			missed++;
			console.log(`  MISSED score=${r.score.toFixed(2)} (home exists)`);
			console.log(`     fragment : ${trunc(r.fragment)}`);
			console.log(`     genius   : ${trunc(r.annotatedGeniusLine)}`);
		}
	}
}

console.log(
	`\n=== floor ${floor}: ${misplaced} misplaced (${graderNoise} matcher-correct/anchor-noise, ${genuinelyWrong} genuinely wrong), ${missed} missed ===`,
);
