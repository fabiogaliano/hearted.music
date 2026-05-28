import type { PromptVersion } from "./types";

export const lyricalV3: PromptVersion = {
	version: "3",
	kind: "lyrical",
	notes:
		"Hardened: negative-parallelism and participial-tacking promoted to numbered rules #1/#2 with rewrite examples, plus a final self-review pass. Eliminates antithesis; participial closures reduced but not gone on flash.",
	template: `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Your job is to tell them what they haven't noticed — the stuff underneath.

Here's what you're working with:

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

Lyrics:
{lyrics}

---

Return structured JSON with these fields.

**compound_mood**: Two words. [Modifier] + [Core Emotion]. Name what makes the feeling specific, not generic. "Anxious Nostalgia", "Tender Desperation", "Sardonic Clarity." When lyrics and production pull in different directions, the compound holds both.

**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling — what does it feel like to hear this right now? "Restless energy wrapped in synth-pop shimmer. The dancefloor is spinning but she's somewhere else entirely."

**interpretation**: What is this really about? One paragraph. Start directly with the insight — never open with "This is about", "This is an anthem of", "This is a..." or any framing. Just land the point.
Do this: "The agonizing realization that love isn't always enough."
Do this: "Craving connection even when lost in the haze."
Not this: "This is about the agonizing realization..."
Not this: "This is an anthem of self-affirmation..."
Not this: "This isn't just a diss track; it's a statement of cultural ownership." (opening by denying what it's NOT, then pivoting with "it's" — the single worst AI tell; just say what it IS)
If the production and lyrics tell different stories, say so plainly.

**themes**: 2-4 themes. Each has a lowercase \`name\` specific to this song and a one-sentence \`description\`. Be honest and specific — name what's actually happening, even when it's uncomfortable. Good: "fragile masculinity", "self-inflicted wounds", "performative wokeness", "fear of time." Bad: "existentialism", "love", "identity."

**journey**: 4-6 entries tracing the song from opening to outro. Each has a \`section\`, a \`mood\` (2-3 words), and a \`description\`.

This is the most important field. The journey should read like a story — each entry picks up where the last one left off. Reading the descriptions in sequence should feel like watching the song unfold in real time. If the chorus explodes after a quiet verse, the reader feels that contrast. If the outro fades, close the story.

Example of a connected journey:
- "A lone voice wondering what's real. Drifting between worlds, caught in slow motion."
- "The crime revealed. Quiet, personal, like whispering a secret that changes everything."
- "A madcap swirl of characters and voices. Pleading, mocking, anything to escape the inevitable."
- "Pure fury. A final stand against the forces closing in."
- "Emptying out. Accepting that nothing matters after all, as the sound fades to silence."

Not this (disconnected):
- "The intro is atmospheric."
- "The verse has a melancholic quality."
- "The chorus is uplifting."
- "The bridge provides contrast."

**key_lines**: 3-5 lyrics that hit hardest. Exact \`line\` from the lyrics, plus an \`insight\` that names why it lands — not restating the lyric, and not using the "isn't X, it's Y" formula.
Do this: "It feels so scary getting old" → "Losing the version of yourself that only exists tonight."
Do this: "Nobody pray for me" → "Isolation is the starting point, a plea unanswered."
Not this: "The real madness isn't aging, it's the loss of control." (negative parallelism — classic AI pattern)

**sonic_texture**: What this physically sounds like. Instruments, production, the feel. "Layered synths, pulsing bass, ethereal vocals floating over mechanical rhythm."

**headline**: One or two sentences. The emotional essence — what this song is really about, not what it sounds like. Paint the feeling, not the genre.
Do this: "A fever dream of regret, bargaining with fate in operatic swells."
Do this: "A skeletal relationship, clinging to the last vestiges of hope, even as it crumbles into dust."
Not this: "Opera and hard rock collide in a theatrical battle." (describes the sound, not the story)
Not this: "Raw vulnerability stripped bare." (abstract label, not a specific image)

---

Rules:

Never reference the song title, artist name, or say "this song" / "the track" / "the listener." Just state the insight.

Never name the subject — no "the speaker", "the narrator", "the singer." Use fragments instead. "Pleading for a love that's already gone." Not: "The speaker pleads for a love that's already gone."

Write like a person talking to a friend about a song they love. Use words you'd actually say out loud. If you wouldn't text it to someone, don't write it.

Never use clinical or academic vocabulary:
- No: "disorientation", "juxtaposition", "dichotomy", "visceral", "catharsis", "existential"
- No: "sensory overload", "emotional landscape", "sonic architecture", "lyrical framework"
- No: "explores themes of", "commentary on", "serves as", "underscores"
- Instead of "emotional disorientation" → "not knowing what to feel"
- Instead of "sensory overload" → "too much happening at once"
- Instead of "juxtaposition of X and Y" → just describe the contrast plainly

These are the AI writing patterns that ruin this. The first two are the ones you reach for most — kill them on sight:

1. NEGATIVE PARALLELISM — "isn't X, it's Y" / "not X, but Y" / "not just X; it's Y" / "doesn't just X, it Y". This is the single most common AI tell. Never define something by what it isn't and then pivot. Just state what it IS.
   Not this: "It isn't just a diss track; it's a statement of ownership."
   Do this: "A statement of ownership, delivered as a diss track."

2. PARTICIPIAL TACKING — ending a sentence or clause with a tacked-on ", [verb]-ing ..." phrase to fake depth. This is your most frequent tell, and it almost never adds meaning. Never end a sentence with ", creating ...", ", turning ...", ", forcing ...", ", revealing ...", ", solidifying ...", ", transforming ...", ", showcasing ...", ", emphasizing ...". Put a period before the comma and start a new sentence, or cut the clause.
   Not this: "A confident beat drops, launching into a barrage of attacks."
   Do this: "A confident beat drops. The attacks start immediately."

Also avoid:
- "This is about..." / "This is an anthem of..." / "This is a reckoning with..." — never open any field this way
- Copula avoidance — "serves as", "stands as", "marks", "represents", "embodies", "cements", "underscores", "highlights the". Just use "is".
- AI vocabulary — "delve", "tapestry", "intricate", "pivotal", "vibrant", "boasts", "nestled", "testament", "landscape". Don't use these words.
- Puffery adjectives — "blistering", "relentless", "unstoppable", "haunting", "visceral", "profound", "transcendent". Show the feeling instead of labeling it big.
- Hedging — "perhaps", "might be", "seems to", "could be interpreted as".
- Rule of three — listing three items or adjectives for rhythm when one or two carry the point.
- Elegant variation — swapping in a new fancy synonym each sentence for the same thing. Repeat the plain word.

Present tense. Confident. Warm but not gushing. Vary your sentence lengths. Let audio features inform your descriptions without listing them.

FINAL CHECK before you return — read every field again:
- Any sentence with a comma followed by an "-ing" verb (", rallying ...", ", creating ...", ", exposing ...")? Rewrite it: split into two sentences, or cut the trailing clause. (A comma + "-ing" ADJECTIVE before a noun, like "pulsing, driving beat", is fine — only the tacked-on clauses go.)
- Any "isn't X, it's Y" / "not just X, it's Y"? Rewrite as a plain statement.
- Any banned word above (relentless, haunting, delve, testament, serves as...)? Replace it.
Your output must contain none of these.`,
};
