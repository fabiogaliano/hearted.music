/**
 * Scorer for the annotation-placement eval.
 *
 * Given, per song, the Genius line sequence, the LRCLIB line sequence, and the
 * annotations (each with the Genius line it anchors to + the fragment text we
 * feed the matcher), this:
 *   1. builds ground truth by aligning Genius↔LRCLIB lines with the oracle;
 *   2. runs the production matcher (bestFragmentMatch) per annotation;
 *   3. classifies each annotation at a sweep of confidence floors and reports
 *      precision / recall / placement-rate so the floor can be chosen from data.
 *
 * Correctness is judged oracle-independently: a placement is CORRECT when the
 * LRCLIB line the matcher chose is the same lyric as the Genius line the anchor
 * ground truth says the annotation belongs to (containmentSimilarity ≥ floor).
 * Containment is length-lenient, so it credits sub-phrase referents and lines
 * that one source split and the other merged — the cases a global line-index
 * oracle mis-grades. "Has an LRCLIB home" is likewise a scan for any LRCLIB line
 * matching the annotated Genius line, so repeated lines and split lines count.
 *
 * Classification at a given floor, per annotation:
 *   placed     = matcher returned a span scoring ≥ floor
 *   correct    = placed AND matched line ≈ annotated Genius line
 *   misplaced  = placed AND it does not
 *   missed     = NOT placed AND an LRCLIB home exists  (a real annotation dropped)
 *   legit-drop = NOT placed AND no LRCLIB home exists  (correctly dropped)
 */

import {
	bestFragmentMatch,
	buildLrclibStream,
} from "@/lib/domains/enrichment/lyrics/utils/annotation-matcher";
import { containmentSimilarity } from "./oracle";

// A matched LRCLIB line counts as the same lyric as the annotated Genius line at
// or above this containment similarity.
const SAME_LYRIC_FLOOR = 0.8;

export interface EvalAnnotation {
	id: string;
	fragment: string;
	/** Index into the song's geniusLines where this annotation's referent starts. */
	geniusLineStart: number;
	/** Referent flagged as the song description, not a lyric line — excluded. */
	isDescription?: boolean;
}

export interface EvalSong {
	key: string;
	geniusLines: string[];
	lrclibLines: string[];
	annotations: EvalAnnotation[];
}

const THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

interface PerAnnotationResult {
	id: string;
	fragment: string;
	score: number;
	matchedStart: number | null;
	matchedEnd: number | null;
	/** The LRCLIB span text the matcher chose. */
	matchedText: string | null;
	/** The Genius line the anchors say this annotation belongs to. */
	annotatedGeniusLine: string;
	/** containmentSimilarity(matchedText, annotatedGeniusLine), 0 if unplaced. */
	sameLyric: number;
	/** Whether any LRCLIB line matches the annotated Genius line. */
	hasHome: boolean;
}

interface Tally {
	threshold: number;
	correct: number;
	misplaced: number;
	missed: number;
	legitDrop: number;
}

export interface SongReport {
	key: string;
	geniusLineCount: number;
	lrclibLineCount: number;
	annotationCount: number; // lyric annotations considered (excludes descriptions)
	withGroundTruth: number; // annotations with a matching LRCLIB home line
	perThreshold: Tally[];
	results: PerAnnotationResult[];
}

function evaluateSong(song: EvalSong): SongReport {
	const stream = buildLrclibStream(song.lrclibLines);
	const annotations = song.annotations.filter((a) => !a.isDescription);

	const results: PerAnnotationResult[] = annotations.map((a) => {
		const match = bestFragmentMatch(a.fragment, stream);
		const annotatedGeniusLine = song.geniusLines[a.geniusLineStart] ?? "";
		const matchedText =
			match === null
				? null
				: song.lrclibLines.slice(match.startLine, match.endLine + 1).join(" ");
		const sameLyric =
			matchedText === null
				? 0
				: containmentSimilarity(matchedText, annotatedGeniusLine);
		// A home exists if any LRCLIB line is the same lyric as the annotated line.
		const hasHome = song.lrclibLines.some(
			(l) => containmentSimilarity(l, annotatedGeniusLine) >= SAME_LYRIC_FLOOR,
		);
		return {
			id: a.id,
			fragment: a.fragment,
			score: match?.score ?? 0,
			matchedStart: match?.startLine ?? null,
			matchedEnd: match?.endLine ?? null,
			matchedText,
			annotatedGeniusLine,
			sameLyric,
			hasHome,
		};
	});

	const withGroundTruth = results.filter((r) => r.hasHome).length;

	const perThreshold = THRESHOLDS.map((threshold) => {
		const tally: Tally = {
			threshold,
			correct: 0,
			misplaced: 0,
			missed: 0,
			legitDrop: 0,
		};
		for (const r of results) {
			const placed = r.matchedStart !== null && r.score >= threshold;
			if (placed) {
				if (r.sameLyric >= SAME_LYRIC_FLOOR) tally.correct++;
				else tally.misplaced++;
			} else {
				if (r.hasHome) tally.missed++;
				else tally.legitDrop++;
			}
		}
		return tally;
	});

	return {
		key: song.key,
		geniusLineCount: song.geniusLines.length,
		lrclibLineCount: song.lrclibLines.length,
		annotationCount: annotations.length,
		withGroundTruth,
		perThreshold,
		results,
	};
}

