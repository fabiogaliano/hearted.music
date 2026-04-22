import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";

export function essayisticRegisterPrompt(a: SongAnalysisLyrical): string {
	return `You are auditing one interpretation paragraph.

The target register is a friend talking warmly about a song they love. The failure mode is a critic writing a short review or a student writing an essay: critical distance, explanatory hedges, abstract summaries, and sentences that explain *how the song functions* rather than *what it feels like*.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this interpretation read like a friend, or like a review?

INTERPRETATION:
${a.interpretation}

Return:
- conversational: true if a friend would actually say this out loud, false if it reads as review or essay.
- essayistic_phrases: exact quoted phrases that tip it into review-speak. Empty array if conversational.
- rationale: 1–2 short bullets (under 20 words each).`;
}
