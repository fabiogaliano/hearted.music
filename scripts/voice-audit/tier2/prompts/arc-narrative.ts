import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

export function arcNarrativePrompt(a: ConceptRead): string {
	const body = a.arc
		.map((beat, i) => `${i + 1}. [${beat.label} — ${beat.mood}] ${beat.scene}`)
		.join("\n");

	return `You are auditing one song arc.

A good arc reads as a connected story: each beat picks up where the last left off, so reading them in sequence feels like the song unfolding in real time. A bad arc is a handful of disconnected structural labels ("the intro is atmospheric", "the chorus is uplifting") that could be shuffled without loss.

Note: a flat mood across beats is NOT a failure. Some songs hold one register the whole way (a monochrome song has structure without a mood shift). Judge whether the SCENES connect, not whether the moods change.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: do these beats form a connected story, or are they disconnected labels?

ARC:
${body}

Return:
- narrative: true if the beats build on each other so that shuffling them would clearly break the story; false otherwise.
- disconnect_points: short notes like "3→4" naming transitions that don't follow, with a 1-line reason each. Empty array if narrative.
- rationale: 1–2 short bullets (under 20 words each).`;
}
