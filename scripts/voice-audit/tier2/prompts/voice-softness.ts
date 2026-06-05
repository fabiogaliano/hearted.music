import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

// SFT-1 / SFT-5 / SFT-7 in one judge (saves tokens). The whole difficulty is the boundary:
// the golds are fragment-rich by design and legitimately end beats on short active turns, so
// the judge cannot just fire on "short sentence" or "ends on a generalization". The few-shots
// below are load-bearing — they are the actual golds (PASS) versus the named anti-patterns
// from the principles (FAIL). Draw the line from them, not from a generic notion of "AI tell".
export function voiceSoftnessPrompt(a: ConceptRead): string {
	const scenes = a.arc
		.map((beat, i) => `  arc[${i}]: ${beat.scene}`)
		.join("\n");

	return `You are auditing a song read for three softness tells. The read's voice is a friend who notices music and says what they hear, with certainty and forward motion. These three tells break that voice. The danger in this audit is OVER-firing: this voice uses short sentences, fragments, and interpretive turns on purpose. Only fire when a tell is really present.

CHECK 1 — APHORISTIC KICKER (SFT-1). A neat, self-satisfied "button" that manufactures profundity — an abstract epigram you could lift out and print on a poster, equating or inverting big nouns for effect, detached from this song's specifics. The tell is manufactured profundity, not mere shortness or generalization.
  FAIL (kickers): "The calm is the cruelty." / "The regret is now the most useful thing he owns." / "Silence is its own kind of violence."
  PASS (these are TURNS or wry colloquial asides, not kickers — short, but they move the subject, name a concrete shift tied to THIS song, or land a plain-spoken observation; the golds use these constantly): "It becomes a vow." / "he is the one it cannot reach." / "She still fuckin' loves him." / "Then the music stops." / "And that's the problem." / "The denial doing what denial does." / "The speed of it is the fun."
  The difference: a kicker reaches for the profound in abstract poster-language and admires itself; a turn advances the person or moment, and a wry aside uses plain, conversational words without grandeur. Generalizing in plain language is NOT a kicker. When unsure, do not fire.

CHECK 2 — FRAGMENTATION PILE (SFT-5). A pile of clipped standalone fragments stacked so the connective tissue is severed and the prose stops flowing. ONE fragment that lands is fine; quoted lyric fragments are fine; the song's own chant is fine. Only fire when a field is mostly disconnected fragments with no through-line.
  FAIL (a pile): "Gravity. The weight of it. No way up. Just the floor. Just staying."
  PASS (deliberate, sparse, or quoting the song): "Please stay." / "I need." / "One, two, three, freeze." / "As it was. As it was." — single landings or the song's own words, not a pile.

CHECK 3 — MIRRORED "X IS THE Y" PARALLELISM (SFT-7). Manufactured profundity by symmetry: a tight epigram equating two abstract nouns for effect, or a mirrored/chiastic construction. The tell is the symmetry doing the work instead of a real claim.
  FAIL (manufactured symmetry): "The calm is the cruelty." / "The cure is the disease." / "She is the question, he is the answer."
  PASS (a genuine claim or paradox, not a noun-mirror — the golds use these): "The line drawn to evict him is what makes everyone else belong." / "The one thing he will not say becomes the only thing left." / "What left taught him how to hold what remains." — these are causal/temporal turns, grounded and earned, not symmetry-for-effect. A lens in "X as Y" form is never a parallelism hit.

Audit the TAKE and the ARC SCENES (the fields where these tells live):

take: ${a.take}
scenes:
${scenes}
contradiction: ${a.contradiction ?? "(none)"}

Return:
- clean: true if none of the three tells is genuinely present. False if any fires.
- kicker_hits: exact quoted phrases that are aphoristic kickers. Empty if none.
- fragment_hits: the field(s) that are a fragmentation pile, quoted. Empty if none.
- parallelism_hits: exact quoted mirrored "X is the Y" constructions. Empty if none.
- rationale: 1–3 short bullets (under 20 words each).`;
}
