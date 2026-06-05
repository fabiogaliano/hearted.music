import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

// The priority-1 judge (GRD-1/2/3/6, IMG-3). It closes the specificity/grounding loss that
// beat v14/v15: a read may only say what the writer could have heard. Unlike the pairwise
// judge — which is deliberately told to USE its own knowledge of the song to test
// specificity — this judge must do the opposite: judge ONLY against the lyrics and the
// vote-gated annotations handed to it, and treat anything it merely "knows" about the song
// as ungrounded. Outside knowledge is the failure mode it exists to catch.
//
// `heardLyrics` is the full heard text; `annotationsBlock` is renderAnnotationsBlock() over
// the > 15-vote selection (may be "" — many songs have none, and that is fine).
export function groundingPrompt(
	a: ConceptRead,
	heardLyrics: string,
	annotationsBlock: string,
): string {
	const arc = a.arc
		.map((beat) => `  - [${beat.label} — ${beat.mood}] ${beat.scene}`)
		.join("\n");
	const lines = a.lines.map((l) => `  - "${l.line}"`).join("\n");
	const annotations = annotationsBlock.trim()
		? annotationsBlock
		: "(no annotations cleared the vote gate for this song)";

	return `You are auditing whether a song read is GROUNDED — whether every claim it makes traces to evidence the writer actually had in front of them.

The writer had exactly two sources, and so do you:
1. THE HEARD LYRICS (below).
2. THE ANNOTATIONS (below) — fan/editor notes that cleared a vote gate (> 15 votes). These are trusted evidence: anything an annotation states is grounded, INCLUDING real-person biography, history, or beef the lyrics never spell out.

Judge ONLY against those two sources. This is the hard part: you may personally know this song, its artist, its chart history, the music video, what a crowd did with it. **You must not use any of that.** If a claim is true in the real world but is not supported by the heard lyrics or a provided annotation, it is UNGROUNDED. Outside knowledge leaking into the read is the exact failure you are here to catch.

A claim IS grounded when it:
- quotes or paraphrases a heard lyric, OR
- is a fair interpretation of what the lyrics say or imply. The read's job is to interpret feeling and meaning, not to recite — so emotional, psychological, and thematic claims about the heard content are grounded even though they are not stated literally ("he enters already having won" reading swagger; "the more he has, the more terrified he gets" reading the lyric's dread). Interpretation is allowed; importing facts is not.
- traces to a provided annotation (check the annotations before flagging any biography, place, or backstory).

FLAG a claim as ungrounded when it is:
- **Imported reception** (GRD-2): chart position, "song of the summer", sales/streams, awards, going viral, what a crowd or audience did, the song's or video's real-world impact or legacy.
- **Imported biography or beef** (GRD-3): real-person facts, alliances, prior career moves, relationships, who-dissed-whom — UNLESS a heard lyric or a provided annotation states it. (Names and relationships the lyrics or annotations supply are fine.)
- **Constructed atmosphere** (IMG-3): a wholly NEW physical place, object, or weather, fabricated as fact, that the song never references at all — e.g. a "rain-soaked parking lot" in a song with no rain and no parking lot. This is the narrowest check and fires only on an invented SETTING. It must be a high bar, because the read's job includes rendering the song's stated feeling as physical atmosphere, and that is grounded interpretation, NOT an import. Do not fire on:
  - the song's stated EMOTION rendered as atmosphere — solitude ("I drive alone past your street") rendered as "the empty road"; sleeplessness till sunrise rendered as "4 a.m.". The feeling is heard; the atmosphere is its fair picture.
  - a later beat whose atmosphere differs from an earlier one — songs MOVE (drivers-license goes from seeing him everywhere in traffic to alone on his empty street). A closing "empty road" does not "contradict" earlier traffic; it is the arc landing.
  - "empty"/"alone" framing when the lyric states the solitude.
  Only flag a place/object/weather that is genuinely absent from the song AND not a rendering of any stated feeling.
- Anything else the read could only "know" from outside the song.

Do NOT flag:
- **texture** — it is grounded in the SOUND (audio features + genre), not the lyrics, by design (GRD-8). It is shown only for context; never list it as ungrounded.
- Anything an annotation supports, even if the lyrics alone do not.
- A reasonable emotional/interpretive reading of heard content (see above). Interpretation is the job, not a violation.

Separately, PARA-TEXTUAL material (GRD-5): if a field leans on the COVER ART or the MUSIC VIDEO (a visual nothing in the lyrics describes), do not auto-fail it — list it in paratextual_flags for a human to decide. It does not by itself make the read ungrounded.

=== THE HEARD LYRICS ===
${heardLyrics}

=== THE ANNOTATIONS (vote-gated, trusted) ===
${annotations}

=== THE READ TO AUDIT ===
image: ${a.image}
lens: ${a.lens}
tension: ${a.tension}
take: ${a.take}
contradiction: ${a.contradiction ?? "(none)"}
arc:
${arc}
lines:
${lines}
texture (CONTEXT ONLY — grounded in sound, do not flag): ${a.texture ?? "(none)"}

Return a JSON object. Every array element must be a PLAIN STRING (not a nested object):
- grounded: true if every claim (outside texture) traces to a heard lyric, a fair interpretation of one, or a provided annotation. False if any claim imports reception, biography, or atmosphere the sources do not support.
- ungrounded_claims: array of strings. When not grounded, each string quotes one imported claim and says what it imports, e.g. 'reception: "the song everyone screamed that summer"' or 'biography: "his label dropped him" — not in lyrics or annotations'. Empty array if grounded.
- paratextual_flags: array of strings — any field that leans on cover art / music video, for human review. Does not affect grounded. Empty array if none.
- rationale: array of strings — 1–3 short bullets (under 20 words each).`;
}
