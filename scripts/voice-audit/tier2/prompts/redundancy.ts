import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";

// XCT-1 / ARC-8 / CON-2: each prose field must earn its keep. The hard part is NOT firing on
// coherence: a good read's lens, take, contradiction, and arc all orbit ONE central insight —
// that is exactly what makes it cohere, and it is not redundancy. They differ in JOB and
// ALTITUDE (thesis / argument / unresolved paradox / dramatized scene), so sharing the song's
// core idea is expected. Redundancy is the dead kind: a field reworded from another at the
// SAME altitude with no new angle or concrete content, deletable with zero loss. `lines` is
// deliberately out of scope here — quoting the song's pivotal words echoes the take by nature
// (LIN-8 stays an editorial taste call), and the spine-repetition device (TYP-3) is licensed.
export function redundancyPrompt(a: SongRead): string {
	const arc = a.arc
		.map((beat, i) => `  arc[${i}] [${beat.label} — ${beat.mood}]: ${beat.scene}`)
		.join("\n");

	return `You are auditing whether the PROSE fields of a song read are DISTINCT — whether each earns its keep, or whether two are the same statement so one is dead weight.

First, the thing you must NOT mistake for redundancy. A good read coheres: the lens (thesis), take (argument), contradiction (the one unresolved tension), and arc scenes (concrete dramatizations of each beat) all orbit the SAME central insight. That shared center is COHERENCE, the point of the read — not duplication. These fields are meant to hit the song from different altitudes:
- lens = a short thesis claim.
- take = the 1–3 sentence argument for it.
- contradiction = the single either/or tension the song never resolves, crystallized as a paradox.
- arc scenes = present-moment, concrete dramatizations of individual beats. The take is a whole-song summary, so a scene re-touching something the take mentioned is EXPECTED — the scene's job is to dramatize it with specifics the take did not give.

Sharing the central idea is fine. Sharing a key image, phrase, the song's hook, or even an anchor SENTENCE across fields is fine when the field surrounds it with substantial new content. The take is a whole-song summary, so it often PREVIEWS a beat the arc then dramatizes — the same anchor sentence landing in both is the normal take→scene relationship and the licensed spine-repetition device (TYP-3), not dead weight.

The firing bar is high and nearly binary: flag a field only when it is ESSENTIALLY A COPY of another — strip out what it shares with the other field and almost nothing of substance is left. Adding new concrete material around a shared sentence makes it distinct.

FLAG redundancy (the dead kind) ONLY when:
- a SCENE is essentially nothing but a take sentence reworded — remove the shared sentence and no new concrete moment remains (ARC-8).
- a CONTRADICTION is wholly take sentences (verbatim or reworded) and names no new tension — remove the take overlap and nothing is left (CON-2). A contradiction that crystallizes the take's situation into a fresh either/or paradox is distinct, even in similar words.
- any two prose fields are so nearly identical that deleting one loses no angle, altitude, or detail.

Do NOT flag a field that shares a sentence, phrase, or anchor line with another but ADDS substantial new concrete content — that is dramatization or a deliberate spine echo, not duplication.

Calibration examples (these are real golds — match them):
- PASS: take "...She still fuckin' loves him." + contradiction "He has moved on, and she is still driving the route to his door." — DISTINCT. The contradiction crystallizes the tension and anchors it to the concrete route; no sentence is merely copied.
- PASS: take "...got herself out and was glad of it..." + arc[2] "...she can finally see him for what he is, a man who throws rocks around his own room and lies bleeding in what is left of it. She got out, and she is glad of it. She is also, to her own surprise, sorry it came to this for him..." — DISTINCT. The scene shares the "got out, glad of it" anchor but adds the rock-throwing image and a new turn.
- PASS: take "...drinks through a San Juan night and tells his grandfather he stopped thinking about her..." + arc[1] "He tells his grandfather he stopped thinking about her. Then goes out to drink... until they throw him out. ... Then the music stops. He pulls everyone close for a photo right there inside the song." — DISTINCT. Shares the preview sentences but adds the thrown-out, the music stopping, and the photo.
- FAIL: contradiction "He is probably with that blonde girl who is everything she is insecure about. She still fuckin' loves him." when those are verbatim take sentences and nothing else — REDUNDANT, a wholesale copy.
- FAIL: a final scene that is only "He's finally sane, at peace, with a girl his parents love. And that's the problem." — the take's opening sentence verbatim with nothing added — REDUNDANT.

Longer is not better; do not reward filler. Judge only the prose fields below (not the quoted lines).

READ:
image: ${a.image}
lens: ${a.lens}
tension: ${a.tension}
take: ${a.take}
contradiction: ${a.contradiction ?? "(none)"}
arc:
${arc}

Work in this order — reason first, decide last:
- rationale: 1–3 short bullets (under 20 words each). Compare the fields and weigh coherence vs dead-weight reword before judging.
- redundant_pairs: when not distinct, name each duplicated pair and the near-verbatim overlap, e.g. 'contradiction re-asserts take: "<phrase>"'. Empty array if distinct.
- distinct: decide this LAST. true if each prose field earns its keep. False ONLY if two fields are the same statement at the same altitude with no new angle (dead-weight reword, not coherence or dramatization).`;
}
