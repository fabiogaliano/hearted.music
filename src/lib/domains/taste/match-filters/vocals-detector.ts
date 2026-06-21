/**
 * Deterministic local detector for vocal-gender phrases in matching-intent text.
 *
 * Rules:
 * - Detection is case-insensitive.
 * - Uses whole-word boundary matching so "woman" does not match inside "womanhood",
 *   and "man" does not match inside "woman", "mantle", etc.
 * - Multi-word phrases (e.g. "female vocals") are tested before single-word tokens
 *   so the longer phrase wins consistently.
 * - If BOTH female and male signals appear, return { kind: "ambiguous" } — callers
 *   must NOT auto-fill on ambiguous; only unambiguous detections auto-fill.
 * - If no signal at all, return { kind: "none" }.
 * - No LLM, no network, no env vars, no artist-name inference.
 *
 * This module is consumed by CMHF-17 (editor auto-fill) and CMHF-18 (backfill script).
 */

export type VocalsDetectionResult =
	| { kind: "none" }
	| { kind: "female" }
	| { kind: "male" }
	| { kind: "ambiguous" };

/**
 * Multi-word phrases must come before single-word entries so that the longer
 * phrase is matched first and single-word sub-terms don't interfere.
 *
 * All patterns are compiled with flag "i" only. Never add the "g" flag: shared
 * module-level RegExp objects with "g" are stateful (lastIndex advances after
 * each .test() call), which would silently corrupt results across invocations.
 */
const FEMALE_PATTERNS: readonly RegExp[] = [
	// multi-word phrases first
	/\bfemale[\s-]fronted\b/,
	/\bfemale\s+vocals?\b/,
	/\bfemale\s+voices?\b/,
	/\bfemale\s+vocalist\b/,
	// "women? singers?" matched "wome"+optional-n — split into two patterns so
	// "woman singer" (singular) and "women singers" (plural) are both covered.
	/\bwoman\s+singers?\b/,
	/\bwomen\s+singers?\b/,
	/\bgirl\s+vocals?\b/,
	// single-word terms
	/\bfemale\b/,
	/\bwomen\b/,
	/\bwoman\b/,
	/\bgirls?\b/,
	/\bfeminine\b/,
].map((p) => new RegExp(p.source, "i"));

const MALE_PATTERNS: readonly RegExp[] = [
	// multi-word phrases first
	/\bmale[\s-]fronted\b/,
	/\bmale\s+vocals?\b/,
	/\bmale\s+voices?\b/,
	/\bmale\s+vocalist\b/,
	/\bmen\s+singers?\b/,
	/\bman\s+singer\b/,
	/\bboy\s+vocals?\b/,
	// single-word terms
	/\bmale\b/,
	// "men" before "man" — both are word-boundary anchored so no overlap risk
	/\bmen\b/,
	/\bman\b/,
	/\bboys?\b/,
	/\bmasculine\b/,
].map((p) => new RegExp(p.source, "i"));

function hasSignal(patterns: readonly RegExp[], text: string): boolean {
	return patterns.some((p) => p.test(text));
}

/**
 * Detect a vocal-gender signal in `intentText`.
 *
 * Returns a discriminated union so callers cannot accidentally treat an ambiguous
 * or absent result as a valid gender:
 *
 *   { kind: "none" }      — no vocal-gender signal found
 *   { kind: "female" }    — unambiguous female signal only
 *   { kind: "male" }      — unambiguous male signal only
 *   { kind: "ambiguous" } — both female and male signals present; do not auto-fill
 */
export function detectVocalGender(intentText: string): VocalsDetectionResult {
	const hasFemale = hasSignal(FEMALE_PATTERNS, intentText);
	const hasMale = hasSignal(MALE_PATTERNS, intentText);

	if (hasFemale && hasMale) return { kind: "ambiguous" };
	if (hasFemale) return { kind: "female" };
	if (hasMale) return { kind: "male" };
	return { kind: "none" };
}
