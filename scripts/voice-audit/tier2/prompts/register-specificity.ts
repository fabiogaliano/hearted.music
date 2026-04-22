import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";

export function registerSpecificityPrompt(a: SongAnalysisLyrical): string {
	const fields = [
		["headline", a.headline],
		["mood_description", a.mood_description],
		["interpretation", a.interpretation],
		...a.themes.map(
			(t, i) => [`themes[${i}]`, `${t.name}: ${t.description}`] as const,
		),
	];
	const body = fields.map(([name, value]) => `${name}: ${value}`).join("\n");

	return `You are auditing one short song analysis for specificity.

A specific analysis makes claims that could only be true of *this* song. A generic analysis uses sentences that would still read fine if swapped into a review of almost any other song in the same genre.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this analysis make at least three claims that could only be true of this specific song?

Evidence is required. If you say it is generic, quote the actual sentences that would fit any song. If you say it is specific, quote the sentences that ground it to this one.

ANALYSIS:
${body}

Return:
- specific: true if three or more claims are song-specific, otherwise false.
- generic_sentences: exact quoted sentences that read as generic. Empty array if specific.
- rationale: 1–3 short bullets (under 20 words each) explaining the call.`;
}
