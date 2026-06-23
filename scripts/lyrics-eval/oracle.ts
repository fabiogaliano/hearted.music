/**
 * Ground-truth oracle for the annotation-placement eval.
 *
 * Globally aligns the Genius line sequence to the LRCLIB line sequence with a
 * monotonic Needleman–Wunsch DP, returning, for each Genius line, the LRCLIB
 * line it corresponds to (or null when LRCLIB has no equivalent).
 *
 * This is deliberately a *stronger* matcher than the production one: it sees
 * both full transcriptions at once and aligns by position, so it disambiguates
 * repeated chorus lines that a local substring matcher fundamentally cannot.
 * That asymmetry is the point — the oracle is allowed to be the answer key
 * precisely because it uses information prod never has.
 */

import {
	normalizeLyricText,
	tokenizeLyricText,
} from "@/lib/domains/enrichment/lyrics/utils/annotation-matcher";

// A diagonal step only counts as a correspondence above this line similarity,
// so unrelated lines forced together by the DP are not treated as ground truth.
const ALIGN_SIM_FLOOR = 0.6;

/** Token-level Levenshtein similarity between two lyric lines, in [0,1]. */
export function lineSimilarity(a: string, b: string): number {
	const ta = tokenizeLyricText(a);
	const tb = tokenizeLyricText(b);
	if (ta.length === 0 && tb.length === 0) return 1;
	if (ta.length === 0 || tb.length === 0) return 0;

	const m = ta.length;
	const n = tb.length;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	let cur = new Array<number>(n + 1);
	for (let i = 1; i <= m; i++) {
		cur[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = ta[i - 1] === tb[j - 1] ? 0 : 1;
			cur[j] = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1);
		}
		[prev, cur] = [cur, prev];
	}
	return 1 - prev[n] / Math.max(m, n);
}

/**
 * Returns geniusLineIndex → lrclibLineIndex for every Genius line that aligns to
 * an LRCLIB line at similarity ≥ ALIGN_SIM_FLOOR. Unaligned Genius lines are
 * absent from the map (their ground-truth LRCLIB line is "none").
 */
export function alignLines(
	geniusLines: string[],
	lrclibLines: string[],
): Map<number, number> {
	const m = geniusLines.length;
	const n = lrclibLines.length;

	// Precompute pairwise similarity (m,n are tens of lines — cheap).
	const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
	for (let i = 0; i < m; i++) {
		for (let j = 0; j < n; j++) {
			sim[i][j] = lineSimilarity(geniusLines[i], lrclibLines[j]);
		}
	}

	// H[i][j] = best alignment score of first i genius lines vs first j lrclib lines.
	const H: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0),
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			H[i][j] = Math.max(
				H[i - 1][j - 1] + sim[i - 1][j - 1], // align this pair
				H[i - 1][j], // skip genius line
				H[i][j - 1], // skip lrclib line
			);
		}
	}

	// Backtrack, preferring the diagonal so equal-score paths align rather than gap.
	const map = new Map<number, number>();
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		const diag = H[i - 1][j - 1] + sim[i - 1][j - 1];
		if (H[i][j] === diag) {
			if (sim[i - 1][j - 1] >= ALIGN_SIM_FLOOR) {
				map.set(i - 1, j - 1);
			}
			i--;
			j--;
		} else if (H[i][j] === H[i - 1][j]) {
			i--;
		} else {
			j--;
		}
	}
	return map;
}

/** Exposed for callers that want to drop empty/blank lines consistently. */
export function isBlankLine(line: string): boolean {
	return normalizeLyricText(line).length === 0;
}

/**
 * Length-lenient similarity: scores the shorter token sequence as an approximate
 * substring of the longer one, in [0,1]. Unlike lineSimilarity (symmetric edit
 * ratio), this does not punish length differences, so it correctly credits a
 * sub-phrase referent and a line that one source split and the other didn't —
 * the two failure modes that make a symmetric ratio under-count correct matches.
 *
 * Used by the scorer as the oracle-independent "is the matched LRCLIB line the
 * same lyric as the annotated Genius line?" test.
 */
export function containmentSimilarity(a: string, b: string): number {
	let short = tokenizeLyricText(a);
	let long = tokenizeLyricText(b);
	if (short.length > long.length) [short, long] = [long, short];
	if (short.length === 0) return long.length === 0 ? 1 : 0;

	// Edit distance of `short` as a substring of `long`: zeroed first row so the
	// pattern may start anywhere, answer is the min of the final row.
	const n = long.length;
	let prev = new Array<number>(n + 1).fill(0);
	let cur = new Array<number>(n + 1);
	for (let i = 1; i <= short.length; i++) {
		cur[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = short[i - 1] === long[j - 1] ? 0 : 1;
			cur[j] = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1);
		}
		[prev, cur] = [cur, prev];
	}
	let best = Number.POSITIVE_INFINITY;
	for (let j = 1; j <= n; j++) best = Math.min(best, prev[j]);
	return 1 - best / short.length;
}
