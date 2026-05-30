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

// Concatenates the model's PROSE fields only. Quoted lyric lines (lines[].line) are
// excluded: they are the artist's words, not the model's writing, so counting them
// would pollute every lexical metric.
export function analysisProse(a: ConceptRead): string {
	return [
		a.image,
		a.lens,
		a.tension,
		a.take,
		a.contradiction ?? "",
		...a.arc.map((beat) => beat.scene),
		...a.lines.map((l) => l.insight),
		a.texture,
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
