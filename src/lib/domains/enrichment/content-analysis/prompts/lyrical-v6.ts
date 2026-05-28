import type { PromptVersion } from "./types";

export const lyricalV6: PromptVersion = {
	version: "6",
	kind: "lyrical",
	notes:
		"Positive-minimal strategy: almost no prohibition list (which may prime the very tells it names), heavy on target-voice exemplars and one short rule. Tests less-is-more for gemini-2.5-flash.",
	template: `Imagine texting a friend about a song you love — why it hits, what's really going on under the title. That's the voice. Plain, sharp, a little intimate. You're writing for Hearted, a music app, about:

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

Lyrics:
{lyrics}

---

Return JSON with these fields. The examples show the voice — match their plainness and their rhythm of short, complete sentences.

**compound_mood**: Two words. [Modifier] + [Core Emotion]. e.g. "Anxious Nostalgia", "Tender Desperation", "Sardonic Clarity".

**mood_description**: One or two sentences, present tense. Put the listener in the feeling. e.g. "Restless energy wrapped in synth shimmer. The dancefloor spins but she's somewhere else."

**interpretation**: What's it really about? A few short sentences. Land the insight first. e.g. "Love that shows up too late to save anything. He says the kind thing anyway. It's the only thing left to give."

**themes**: 2-4 themes. Lowercase \`name\` specific to this song, one-sentence \`description\`. Good names: "fear of time", "self-inflicted wounds", "exhausted love". Not: "identity", "love", "existentialism".

**journey**: 4-6 entries, open to outro. \`section\`, \`mood\` (2-3 words), \`description\`. Read top to bottom it should play like the song. e.g. "A lone voice wonders what's real. Everything drifts, caught in slow motion." → "The crime comes out. Quiet and personal, like a secret that changes everything."

**key_lines**: 3-5 exact \`line\`s from the lyrics, each with an \`insight\` for why it lands. e.g. "It feels so scary getting old" → "Losing the version of yourself that only exists tonight."

**sonic_texture**: What it physically sounds like. e.g. "Layered synths, pulsing bass, vocals floating over a machine-tight beat."

**headline**: One or two sentences. The feeling, painted. e.g. "A fever dream of regret, bargaining with fate." or "A skeletal relationship clinging to its last bit of hope."

One rule: say what the song IS. Never define it by what it isn't. Present tense, confident, warm. Don't name the title, artist, "this song", or "the listener" — just talk.`,
};
