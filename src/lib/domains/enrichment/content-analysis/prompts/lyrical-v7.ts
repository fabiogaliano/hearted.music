import type { PromptVersion } from "./types";

export const lyricalV7: PromptVersion = {
	version: "7",
	kind: "lyrical",
	notes:
		"Refines v5 (the structural-form winner, mean 4.0 high). Keeps the sentence-shape rules that killed participial closures; restores the self-reference and book-report-opener bans v5 dropped; varies sentence length to avoid the burstiness v5's uniform short sentences caused.",
	template: `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Tell them what they haven't noticed — the stuff underneath.

HOW TO WRITE (this matters more than anything else below):

Write in complete sentences that each say one thing and end with a period. Do not chain ideas with commas. If you have two ideas, write two sentences.

The one structure to never use: a comma followed by a word ending in "-ing". The moment you type a comma and reach for "creating", "leaving", "rallying", "showcasing", "turning" — stop. End the sentence at the period instead, or start a fresh one.
  Wrong: "A confident beat drops, launching into a barrage of attacks."
  Right: "A confident beat drops. The attacks start immediately."

Keep most sentences short. Let one or two run longer so the rhythm doesn't turn robotic — but a longer sentence is still one idea, still has no comma-plus-"-ing".

Start every field with the substance. Never open with "This is...", "It is...", "This song is...", or any framing. Just land the point.

Say what something IS. Never say what it "isn't" and then pivot.

Never use the words "this song", "the track", "the listener", "the narrator", "the singer", "the speaker". Talk about what's happening, not about the recording. Use fragments instead: "Pleading for a love that's already gone."

---

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

Lyrics:
{lyrics}

---

Return structured JSON:

**compound_mood**: Two words. [Modifier] + [Core Emotion]. The specific tension.
**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling.
**interpretation**: What is this really about? Three or four sentences. Start with the insight.
**themes**: 2-4 themes. Each a lowercase \`name\` specific to this song and a one-sentence \`description\`.
**journey**: 4-6 entries from open to outro. Each a \`section\`, a \`mood\` (2-3 words), and a \`description\`. In sequence it should feel like the song unfolding.
**key_lines**: 3-5 exact \`line\`s from the lyrics, each with an \`insight\` naming why it lands.
**sonic_texture**: What it physically sounds like. Instruments, production, feel.
**headline**: One or two sentences. The emotional essence as a feeling, not a description of the sound.

Avoid puffery adjectives ("blistering", "relentless", "definitive", "haunting", "profound") and significance-inflation verbs ("serves as", "represents", "underscores"). Plain words you'd say out loud. Confident, warm, present tense.`,
};
