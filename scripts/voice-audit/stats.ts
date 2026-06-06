// Descriptive statistical tells, NOT a gate. The AI-detection literature (DetectGPT,
// Binoculars, GPTZero) leans on "low perplexity + low burstiness = AI", which is
// largely obsolete for frontier models that now produce high-perplexity, high-burstiness
// text. So these metrics are reported as context next to the pairwise judge verdict, not
// optimized against. See claudedocs/voice-eval-design-decision-2026-05-27.md.

import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import { splitSentences } from "./tier1/burstiness";

// Closed-class function words. A healthy human-prose ratio sits roughly 0.40-0.55;
// very low suggests dense, nominalized writing.
const FUNCTION_WORDS = new Set([
	"a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "of", "in",
	"on", "at", "to", "from", "by", "with", "about", "into", "over", "after",
	"under", "above", "below", "between", "through", "during", "before", "as",
	"is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
	"have", "has", "had", "will", "would", "shall", "should", "can", "could",
	"may", "might", "must", "i", "you", "he", "she", "it", "we", "they", "me",
	"him", "her", "us", "them", "this", "that", "these", "those", "my", "your",
	"his", "its", "our", "their", "who", "whom", "which", "what", "where", "when",
	"why", "how", "not", "no", "if", "than", "then", "there", "here", "out", "up",
	"down", "off", "all", "any", "some", "each", "more", "most", "such", "own",
]);

function words(text: string): string[] {
	return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

// MTLD (Measure of Textual Lexical Diversity): the mean token-run length that keeps
// the type-token ratio above 0.72, averaged over forward and backward passes. More
// stable across text lengths than raw TTR. Higher = more diverse vocabulary.
function mtldRun(tokens: string[], threshold = 0.72): number {
	let factors = 0;
	let typeStart = 0;
	const seen = new Set<string>();
	for (let i = 0; i < tokens.length; i++) {
		seen.add(tokens[i]);
		const ttr = seen.size / (i - typeStart + 1);
		if (ttr <= threshold) {
			factors += 1;
			seen.clear();
			typeStart = i + 1;
		}
	}
	const remaining = tokens.length - typeStart;
	if (remaining > 0) {
		const seenCount = seen.size;
		const partialTtr = seenCount / remaining;
		// Partial factor: how far the trailing run got toward the threshold.
		factors += (1 - partialTtr) / (1 - threshold);
	}
	return factors > 0 ? tokens.length / factors : tokens.length;
}

export function mtld(text: string): number | null {
	const tokens = words(text);
	if (tokens.length < 50) return null;
	const forward = mtldRun(tokens);
	const backward = mtldRun([...tokens].reverse());
	return (forward + backward) / 2;
}

export interface BurstinessStats {
	sentences: number;
	meanLength: number;
	stdev: number;
	cv: number | null;
	// Goh-Barabasi burstiness parameter (sigma-mu)/(sigma+mu), range -1..1. Higher =
	// more human-like variation; near -1 = metronomic, a classic AI rhythm tell.
	burstiness: number | null;
	min: number;
	max: number;
}

export function burstinessStats(text: string): BurstinessStats {
	const lengths = splitSentences(text).map((s) => (s.match(/[a-z']+/gi) ?? []).length);
	const n = lengths.length;
	if (n === 0) {
		return { sentences: 0, meanLength: 0, stdev: 0, cv: null, burstiness: null, min: 0, max: 0 };
	}
	const mean = lengths.reduce((a, b) => a + b, 0) / n;
	const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
	const stdev = Math.sqrt(variance);
	const cv = mean === 0 ? null : stdev / mean;
	const burstiness = stdev + mean === 0 ? null : (stdev - mean) / (stdev + mean);
	return {
		sentences: n,
		meanLength: mean,
		stdev,
		cv,
		burstiness,
		min: Math.min(...lengths),
		max: Math.max(...lengths),
	};
}

export function functionWordRatio(text: string): number | null {
	const tokens = words(text);
	if (tokens.length === 0) return null;
	const fn = tokens.filter((t) => FUNCTION_WORDS.has(t)).length;
	return fn / tokens.length;
}

export interface VoiceStats {
	mtld: number | null;
	functionWordRatio: number | null;
	burstiness: BurstinessStats;
	wordCount: number;
}

// Concatenates the model's PROSE fields only. The `lines` array is excluded entirely:
// it carries only the artist's quoted words, not the model's writing, so counting it
// would pollute every lexical metric.
export function analysisProse(a: ConceptRead): string {
	return [
		a.image,
		a.lens,
		a.tension,
		a.take,
		a.contradiction ?? "",
		...a.arc.map((beat) => beat.scene),
		a.texture ?? "",
	].join(" ");
}

export function voiceStats(a: ConceptRead): VoiceStats {
	const prose = analysisProse(a);
	return {
		mtld: mtld(prose),
		functionWordRatio: functionWordRatio(prose),
		burstiness: burstinessStats(prose),
		wordCount: words(prose).length,
	};
}

// --- Inferential helpers for the n=9 scoreboard ---
//
// At n=9 these are used as a NOISE VETO, not a keep gate: a wide Wilson interval or a
// non-significant McNemar means "too noisy to trust", never "edit proven bad". See
// claudedocs/06-block1-implementation-plan.md §1, WP2.

// Wilson score interval for a binomial proportion. `successes` is the count of SONGS whose
// collapsed outcome is WIN-or-TIE vs gold for one variant; that WIN-or-TIE collapse makes the
// outcome a clean binary proportion, which is exactly the model Wilson assumes. If ties ever
// move to 0.5 scoring this stops being a binomial proportion and the CI method must change.
export function wilsonInterval(
	successes: number,
	n: number,
	z = 1.96,
): { lo: number; hi: number } {
	if (n === 0) return { lo: 0, hi: 1 };
	const p = successes / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const center = (p + z2 / (2 * n)) / denom;
	const margin =
		(z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	return {
		lo: Math.max(0, center - margin),
		hi: Math.min(1, center + margin),
	};
}

// McNemar mid-p test for a PAIRED variant-vs-variant comparison. `b` and `c` are the
// discordant song counts: b = songs where variant A succeeds and B fails; c = songs where A
// fails and B succeeds. Concordant songs (both succeed / both fail) carry no signal and are
// excluded by construction. The mid-p variant is used because it is less conservative than
// the exact binomial test at the tiny discordant counts n=9 produces, while keeping exact-test
// validity (no normal approximation). Symmetric inputs (b===c, or b===c===0) return p=1.
export function mcnemarMidP(
	b: number,
	c: number,
): { p: number; b: number; c: number } {
	const n = b + c;
	if (n === 0) return { p: 1, b, c };
	const k = Math.min(b, c);
	// Binomial(n, 0.5) pmf computed iteratively (term_i = term_{i-1} * (n-i+1)/i) so no
	// factorial overflows. half = pmf at i=0 = C(n,0) * 0.5^n.
	const half = 0.5 ** n;
	let pmf = half;
	let cumulativeBelowK = 0; // sum_{i=0}^{k-1} P(X=i)
	let pointK = half; // P(X=k)
	for (let i = 0; i <= k; i++) {
		if (i > 0) pmf = (pmf * (n - i + 1)) / i;
		if (i < k) cumulativeBelowK += pmf;
		else pointK = pmf;
	}
	// One-sided mid-p counts half the probability mass exactly at the boundary k.
	const oneSidedMidP = cumulativeBelowK + 0.5 * pointK;
	return { p: Math.min(1, 2 * oneSidedMidP), b, c };
}
