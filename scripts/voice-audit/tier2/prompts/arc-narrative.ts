import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";

export function arcNarrativePrompt(a: SongRead): string {
	const body = a.arc
		.map((beat, i) => `${i + 1}. [${beat.label} — ${beat.mood}] ${beat.scene}`)
		.join("\n");

	return `You are auditing one song arc on two things at once.

1. CONNECTION. A good arc reads as a connected story: each beat picks up where the last left off, so reading them in sequence feels like the song unfolding in real time. A bad arc is a handful of disconnected structural labels ("the intro is atmospheric", "the chorus is uplifting") that could be shuffled without loss.

2. SCENE TEXTURE. A good scene captures the FEELING and the TURN of its beat — what the moment does to the person, not what literally happens in it. A bad scene recounts the bars in sequence: a flat march of "He did X. He did Y. She did Z." that retells events the listener has already heard. The reader knows the song cold, so recited plot tells them nothing. The lyric should be pulled almost all the way out, the beat landing on a felt turn rather than a list of what happens.

Note: a flat mood across beats is NOT a failure. Some songs hold one register the whole way (a monochrome song has structure without a mood shift). Judge whether the SCENES connect and whether each one carries a feeling, not whether the moods change.

Longer is not better. Do not reward filler or over-qualification.

Answer one question: do these beats form a connected story in which every scene lands a feeling, or are they disconnected labels and/or flat event-recap?

ARC:
${body}

Work in this order — reason first, decide last:
- rationale: 1–2 short bullets (under 20 words each). Trace the beats in sequence and weigh connection + scene texture before judging.
- disconnect_points: short notes like "3→4" naming transitions that don't follow, with a 1-line reason each. Empty array if the beats connect.
- recap_scenes: short notes like "scene 2" naming scenes that recount events instead of landing a feeling or turn, with a 1-line reason each. Empty array if every scene carries feeling.
- narrative: decide this LAST. true only if the beats build on each other (shuffling them would clearly break the story) AND no scene is flat event-recap. False if either fails.`;
}
