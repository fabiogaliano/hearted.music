import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";

export function abstractNounTrapPrompt(a: SongAnalysisLyrical): string {
	return `You are auditing one song headline.

A good headline names a concrete image or a specific feeling the listener can picture. A bad headline leans on abstract summary nouns like *journey*, *tapestry*, *exploration*, *declaration*, *reclaiming*, *statement*, *meditation*, *reflection*, *testament*, *celebration*.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this headline work via a concrete image or felt experience, rather than an abstract summary noun?

HEADLINE:
${a.headline}

Return:
- concrete: true if the headline lands on an image or felt sensation, false if its core move is an abstract summary noun.
- offending_nouns: exact abstract nouns present in the headline that do the summarizing. Empty array if concrete.
- rationale: 1–2 short bullets (under 20 words each).`;
}
