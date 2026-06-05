# Hearted Read Spec — voice, grounding & field rules

**The encoded answer key.** This is the single source of truth for what a Hearted song-read
is and how it must sound. It consolidates every taste call, correction, and rule from the
10 collaborative exemplar-authoring sessions (As It Was, Beautiful Things, Blinding Lights,
drivers license, DtMF, Motion Sickness, No Sex for Ben, Not Like Us, Pink Pony Club ×2) into
one place, because the per-session handoff docs that accumulated these rules
(`exemplar-revision-handoff.md`, `-v2.md`, `exemplar-autonomous-revision-prompt.md`) were
lost and never committed.

It serves two jobs:
1. **The target** — the spec the production prompt (`lyrical-v16.ts` → v17+) must encode.
2. **The rubric** — the checklist the pairwise/quality judge scores a candidate read against.

Provenance note: the `session-5.5-*` docs are now partially stale (they predate this work and
describe `lines[].insight`, `arc` 2–6, and a 5-word lens cap, all since changed). Where they
conflict with this doc, **this doc wins.** The 9 hand-revised golds in
`scripts/voice-audit/exemplars/*.json` are the ultimate authority; this doc is downstream of
them. When a gold and this doc disagree, **fix the doc** (the user's standing rule: "the gold
is the truth, the doc is downstream"). This revision was re-audited line-by-line against the 10 raw
authoring transcripts in `.claude/projects/` (one per song, Pink Pony ×2); the verbatim quotes below
are sourced from them.

Related locked artifacts: `src/lib/domains/enrichment/content-analysis/concept-schema.ts`
(shape), `claudedocs/concept-lens-vocabulary.md` (lens grammar + families),
`scripts/voice-audit/tier1/rules.ts` (deterministic gate), `scripts/voice-audit/tier2/`
(LLM judges), and the brand `VOICE-AND-TONE.md`.

---

## 0. The shape (current schema)

From `concept-schema.ts` (`ConceptReadSchema`). Zod is the permissive envelope; this spec is
the narrower target.

| field | type | cardinality | one-line job |
|---|---|---|---|
| `image` | string | ≤ 8 words | the felt image of the song, a thing you can see or hear |
| `lens` | string | 2–6 words | the one buried claim about what the song is really doing |
| `tension` | string | 2 words | the dominant feeling, qualified (`[Modifier] [Emotion]`) |
| `take` | string | 1–3 sentences | the read, written through the lens, present tense |
| `contradiction` | string \| **null** | 1 sentence | the thing the song refuses to resolve; `null` if none |
| `arc` | `{label, mood, scene}[]` | **2–4** beats | the song's emotional turns, in order |
| `lines` | `{line}[]` | 1–5 | the exact quotes a friend would point to; **bare, no gloss** |
| `texture` | string \| **null** | 1 sentence | what the song physically sounds like; `null` if no audio features |

Changes baked in since session-5.5: `arc` max 6 → **4**; `lines` lost its per-line `insight`
gloss (now bare quotes — it restated take/arc, concentrated the voice violations, and the
matching layer never read it); `contradiction` and `texture` made **nullable** (explicit
`null` over silent omission).

Working order for authoring/revision: **take → image → lens → tension → contradiction → arc
(beat by beat) → lines → texture.** (Write the lens *conceptually* first, but draft the take
first because it surfaces the lens.)

---

## 1. The overriding rule: grounding (stay inside the source)

**This was the single most-repeated correction in every session.** It governs every field.

> Every word of every field must be grounded in the **lyrics** or the song's **annotations**.
> Nothing else.

**Never import:**
- Cultural reception — chart position, "song of the summer," "everyone chanted it back," what
  crowds did at shows, awards, the video's real-world impact. (Not Like Us: "how do you know
  that? does the lyrics tell you that? don't go on and make assumptions.")
- Biography or beef history the lyrics/annotations don't state. (Not Like Us: "why are you
  mention stuff not in the lyrics/annotations" — Mustard's alliances, Drake's prior moves.)
- Anything you "just know" about the song from outside.

**Para-textual = flag, never use silently.** Cover art and music video details are not heard.
An annotation may tie them to a lyric, but they stay flagged for human decision. On Not Like Us the
cover art (the sex-offender-map house) and the video (the owl in a cage) were both flagged and both
declined — and even with a cover-art annotation tied to "your homeboy need subpoena," the user chose
a lyrics-only image: **"is it in the lyrics" is the higher bar.**

**Annotations are grounding, but not all annotations are equal — and disclose them.** Three tiers,
established on drivers license:
- **Heard lyric** — always valid, no disclosure.
- **Annotation that interprets the song's imagery** — fair game (drivers license used the "passing
  the test → drive to his house" framing from a Vogue annotation), but when a claim comes from an
  annotation rather than the heard lyric, treat it as annotation-sourced, not smuggled in as if it
  were in the words.
- **Annotation that is real-person biography** (a named real individual, sourced to an interview,
  social post, or rumor) — **banned even though it sits in the annotations.** "He had even taught her
  to drive" came from a Genius annotation, but the annotation was a paparazzi-sourced fact about
  Joshua Bassett — exactly the real-artist biography the rules bar. (drivers license: "'He had even
  taught her to drive' — where is that in the lyrics?" → "so why are you inventing rather than
  creating of the lyrics?") The song's "he" never taught the song's "she" anything on the page.

**The honest reflex.** When challenged "is that in the lyrics?", the honest answer is usually
"I imported it." **Cut it, don't defend it.**

**The one licensed exception is `texture`** — it is grounded in *sound* (audio features +
genre), not lyrics. Even there: "if you cannot hear it, you do not know it" (see §4 texture).

**Pipeline dependency (open):** grounding "in lyrics *or* annotations" is only half-real if the
prod input doesn't include annotations. v16's template interpolates `{lyrics}`,
`{audio_features}`, `{genres}` — no annotations slot. Confirm whether prod lyrics carry
annotations before relying on this rule in production.

---

## 2. Voice & sentence mechanics

The house voice: **a friend who notices music and says what they hear, warmly and with
certainty.** Not a critic filing a report. Talk straight to the person hearing it, as "you."
Let the song act ("It found you. You kept it."). Name feelings in plain words you'd say out
loud. No hedging ("perhaps," "might be"). One exclamation mark at most, ever.

**Hard mechanical rules (deterministic-gated where noted):**

- **One idea per sentence; end with a period.** Two ideas → two sentences. A short fragment is
  fine if it lands ("She's already gone.").
- **Never a comma followed by an `-ing` word.** The most-enforced mechanic. "Synths build,
  pulsing…" → "Synths build. They pulse…". Holds even for `-ing` *adjectives*: "a single,
  exhilarating night" breaks it. (Tier-1: HIGH.)
- **No trailing em dash** that ends a clause abruptly. **Paired parenthetical dashes are
  fine:** "withdrawals — from her, from the high — and the lights…". (User's explicit ruling:
  "if the 2 dashes are inside the same phrase — like this — I think it's acceptable. If it is
  like this — I have zero tolerance." Tier-1 grades by parity: even count = LOW, odd/trailing =
  MEDIUM.)
- **No intra-word hyphens** — two plain words instead ("late night," "neon lit," "coming of
  age").
- **Never open a field with "This is / It is / This song is"** or any framing verb. Start with
  the noun or image.
- **Say what something is. Never "isn't X, it's Y."** The antithesis pivot is an AI tell.
  (Tier-1: HIGH.) **The ban is the *move*, not just the flagged tokens** — drivers license caught
  "drive up to his house, not past his street" as a functional antithesis the regex never saw.
- **Never write "this song / the track / the album / the narrator / the singer / the speaker / the
  listener"** — not once, in any field. Name what's happening. (DtMF: "even the 'the album' is too
  much"; "'the song is three minutes of nothing else.' ??????????")
- **No puffery adjectives** ("blistering," "relentless," "definitive," "haunting,"
  "shimmering," "profound") or their adverbs ("profoundly").
- **No significance-inflation verbs** ("serves as," "represents," "underscores," "highlights,"
  "frames," "acts as").

**Softer voice rules surfaced this round (not all yet gated or prompt-encoded — see §7):**

- **No aphoristic kicker** ending a beat or the take. "The calm is the cruelty." "The ease is
  the menace." → "feels so ai." Let the scene end on movement, not a neat button.
- **The subject is the actor — never the phrase, the metaphor, or "the words."** (As It Was
  burned 5 rounds because "the words" kept *doing* things instead of *him*. Make the person
  act.)
- **Vary sentence openers.** No "he / he / he" (DtMF). Don't open adjacent fields with the same
  word ("She…/She…", Pink Pony).
- **No chained-dots or rule-of-three as a crutch.** "so many dots… sounds ai-ish" (Blinding
  Lights). Use a comma, a colon, or restructure to one sentence. (Rule-of-three is Tier-1 LOW.)
- **Connect the prose; don't fragment it.** The deeper version of the chained-dots rule. "i dont
  understand the urge to break phrases into smaller units" (Motion Sickness); "you are making the
  mistake of ending phrases too soon rather than using the narrative skill" (drivers license).
  Clipped standalone pronouncements ("He is not at the end of it.") sever the connective tissue a
  told story needs. A short fragment that *lands* is fine; a pile of them is the tell.
- **No "and … and … and" chaining.** "'he did this and that' sounds like a baby talking" (Blinding
  Lights). Subordinate the condition ("through everything still blinding him"), don't coordinate it.
- **No mirrored "X is the Y" parallelism.** It manufactures profundity by symmetry. "The proof she
  made it is the proof he is gone" was killed on drivers license against the Wikipedia *Signs of AI
  writing* page. Same family as the aphoristic kicker.
- **Don't rate the song as an object.** Friend-voice tells the song's story from inside it; it does
  not stand outside and grade. "the meanest song you will ever feel — that's not a take of the song,
  the narrative, its just your take" (No Sex for Ben). "embedded without citation" is reviewer-speak
  (Beautiful Things). No "the most danceable song of the year"; no naming the album.
- **A simile must earn its space; watch for a metaphor-family crutch.** "in the voice of someone
  reading a bill out loud. why do you mention this at all?" — and that was the fifth accounting
  metaphor in a row (bill, receipt, ledger, audit, arithmetic) (Motion Sickness). If a figure makes
  the reader stop to picture a literal thing nobody does, cut it.
- **Emotion is a lens, not a headline.** Tuck the feeling into the motion instead of announcing it at
  a sentence's end. "now drives through tears past it" beat "crying" because the grief became the
  medium she sees through, not the label (drivers license).
- **No structural-section names in *any prose* field** — no refrain, verse, chorus, bridge,
  hook, intro, outro, pre-chorus in `take`, `scene`, `image`, or `contradiction`. (As It Was:
  "I don't like how it talks about the structural element (refrain).") Currently editorial-only;
  not gated. (v16's *arc-label* guidance was since fixed to ban "Verse/Chorus/Bridge" outright, but
  its global line 25 still says to write "Pre Chorus" as plain words — resolve that the rule is
  *don't name sections in prose at all*, except this constraint doesn't touch the `lines` array,
  which is bare quotes.)

---

## 3. Interpret, don't describe (the hardest, most recurring battle)

Across *every* song the deepest, most-repeated failure was **recapping the lyrics instead of
telling the song's story.** "You are describing what happens, rather than telling the story."
"This isn't telling the story, check pink pony or dtmf." "Just listing stuff in the lyrics
rather than exploring the overarching themes."

The test for any scene or take: **would this mean something to someone who already knows the
song cold?** If it answers "what happens in the song," it fails. It must answer "what happens
*emotionally* / what the song *means*."

The sharper arc-scene form: **"the person already listened to that"** (Not Like Us). Even real lyrics
quoted back into a scene fail — the listener knows every bar; the scene's job is the emotional turn
underneath, not the recap. The model that works is *cause > effect*: "a beat that lists what happens
is a timeline; a beat that shows what the listing *does to her* is a story" (Motion Sickness). The
flat march "He told her X. He was Y. She does Z." now fails a dedicated Tier-2 check (`recap_scenes`
in the arc-narrative judge).

Two corollaries:
- **Lead with the insight, then the evidence.** The reference is the DtMF take opener: "One
  missed photo of a girl and suddenly he understands he has been missing everything." Inventory-
  first prose ("the receipts, then the point") is the tell of safety-seeking — the model leads
  with grounded facts to avoid getting caught importing, and the result reads like an annotated
  lyric list.
- **The reliable unlock is the golds themselves.** In session after session, abstract rules
  didn't fix recap; showing the model a *finished* gold (DtMF, Pink Pony) and having it match
  the sentence structure did. The prod prompt should carry a worked example; the judge should
  compare against the golds, not just a rubric.

---

## 4. Field-by-field spec (with worked examples from the golds)

### image — the felt moment
A concrete sensory phrase, ≤ 8 words, lowercase first word, no closing period. The *felt image*
of the song, **not** a description of its sound (sound is texture's job).
- **A single coherent moment.** Don't fuse two images with opposite motion ("crying through the
  suburbs" + "red lights, stop signs" — "doesn't work the fusion": one is continuous motion, one
  is a frozen halt).
- **Grounded, not constructed atmosphere.** "the phone ringing in an empty room" failed — "empty
  room" is imported; nothing says the room is empty.
- **Carry the emotional fact, not just the place.** "las vegas at 4am is just descriptive of the
  place, doesn't capture the image… by mentioning the absence" (Blinding Lights) → `Sin City lit and
  no one in it`. And prefer the loaded shorthand: "i prefer sin city rather than las vegas."
- **Image and lens must not do the same work.** When both reached for the photo, DtMF moved the image
  off it (`a san juan he is finally looking at`) and left the photo to the lens. Two fields on one
  metaphor means one is dead.
- **A bare heard line is often the strongest image.** `psst. i see dead people` (Not Like Us),
  `no sex for ben` (No Sex for Ben), `come on, harry, we wanna say goodnight to you` (As It Was).
- House style is all-lowercase even for proper nouns (`no sex for ben`).
- Examples on disk: `Sin City lit and no one in it`, `outside the glass, watching him bleed in
  it`, `a san juan he is finally looking at`, `holding on tight, sure it's all on loan`.

### lens — the one buried claim
2–6 words, lowercase (proper nouns aside), in **exactly one of three forms**:
- **`X as Y`** (also `X of Y`, `X with Y`) — the critical form: the song is really Y.
  `license as eulogy`, `blessing as a loan`, `silence as the grief he allows`.
- **`X into Y`** — the transformation form.  `insult into anthem`, `numbing into motion`.
- **`Verb-ing the X`** — the narrative form, when the motion is the meaning.
  `freezing the creep out`, `missing the person you escaped`, `finding your way home by leaving`.

Rules: Y must be **concrete and picturable** (a eulogy, a loan, a block party, a ghost), never a
feeling/quality (precarity, isolation, devotion). A lens is a **claim, not a category** — never a
mood word, never a bare-noun tag ("heartbreak," "freedom"), never an abstract summary noun as Y
("journey," "tapestry," "declaration," "meditation," "anthem" except as the output of an "into"
turn). Test: you must be able to say "this song treats X as Y, because…" in one breath. Cap is
**6 words** (bumped from 5 — `finding your way home by leaving` reads more Hearted at 6); treat
it as a **ceiling, not a target** ("if you need 7, you're describing"). Full grammar + family
seeds in `concept-lens-vocabulary.md`. The "as" connector is *correct grammar, not an AI tell*
(a mid-session detour wrongly flagged it on Not Like Us, replacing a valid Form-1 lens with a bare
noun phrase — "DO NOT do what I did last time… the connector is required").

**The take must genuinely argue the lens** (the `check-lens-coherence.ts` frontier). On Motion Sickness
the canonical seed `anger with receipts` lost to `missing the person you escaped` because the take and
image were already arguing the latter — coherence beats the answer-key seed. Corollary: **a
vocabulary-doc seed can be wrong for the actual read; the gold outranks the doc** ("that doc is not
truth"; Motion Sickness, No Sex for Ben, and As It Was all departed from their seeds). And the lens
may stay abstract/poetic *when image and take already carry the explicit content* — Pink Pony's
`finding your way home by leaving` holds the paradox without spelling out the queer reading, because
image and take name it outright.

### tension — the qualified feeling
Exactly two words, `[Modifier] [Core Emotion]`, each capitalized. The dominant feeling named
precisely — **the feeling, not the paradox** (the paradox is contradiction's job; don't restate
it). **Don't overstate the weight:** "Cruel Glee" → `Mocking Glee` (the harm is tiny);
"terror" → `Blessed Unease` (the modifier matches what the song actually does, not the most
dramatic option). On disk: `Aching Disbelief`, `Hollow Euphoria`, `Withheld Grief`, `Unrepentant
Joy`, `Aching Warmth`. Two more calibrations: the compound must hold the **whole arc, not just the
landing** ("Grounded Joy" → `Aching Warmth` because "most of the song is a bit more melancholic" —
DtMF); and the core word must be a real **emotion, not an act** ("Desperate Prayer" rejected — prayer
is an act; a single word like "Nauseated" also fails the two-word rule). Don't let `tension` duplicate
an `arc` mood verbatim ("Hollow Brightness" was both, in As It Was — one had to go).

### take — the read
1–3 sentences, present tense, written **through the lens**, leading with the insight.
- **Scale to the song's real depth.** A layered song earns three sentences; a surface-true one
  earns a single sentence. "the take is almost bigger than the lyrics" (No Sex for Ben) is a
  failure as much as under-reading a deep song.
- **Close on the song's own image or word, not a thesis button.** DtMF lands on "This time he
  takes the photo." (echoes the title); As It Was on the repeated lyric itself.
- A voiced turn like "And that's the problem." is allowed in friend-voice (Beautiful Things).

### contradiction — the open knot
One sentence naming what the song refuses to resolve — true on both sides at once — **with no
resolution.** It must say something **no other field says** (if it restates the take or lens,
it's dead). **`null` is the honest, preferred call for a song at peace with itself** (No Sex for
Ben). Never manufacture one to fill the field. Don't close it with a thesis ("The joy and the
grief belong to each other" was rejected as too resolved). On disk: "What left taught him how to
hold what remains.", "The one thing he will not say becomes the only thing left." Two process notes:
tying the knot to the song's **central concrete anchor** sharpens it ("if we could tie to the driver
license/driving would be nice" → "He has moved on, and she is still driving the route to his door");
and a **wide generation pass pays off even when nothing lands live** — Not Like Us's winning
contradiction was an earlier rejected draft the user recognized and quoted back rounds later.

### arc — the emotional turns
2–4 beats, **most songs earn 3**; reserve 4 for a true four-movement song; **2 for a chant or
a one-mood track.** Count the song's *real emotional turns, not its sections.* Never pad to the
max to look thorough.
- **`label`** — the emotional *event*, not the song structure: `The Reckoning`, `The Way Out`,
  `His Excitement`, `The Freeze`. **Never `Verse` / `Chorus` / `Bridge`.** The house form is
  `The [event]` — a short noun naming the beat's turn, distinct from the `mood` (which holds the
  feeling). All 9 golds now comply: `pink-pony-club.json` was relabeled from `Verse / Chorus /
  Bridge` to `The Pull / The Arrival / Holding Both`.
- **`mood`** — 2–3 words. **May repeat across beats** — a monochrome song has structure without
  changing register, and naming the same mood twice is honest (Beautiful Things).
- **`scene`** — one+ complete sentence that puts you *inside* the moment. The recap ban (§3)
  bites hardest here. The subject acts; no aphoristic kicker; no comma+`-ing`. The model that
  works: short concrete sentences plus one genuine felt turn per beat (DtMF is the reference).

### lines — the quotes
1–5 **exact** quotes, each an object `{ line }`, **no gloss or explanation** (the take and arc
already carry the reading; the line speaks for itself). Each line lands a *distinct* hit — a
one-idea song earns one line; padding to five weakens it.
- **Order by position in the song; span its emotional range** (Motion Sickness was reordered and
  a missing verse added).
- **Foreign-language lines: quote the original, then an inline parenthetical English gloss** —
  `"Debí tirar más fotos (I should have taken more photos)"`. Natural translation, not
  word-for-word.
- A line may carry a `\n` to quote a couplet ("I got my driver's license last week\nJust like
  we always talked about").
- The `lines` array is exempt from all prose rules (bare quotes; intra-quote punctuation is the
  artist's).
- **Memorability can outrank decodability.** Not Like Us kept "it's probably A minor" over the model's
  objection that the pun might not land — "thas a memorable line." Line selection is a taste call.
- **Dedup against image/take/arc.** Don't quote a line another field already spends (As It Was pulled
  "as it was" from `lines` because the take and a scene already carried it).

### texture — the sound (the one sound-grounded field)
**Write ONLY when the input provides audio features; return `null` otherwise** (the panel hides
the block rather than let the model hallucinate a sound from the words). One sentence on what the
song physically sounds like — instruments, production, feel — **turning on a contrast by its
end** (made with a comma or a second sentence, never a trailing dash).
- **Ground it in the data.** Audio features are the sound; genre (`song.genres`, *not* memory)
  sharpens the words. Hard-won data lessons:
  - `acousticness ≠ a specific instrument` ("how do you know it's piano?" — it doesn't).
  - genre comes from the DB, not prior knowledge ("indie rock" was wrong; data said "indie
    folk").
  - **a human gold can be wrong about sound too** — "propulsive" was corrected to "unhurried"
    when the data showed 107 BPM / energy 0.55.
  - **don't assert *dynamics* (a build, a swell, a drop) from static averages** — drivers license cut
    "a ballad that grows a spine" because a single mean can't show whether the song rises (and cut
    "piano": annotation-sourced, not in the features).
- "Never infer the sound from the lyrics: if you cannot hear it, you do not know it."
- **End on an image; cut the slowing list.** DtMF dropped "güiro and hand drums" so the sentence could
  land on "a party already turning into a memory."
- This field carries the **tempo-vs-emotion gap** (bright sound over dark words — recurs across four
  golds: As It Was, Blinding Lights, No Sex for Ben, Motion Sickness): "engineered to sound like joy
  and ringing hollow underneath each hook."

---

## 5. Song-type playbook

The golds were deliberately chosen to span variance. Match the read to the type:

- **Surface-true / chant** (No Sex for Ben) — short take (1 sentence), 2–3 beats, few lines,
  `contradiction: null`. Plain is not generic: keep the song-specific anchors (names, the
  hook), just don't inflate. Don't import depth (no REVENGE backstory onto a SURFACE song).
- **Foreign-language** (DtMF) — inline gloss on lines (§4). **Lead with the specific cultural /
  diaspora reading**, don't gesture at a generic "leaving home" frame; name the regional
  specifics the song is actually about (the communal fear of "ojalá que los míos nunca se
  muden"). Place-names that mean nothing to an outsider either get one phrase of context or get
  replaced ("Santurce" → "a San Juan night"). The lens is always written in English.
- **Monochrome / one deep mood** (Beautiful Things) — repeated mood across beats is correct, not
  a defect. Load-bearing thematic word repetition ("take," "lose") is earned.
- **Two-act narrative** (Pink Pony) — ARRIVAL family holds both leaving and landing. Name the
  real axis (the queer reading); don't euphemize into "finding home." Interpret the bridge,
  don't restate it.
- **Tempo-vs-emotion gap** (As It Was, Blinding Lights) — the bright-sound/dark-words contrast
  lives in `texture`'s contrast clause.

---

## 6. Coverage map — what v16 encodes vs. the v17 gaps

As of `lyrical-v16.ts` on 2026-06-05. This section dates; the rules above don't.

**Already in v16 (✅):** grounding for texture only; all of §2's hard mechanics (comma+`-ing`,
dashes, intra-word hyphens, "This is" openers, antithesis, "this song/narrator/speaker,"
puffery, significance verbs, ≤1 "!"); warm "you" voice + let-song-act; lens grammar (3 forms,
concrete Y, families, ≤6 words, lowercase); image basics (≤8 words, felt not sound, lowercase,
no period); tension (2 words, feeling not paradox); take (1–3 sentences, lead with insight, match
depth); contradiction (nullable, open, don't manufacture); arc (2–4, most earn 3, emotional
labels, mood may repeat); lines (1–5 bare quotes, distinct, no gloss, inline foreign gloss);
texture (nullable, audio-feature-grounded, genre sharpens, contrast ending, no trailing dash);
permission to be brief / surface-true.

**Gaps to close in v17, in priority order (❌ / 🟡):**
1. **The grounding rule, global** (§1) — the #1 omission. Only texture is grounded today.
2. **No structural-section names in any prose field** (§2) — and resolve v16's "Pre Chorus"
   line.
3. **No aphoristic kicker** ending beats/take (§2).
4. **The subject is the actor, never the phrase/metaphor** (§2).
5. **Vary sentence openers**, within and across fields (§2).
6. **Strengthen the recap ban** in arc + take — interpret the turn, don't recount bars (§3).
7. **Image discipline** — one grounded, coherent felt moment; no fused images, no imported
   atmosphere (§4).
8. **Specificity** — the exact named detail, never the euphemism/category. This *is* the
   session-5.5 judge frontier ("what girls? be specific" → "hide your lil' sister").
9. **Foreign-language/cultural** — lead with the specific cultural reading (§5).
10. **Minor:** tension shouldn't overstate weight; lines ordered by song position.

Discipline for building v17: **new version file, register it in `registry.ts`, keep v16
pristine as the control.** Don't flip `ACTIVE_LYRICAL_VERSION` (still "13"); the prod cutover
(active flip + `song-analysis.ts` parse to `ConceptReadSchema` + jury swap) is separate
"Session 6" work.

---

## 7. Process lessons (how the collaboration worked)

For both the autonomous first-draft prompt and the human-in-the-loop revision flow, and for any
researcher iterating prompts against these golds:

- **Diagnose before re-throwing options.** When the user says "none land," the move that worked
  was the model naming *why* its options keep failing (often: centering emotion instead of a
  concrete moment; recapping instead of interpreting) before generating more. Throwing fresh
  darts in the same register wastes rounds.
- **When confused, cut — don't explain.** A metaphor that needs explaining has already failed
  (As It Was beat 3).
- **Establish lyric agency before writing.** Who holds the power, in which direction? "hands that
  won't let go" inverted a song that's about something being *taken* from him (Beautiful Things).
- **Each field must earn its keep.** If two fields say the same thing, one is dead — cut the
  redundancy. This bit constantly: take vs contradiction (Beautiful Things, As It Was), tension vs
  arc-mood (As It Was), image vs lens (DtMF), and a `lines` quote the take/arc already used (As It Was).
- **Communication preference:** "be direct and terse… show current, and 3 options for it… one
  decision at a time." Present the current value, 3 alternatives, and a recommendation.
- **The user co-authors, not just picks.** Several winning lines were the user's own words: "Just the
  same three words — as it was — again and again" (As It Was), "now drives through tears past it"
  (drivers license), the Pink Pony take-merge and bridge brief. When options keep missing, the user
  may hand you the line; fold it in and say specifically why it works.
- **The gold outranks the vocabulary doc — including its lens seeds.** "that doc is not truth." Where a
  seed lens and the song's actual read diverge, follow the read.
- **Shared diagnostic: the Wikipedia *Signs of AI writing* page.** The user pointed the model at it on
  drivers license, Motion Sickness, and No Sex for Ben instead of explaining the tell — it reliably
  surfaced list-stuffing, mirrored parallelism, rule-of-three, and significance-explainers in one pass.
- **"Properly done" = `bun run test` green, not just `--tier 1`.** The CLI gate (0 HIGH, ≤2
  MEDIUM) and the full Vitest suite are different standards; the suite enforces gold-specific
  constraints (`exemplars.test.ts`). Run both before calling a read done.
- **Single source of truth for any rule number.** The lens cap lived in 4+ places (vocab doc ×3,
  prompts ×3, `rules.ts` comment, test) and drifted. Update every copy together. This doc is now
  the rule-of-record; code/prompt are downstream.
- **Reproducibility caveat:** v13/v14/v15 were edited in-place to bump lens cap 5→6 and arc 6→4,
  so old experiment JSONs were generated under different rules. Old v14/v15 numbers are no longer
  clean baselines — re-baseline on v16 against the 9 revised golds before comparing.

---

## 8. The 9 golds at a glance (the reference reads)

`scripts/voice-audit/exemplars/*.json`, keyed by `spotifyTrackId` (4 use a stable slug).
Lyrics + Genius annotations live in `scripts/voice-audit/exemplars/lyrics/*.json`.

| key | song | lens | tension | arc · lines | variance it covers |
|---|---|---|---|---|---|
| not-like-us | Kendrick — Not Like Us | the diss as cultural eviction notice | Collective Contempt | 3 · 5 | name/beef-dense; hardest grounding test |
| drivers-license | Olivia Rodrigo | license as eulogy | Aching Disbelief | 3 · 4 | grief ballad; texture from DB |
| blinding-lights | The Weeknd | freedom that turns out to be absence | Hollow Euphoria | 3 · 4 | bright synth / lonely lyric |
| motion-sickness | Phoebe Bridgers | missing the person you escaped | Helpless Longing | 4 · 5 | texture hallucination case; 4-beat |
| dtmf | Bad Bunny | the photo as the only way to hold what leaves | Aching Warmth | 3 · 4 | foreign-language + diaspora reading |
| no-sex-for-ben | The Rapture | freezing the creep out | Mocking Glee | 3 · 4 | surface-true chant; `contradiction: null` |
| beautiful-things | Benson Boone | blessing as a loan | Blessed Unease | 3 · 5 | monochrome deep dread; repeated mood |
| pink-pony-club | Chappell Roan | finding your way home by leaving | Unrepentant Joy | 3 · 4 | two-act ARRIVAL; queer reading |
| as-it-was | Harry Styles | silence as the grief he allows | Withheld Grief | 3 · 4 | tempo-vs-emotion; refusal/withholding |

---

## 9. Judge rubric (scoring a candidate read)

A candidate read passes "reads like Hearted" when it clears, in order:

1. **Grounding (gate).** Every claim traces to a lyric or annotation. Any imported reception,
   biography, or sound-from-words → fail. (Texture excepted: must trace to audio features/genre.)
2. **Voice mechanics (gate).** No comma+`-ing`, no antithesis (the *move*, not just the tokens), no
   "This is" opener, no self-reference ("this song/the album/narrator/speaker"), no trailing dash, no
   puffery/significance verbs, ≤1 "!". Editorial-only adds: no mirrored "X is the Y", no fragmented
   pile-ups, no rating-the-song-as-object. (Tier-1 `rules.ts` automates most of the gated set — free,
   run it first.)
3. **Interpret-not-describe.** Take leads with the insight; arc scenes render the emotional turn, not
   a recap — "the person already listened to that." No aphoristic kickers. Subject is the actor.
4. **Field correctness.** Lens in-grammar + concrete Y + ≤6 words; tension a 2-word qualified
   feeling that isn't the paradox; contradiction open and non-redundant (or honest `null`); arc
   2–4 with emotional labels and real turns; lines bare/distinct/in order; texture data-grounded
   with a contrast (or `null`).
5. **Specificity vs. gold (the frontier).** Where the gold names the exact noun/detail, the
   candidate should too, not the category. This is where v14/v15 lost to gold — pairwise-judge
   the candidate against the matching gold (free local Opus CLI) and read the *rationale*, not
   just win/tie/loss.

Loop commands live in `scripts/voice-audit/` (`regen.ts`, `evaluate.ts`,
`report-experiments.ts`, `check-lens-coherence.ts`).
