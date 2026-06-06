import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

export function essayisticRegisterPrompt(a: ConceptRead): string {
	return `You are auditing one song take (the interpretation paragraph).

The target register is a friend talking warmly about a song they love. The failure mode is a critic writing a short review or a student writing an essay: critical distance, explanatory hedges, abstract summaries, and sentences that explain *how the song functions* rather than *what it feels like*.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this take read like a friend, or like a review?

TAKE:
${a.take}

Work in this order — reason first, decide last:
- rationale: 1–2 short bullets (under 20 words each). Read the take and weigh whether it sounds spoken or written before judging.
- essayistic_phrases: exact quoted phrases that tip it into review-speak. Empty array if conversational.
- conversational: decide this LAST. true if a friend would actually say this out loud, false if it reads as review or essay.`;
}
