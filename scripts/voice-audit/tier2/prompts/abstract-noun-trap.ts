import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";

export function abstractNounTrapPrompt(a: SongRead): string {
	return `You are auditing one song image.

A good image names a concrete image or a specific feeling the listener can picture. A bad image leans on abstract summary nouns like *journey*, *tapestry*, *exploration*, *declaration*, *reclaiming*, *statement*, *meditation*, *reflection*, *testament*, *celebration*.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: does this image work via a concrete image or felt experience, rather than an abstract summary noun?

IMAGE:
${a.image}

Work in this order — reason first, decide last:
- rationale: 1–2 short bullets (under 20 words each). Read the image and name what its core move is before judging.
- offending_nouns: exact abstract nouns present in the image that do the summarizing. Empty array if concrete.
- concrete: decide this LAST. true if the image lands on an image or felt sensation, false if its core move is an abstract summary noun.`;
}
