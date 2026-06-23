/**
 * Annotation matcher — locates a Genius referent `fragment` inside the plain
 * LRCLIB lyric blob so its annotation can be attached to the right line(s).
 *
 * Why this exists: with the Genius HTML scrape gone, the anchor tags that used
 * to pin annotations to rendered lines are unavailable in production. The
 * `/referents` API instead hands us, per annotation, the `fragment` — the exact
 * lyric text it annotates. LRCLIB is an *independent transcription* of the same
 * song, so the fragment never matches LRCLIB byte-for-byte: homoglyphs (a
 * Cyrillic "е" in "plеase"), ad-libs in parentheses, smart vs. straight quotes,
 * elisions, differing line breaks, and the odd transcribed-word disagreement
 * ("grown" vs "gone") all show up. So placement is approximate string matching,
 * not equality.
 *
 * Approach: token-level fuzzy substring alignment. Both sides are normalized to
 * a stream of ASCII word tokens (transliteration folds the homoglyph/accent
 * class away before it can cost anything), then we find the run of LRCLIB tokens
 * with minimum token-edit-distance to the fragment via a Levenshtein DP whose
 * first row is zeroed — the classic "approximate substring" / Smith-Waterman
 * trick that lets the pattern begin matching anywhere in the text for free. The
 * matched token run maps back to LRCLIB line indices.
 *
 * This module is pure: it returns the best span + a similarity score and never
 * applies a threshold itself, so callers (and the eval harness) decide the
 * confidence floor.
 */

import { transliterate } from "transliteration";

export interface FragmentMatch {
	/** 0-based index of the first LRCLIB line the fragment covers. */
	startLine: number;
	/** 0-based index of the last LRCLIB line the fragment covers (inclusive). */
	endLine: number;
	/** Similarity in [0,1] = 1 − tokenEditDistance / fragmentTokenCount. */
	score: number;
}

/** A normalized LRCLIB token tagged with the line it came from. */
interface StreamToken {
	token: string;
	line: number;
}

/**
 * Precomputed LRCLIB token stream. Building it is O(text); reuse it across all
 * of a song's fragments instead of re-tokenizing per annotation.
 */
export interface LrclibStream {
	tokens: StreamToken[];
	lineCount: number;
}

/**
 * Canonical lyric-text normalization, shared by both sides of the match.
 *
 * - transliterate() folds Cyrillic/accented characters to ASCII, so a homoglyph
 *   like the Cyrillic "е" stops being a spurious mismatch instead of costing an
 *   edit on every line that contains one.
 * - Parenthesized ad-libs / backing vocals are dropped: one source routinely
 *   carries "(My memories of you)" where the other omits it, and they should
 *   not penalize the alignment.
 * - Apostrophes are elided (not spaced) so "couldn't" == "couldnt" and
 *   "'Cause" == "Cause" collapse to one token rather than splitting.
 * - Everything else non-alphanumeric becomes a space; tokens are the words.
 */