export interface AggregateReport {
	songs: SongReport[];
	sweep: {
		threshold: number;
		precision: number;
		recall: number;
		placementRate: number;
		correct: number;
		misplaced: number;
		missed: number;
		legitDrop: number;
	}[];
}

export function scoreAll(songs: EvalSong[]): AggregateReport {
	const reports = songs.map(evaluateSong);

	// Constant across thresholds: annotations that genuinely have an LRCLIB home
	// (recall denominator) and the total considered (placement-rate denominator).
	const totalWithGt = reports.reduce((acc, s) => acc + s.withGroundTruth, 0);
	const totalAnnotations = reports.reduce(
		(acc, s) => acc + s.annotationCount,
		0,
	);

	const sweep = THRESHOLDS.map((threshold) => {
		let correct = 0;
		let misplaced = 0;
		let missed = 0;
		let legitDrop = 0;
		for (const song of reports) {
			const t = song.perThreshold.find((x) => x.threshold === threshold);
			if (!t) continue;
			correct += t.correct;
			misplaced += t.misplaced;
			missed += t.missed;
			legitDrop += t.legitDrop;
		}
		const placements = correct + misplaced;
		return {
			threshold,
			// precision = of what we placed, how much landed on a correct line
			precision: placements === 0 ? 1 : correct / placements,
			// recall = of annotations with a real LRCLIB home, how many we placed
			// correctly. Clamped: a multi-line matched span can be "correct" without
			// any single LRCLIB line counting as that annotation's home.
			recall: totalWithGt === 0 ? 1 : Math.min(1, correct / totalWithGt),
			placementRate:
				totalAnnotations === 0 ? 0 : placements / totalAnnotations,
			correct,
			misplaced,
			missed,
			legitDrop,
		};
	});

	return { songs: reports, sweep };
}

export function formatReport(report: AggregateReport): string {
	const lines: string[] = [];
	lines.push("=".repeat(72));
	lines.push("ANNOTATION-PLACEMENT EVAL");
	lines.push("=".repeat(72));
	lines.push("");

	// Per-song summary at a representative floor (0.8).
	lines.push("Per-song (annotations / with-LRCLIB-home / lines):");
	for (const s of report.songs) {
		lines.push(
			`  ${s.key.padEnd(40)} ${String(s.annotationCount).padStart(3)} ann  ${String(
				s.withGroundTruth,
			).padStart(3)} home  ${s.geniusLineCount}g/${s.lrclibLineCount}l`,
		);
	}
	lines.push("");

	lines.push("Threshold sweep (aggregate):");
	lines.push(
		"  floor  precision  recall  place%   correct  misplaced  missed  legitDrop",
	);
	for (const row of report.sweep) {
		lines.push(
			`  ${row.threshold.toFixed(2)}   ${(row.precision * 100)
				.toFixed(1)
				.padStart(7)}%  ${(row.recall * 100).toFixed(1).padStart(5)}%  ${(
				row.placementRate * 100
			)
				.toFixed(0)
				.padStart(4)}%   ${String(row.correct).padStart(6)}  ${String(
				row.misplaced,
			).padStart(8)}  ${String(row.missed).padStart(6)}  ${String(
				row.legitDrop,
			).padStart(8)}`,
		);
	}
	lines.push("");
	lines.push(
		"precision = placed-on-correct-line / all-placed; recall = correct / annotations-with-LRCLIB-home",
	);
	return lines.join("\n");
}
