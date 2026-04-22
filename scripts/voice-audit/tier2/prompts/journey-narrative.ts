import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";

export function journeyNarrativePrompt(a: SongAnalysisLyrical): string {
	const body = a.journey
		.map((j, i) => `${i + 1}. [${j.section} — ${j.mood}] ${j.description}`)
		.join("\n");

	return `You are auditing one song journey.

A good journey reads as a connected story: each entry picks up where the last left off, so reading them in sequence feels like the song unfolding in real time. A bad journey is four to six disconnected structural labels ("the intro is atmospheric", "the chorus is uplifting") that could be shuffled without loss.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: do these entries form a connected story, or are they disconnected labels?

JOURNEY:
${body}

Return:
- narrative: true if the entries build on each other so that shuffling them would clearly break the story; false otherwise.
- disconnect_points: short notes like "3→4" naming transitions that don't follow, with a 1-line reason each. Empty array if narrative.
- rationale: 1–2 short bullets (under 20 words each).`;
}