export function normalizeLyricText(text: string): string {
	return transliterate(text)
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/[‘’'`´]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Normalizes then splits into word tokens. Empty input → no tokens. */
export function tokenizeLyricText(text: string): string[] {
	const normalized = normalizeLyricText(text);
	return normalized.length === 0 ? [] : normalized.split(" ");
}

/** Splits a plain-text lyric blob into lines exactly as it will be stored. */
export function splitLyricLines(plainText: string): string[] {
	return plainText.split("\n");
}

/**
 * Builds the reusable normalized token stream for a song's LRCLIB lines. Each
 * token remembers its source line so a matched token run recovers line indices.
 */
export function buildLrclibStream(lines: string[]): LrclibStream {
	const tokens: StreamToken[] = [];
	lines.forEach((line, lineIndex) => {
		for (const token of tokenizeLyricText(line)) {
			tokens.push({ token, line: lineIndex });
		}
	});
	return { tokens, lineCount: lines.length };
}

/**
 * Finds the best-matching LRCLIB line span for a fragment.
 *
 * Returns the highest-scoring span regardless of how low the score is; the
 * caller applies the confidence floor. Returns null only when there is nothing
 * to match (empty fragment after normalization, or an empty LRCLIB stream) —
 * those cases carry no span to attach to.
 *
 * Pass a prebuilt `stream` to avoid re-tokenizing the same song per annotation.
 */
export function bestFragmentMatch(
	fragment: string,
	lrclibLinesOrStream: string[] | LrclibStream,
): FragmentMatch | null {
	const stream = Array.isArray(lrclibLinesOrStream)
		? buildLrclibStream(lrclibLinesOrStream)
		: lrclibLinesOrStream;

	const pattern = tokenizeLyricText(fragment);
	if (pattern.length === 0 || stream.tokens.length === 0) return null;

	const span = fuzzySubstringSpan(pattern, stream.tokens);
	const score = 1 - span.distance / pattern.length;

	return {
		startLine: stream.tokens[span.startToken].line,
		endLine: stream.tokens[span.endToken].line,
		score: Math.max(0, score),
	};
}

interface TokenSpan {
	startToken: number;
	endToken: number;
	distance: number;
}

/**
 * Token-level approximate substring match. Returns the run of `text` tokens with
 * minimum token-edit-distance to `pattern`, plus that distance.
 *
 * The DP is a standard Levenshtein matrix between pattern (rows) and text
 * (columns) with two deviations that turn "is pattern equal to text" into "where
 * does pattern best appear within text":
 *   - row 0 is all zeros, so a match may start at any text column at no cost;
 *   - the answer is the minimum of the final row, so it may end at any column.
 * An `origin` array carries, for each column, the text index where the current
 * path began, recovering the span start without storing the whole matrix.
 *
 * O(pattern × text) time, O(text) space.
 */
function fuzzySubstringSpan(pattern: string[], text: StreamToken[]): TokenSpan {
	const n = text.length;

	// prev/cur hold edit distances for the previous/current pattern row.
	// originPrev/originCur hold the text START index (0-based) of the path into
	// each cell. Column j (1..n) corresponds to text token j-1.
	let prev = new Array<number>(n + 1);
	let originPrev = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) {
		prev[j] = 0; // zeroed first row: start anywhere for free
		originPrev[j] = j; // a path starting here would begin at text token j
	}

	let cur = new Array<number>(n + 1);
	let originCur = new Array<number>(n + 1);

	for (let i = 1; i <= pattern.length; i++) {
		// Consuming a pattern token with no text consumed costs i (all deletions).
		cur[0] = i;
		originCur[0] = 0;

		for (let j = 1; j <= n; j++) {
			const match = pattern[i - 1] === text[j - 1].token ? 0 : 1;

			const diag = prev[j - 1] + match; // substitute / match
			const up = prev[j] + 1; // deletion: pattern token absent from text
			const left = cur[j - 1] + 1; // insertion: extra text token in span

			// Prefer diag, then up, then left, keeping matched spans tight.
			let best = diag;
			let origin = originPrev[j - 1];
			if (up < best) {
				best = up;
				origin = originPrev[j];
			}
			if (left < best) {
				best = left;
				origin = originCur[j - 1];
			}

			cur[j] = best;
			originCur[j] = origin;
		}

		// Swap rows.
		[prev, cur] = [cur, prev];
		[originPrev, originCur] = [originCur, originPrev];
	}

	// Final pattern row now lives in prev/originPrev. Pick the column with the
	// least distance; on ties prefer the shorter (and earlier) span so a fragment
	// doesn't sprawl across unrelated lines.
	let bestJ = 1;
	let bestDist = Number.POSITIVE_INFINITY;
	let bestStart = 0;
	for (let j = 1; j <= n; j++) {
		const dist = prev[j];
		const start = originPrev[j];
		if (
			dist < bestDist ||
			(dist === bestDist && j - start < bestJ - bestStart)
		) {
			bestDist = dist;
			bestJ = j;
			bestStart = start;
		}
	}

	// origin is a 0-based text token index already; bestJ is 1-based → endToken = bestJ-1.
	const startToken = Math.min(bestStart, n - 1);
	const endToken = bestJ - 1;
	return {
		startToken: Math.min(startToken, endToken),
		endToken: Math.max(startToken, endToken),
		distance: bestDist,
	};
}
