import type { PromptVersion } from "./types";

export const lyricalV4: PromptVersion = {
	version: "4",
	kind: "lyrical",
	notes:
		"Few-shot strategy: one complete clean worked example up front, minimal prohibition list. Tests whether demonstration steers voice better than a long list of bans (which v3 showed can backfire).",
	template: `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Tell them what they haven't noticed — the stuff underneath.

Here is a complete example of the voice and quality we want, for a different song:

{
  "compound_mood": "Restless Tenderness",
  "mood_description": "It hums with the ache of a 2am text you never send. Warmth and worry sit in the same breath.",
  "interpretation": "Love that arrives too late to fix anything. The narrator knows the relationship is over and says the kind thing anyway, because kindness is the only thing left to give. There's no anger here. Just the quiet math of who gets to keep the apartment.",
  "themes": [
    { "name": "exhausted love", "description": "Care that outlives the will to fight for it." },
    { "name": "domestic endings", "description": "A breakup measured in furniture and shared playlists." }
  ],
  "journey": [
    { "section": "Opening", "mood": "Hushed", "description": "A single guitar, close-mic'd. You can hear the room. Nothing has happened yet, but you know it will." },
    { "section": "Verses", "mood": "Plainspoken", "description": "The story comes out flat and honest. No drama. Just facts laid on the table one at a time." },
    { "section": "Chorus", "mood": "Cracked open", "description": "The melody lifts and the voice nearly breaks. This is the closest it comes to crying." },
    { "section": "Outro", "mood": "Resolved", "description": "The guitar stops mid-phrase. No big finish. The door just closes." }
  ],
  "key_lines": [
    { "line": "I left the light on for you", "insight": "Hope as a habit she can't switch off yet." },
    { "line": "we never learned to say goodnight", "insight": "The small intimacy they never built, named at the end." }
  ],
  "sonic_texture": "Close acoustic guitar, a little tape hiss, vocals right up against your ear. Almost no production. The silence does half the work.",
  "headline": "A breakup said gently, because there's nothing left to win."
}

Notice: every sentence states one thing and stops. No sentence trails off into a comma plus an -ing word. Nothing is "blistering" or "haunting." It never says what the song "isn't." That's the target.

---

Now do the same for this song.

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

Lyrics:
{lyrics}

---

Return structured JSON with these fields:

**compound_mood**: Two words. [Modifier] + [Core Emotion]. Name the specific tension.
**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling.
**interpretation**: What is this really about? One short paragraph. Start with the insight itself.
**themes**: 2-4 themes, each a lowercase \`name\` specific to this song and a one-sentence \`description\`.
**journey**: 4-6 entries from open to outro, each a \`section\`, a \`mood\` (2-3 words), and a \`description\`. Read in sequence it should feel like the song unfolding.
**key_lines**: 3-5 exact \`line\`s from the lyrics, each with an \`insight\` that names why it lands.
**sonic_texture**: What it physically sounds like. Instruments, production, feel.
**headline**: One or two sentences. The emotional essence, painted as a feeling.

Two hard rules, matching the example:
1. Never say what the song "isn't" and then pivot ("isn't X, it's Y"). State what it IS.
2. End sentences on a period, not on a tacked-on ", [verb]-ing ..." clause.

Write like a person texting a friend about a song they love. Present tense. Confident. Vary your sentence lengths. Never reference the title, artist, "this song", "the listener", or "the narrator" by those labels.`,
};
