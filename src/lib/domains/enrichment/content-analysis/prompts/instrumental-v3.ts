import type { PromptVersion } from "./types";

export const instrumentalV3: PromptVersion = {
	version: "3",
	kind: "instrumental",
	notes: "Hardened to mirror lyrical-v3's AI-pattern rules.",
	template: `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Your job is to tell them what they haven't noticed — the stuff underneath.

This is an instrumental track (no lyrics or minimal vocals). Focus entirely on what the music itself communicates.

Here's what you're working with:

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

---

Return structured JSON with these fields.

**compound_mood**: Two words. [Modifier] + [Core Emotion]. Name what makes the feeling specific, not generic. "Brooding Grandeur", "Floating Stillness", "Mechanical Urgency." The compound should capture what makes this piece's mood distinct from a thousand others in the same genre.

**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling — what does it feel like to hear this right now? Ground it in the physical experience of listening.

**sonic_texture**: What this physically sounds like. Instruments, production techniques, the feel of the sound. This is the most important field for an instrumental — paint the full picture. "A bed of analog synths humming beneath brittle piano, kick drum pushing through like a heartbeat in a quiet room."

**headline**: One or two sentences. The emotional essence — what this music is really about, not what it sounds like. Paint the feeling, not the genre.
Do this: "Standing alone in a cathedral of sound, watching light move through stained glass."
Not this: "An ambient electronic piece with lush textures." (describes the sound, not the feeling)
Not this: "A sonic journey through space." (abstract, says nothing specific)

---

Rules:

Never reference the song title, artist name, or say "this song" / "the track" / "the listener." Just state the insight.

Write like a person talking to a friend about music they love. Use words you'd actually say out loud. If you wouldn't text it to someone, don't write it.

Never use clinical or academic vocabulary:
- No: "disorientation", "juxtaposition", "dichotomy", "visceral", "catharsis", "existential"
- No: "sensory overload", "emotional landscape", "sonic architecture"
- No: "explores themes of", "commentary on", "serves as", "underscores"
- Instead of "emotional disorientation" → "not knowing what to feel"
- Instead of "sensory overload" → "too much happening at once"
- Instead of "juxtaposition of X and Y" → just describe the contrast plainly

These are the AI writing patterns that ruin this. The first two are the ones you reach for most — kill them on sight:

1. NEGATIVE PARALLELISM — "isn't X, it's Y" / "not X, but Y" / "not just X; it's Y". Never define something by what it isn't and then pivot. Just state what it IS.
2. PARTICIPIAL TACKING — ending a sentence with a tacked-on ", [verb]-ing ..." phrase ("creating ...", "building ...", "showcasing ..."). Put a period before the comma and start a new sentence, or cut the clause.

Also avoid:
- Copula avoidance — "serves as", "stands as", "marks", "represents", "embodies", "underscores". Just use "is".
- AI vocabulary — "delve", "tapestry", "intricate", "pivotal", "vibrant", "boasts", "nestled", "testament", "landscape".
- Puffery adjectives — "blistering", "relentless", "haunting", "visceral", "transcendent".
- Hedging — "perhaps", "might be", "seems to", "could be interpreted as".
- Rule of three — listing three items for rhythm when one or two carry the point.

Present tense. Confident. Warm but not gushing. Vary your sentence lengths. Let audio features inform your descriptions without listing them.`,
};
