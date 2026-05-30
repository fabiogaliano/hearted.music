import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

export function registerSpecificityPrompt(a: ConceptRead): string {
	const fields = [
		["image", a.image],
		["take", a.take],
		...a.lines.map(
			(l, i) => [`lines[${i}].insight`, l.insight] as const,
		),
	];
	const body = fields.map(([name, value]) => `${name}: ${value}`).join("\n");

	return `You are auditing one short song read for specificity.

A specific read makes claims that could only be true of *this* song. A generic read uses sentences that would still read fine if swapped into a review of almost any other song in the same genre.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this read make at least three claims that could only be true of this specific song?

Evidence is required. If you say it is generic, quote the actual sentences that would fit any song. If you say it is specific, quote the sentences that ground it to this one.

READ:
${body}

Return:
- specific: true if three or more claims are song-specific, otherwise false.
- generic_sentences: exact quoted sentences that read as generic. Empty array if specific.
- rationale: 1–3 short bullets (under 20 words each) explaining the call.`;
}
