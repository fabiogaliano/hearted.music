# Prompt v13 → v14 — Comparison Notes (Session 4)

**Date:** 2026-05-29 (Session 4)
**Produces:** `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v14.ts`
**Status:** v14 registered in `prompts/registry.ts` as a selectable draft. **v13 stays active.** See §5 for why.
**Reads alongside:** master §5.2 / §6.2, `session-3-zod-migration-notes.md` §6, `concept-lens-vocabulary.md`, `schema-overprescription-lyric-diagnostic.md`.

---

## 1. What changed, at a glance

| Dimension | v13 | v14 |
|---|---|---|
| Output shape | 8 flat fields (`headline`, `compound_mood`, `mood_description`, `interpretation`, `themes`, `journey`, `key_lines`, `sonic_texture`) | the `read` model (`image`, `lens`, `tension`, `take`, `contradiction`, `arc`, `lines`, `texture`) = `ConceptReadSchema` |
| Organizing idea | none — eight parallel claims | the **lens** is the thesis, generated first; everything else is evidence for it |
| `compound_mood` → `tension` | "the specific tension" (primed paradox) | qualified emotion (modifier + core), **explicitly not** the paradox |
| `interpretation` + `mood_description` → `take` | two fields, fixed ~3 sentences | one field, **elastic 1–3 sentences**, matched to depth |
| `journey` → `arc` | 4–6 beats, assumes movement | **2–6 beats, mood may repeat**, do-not-manufacture-movement |
| `key_lines` → `lines` | 3–5 | **1–5**, do-not-pad; foreign-language gloss convention |
| `contradiction` | did not exist | one sentence **or null**; null when none |
| `headline` → `image` | 1–2 sentences | ≤8-word phrase, lowercase, no terminal period |
| `themes` | in presentation | gone from the read (moves to `signals.themes` later) |

**What carried over verbatim** (the proven, field-agnostic voice rules — the brief's "iterate, don't rewrite" instruction): the entire HOW TO WRITE block (one-idea sentences, the comma+`-ing` ban, the no-dashes rule, the no-framing-opener rule, the "say what it is not what it isn't" rule, the no-"this song"/"the narrator" rule, the warm second-person voice) and the closing puffery/inflation ban. These were the substance of v11→v13 and there is no reason to disturb them.

**What is genuinely new** (and therefore where the risk lives): the `lens` instruction, the lens-first generation order, and the diagnostic's permission-to-be-brief rules.

---

## 2. Every read field has a spec; every diagnostic recommendation is a rule

Acceptance-criterion check — `ConceptReadSchema` field → where it is specified in the template:

| Field | Spec present? | Key constraint encoded |
|---|---|---|
| `image` | yes | ≤8 words, lowercase first word, no terminal period, felt-image not sound |
| `lens` | yes | 2–5 words, three forms, 11 families, abstract-noun kill-list, defensible-in-one-breath, English always |
| `tension` | yes | two words, Title Case, qualified emotion, **not** the paradox |
| `take` | yes | 1–3 sentences, through the lens, matched to depth |
| `contradiction` | yes | one sentence or **null**; do not manufacture |
| `arc` | yes | 2–6 beats, `{label, mood, scene}`, mood may repeat, don't manufacture movement |
| `lines` | yes | 1–5, `{line, insight}`, don't pad, foreign-language gloss |
| `texture` | yes | one sentence, contrast-ending, **no dashes** |

Diagnostic recommendations 1–8 → rule in the template:

1. `tension` = qualified emotion, not paradox → tension spec ("This is the feeling, not the paradox").
2. `take` elastic + match depth → take spec ("a layered song earns three sentences, a surface-true one earns a single sentence").
3. `lens` surface/descriptive register → SURFACE family named in the lens spec + the PERMISSION TO BE BRIEF block.
4. `arc` flat-mood, floor 2, mood may repeat → arc spec ("The mood may repeat across beats… Do not manufacture movement").
5. `lines` floor 1 → lines spec ("One is enough for a one-idea song. Do not pad to a quota").
6. Cross-cutting permission to be brief/flat → the dedicated PERMISSION TO BE BRIEF block.
7. Foreign-language `lines` convention → lines spec ("quote the original and follow it with a parenthetical English gloss").
8. `lens` journey family → ARRIVAL named in the families list ("the two-act journey, holds both leaving and landing").

---

## 3. The four gold songs through v14

These are the existing hand-written reads (`concept-data.ts`). The point here is that v14's rules *reproduce* them — they are the target, and the prompt must not reject them.

- **drivers license** — `lens: license as eulogy` (GRIEF, Form 1). `tension: Aching Disbelief` (qualified emotion, not the paradox). `contradiction` present ("She got everything she wanted. She got it alone."). arc = 3 beats, lines = 2 — both inside the new floors, both **below** v13's old `journey ≥ 4` / `key_lines ≥ 3` minimums. v13 would have pushed for a fourth beat and a third line here; v14's lowered floors let the read stay as tight as it actually is.
- **Not Like Us** — `lens: diss as block party` (DEFIANCE, Form 1). arc = 6, lines = 4 — the rich end of the envelope; v14 aims 4–6 / 3–5 and hits it.
- **Motion Sickness** — `lens: anger with receipts` (AMBIVALENCE, Form 1 with `with` connector). `contradiction` is the textbook two-truths-at-once ("She hates him… and misses him anyway."). arc = 3, lines = 2.
- **Blinding Lights** — `lens: speed as avoidance` (ESCAPE, Form 1). `contradiction`: "The thing that thrills him is the thing keeping him blind." arc = 3, lines = 2.

All four lenses are Form 1, concrete `Y`, ≤4 words, defensible in one breath. None trips the abstract-noun kill-list. The four reads validate against `ConceptReadSchema` today (Session 3's tests confirm), and nothing in v14's prompt rules would steer the model away from them.

---

## 4. The stress songs — showing the new rules fire

These are the diagnostic's hard cases. They are where v13's contract broke and where v14's new rules earn their place. Reads below are reasoned from the lyric reality recorded in the diagnostic, not generated.

### 4a. Surface-true: **Forever** (Chris Brown)

Lyric reality (diagnostic): pure dancefloor euphoria, one idea, no subtext.

- **lens** → SURFACE family, Form 3: `moving for the joy of moving` (or Form 1 `dancing to feel the room`). The PERMISSION block routes the model here *before* it reaches for a borrowed-depth lens like "escape as avoidance" — which would be smuggling ESCAPE onto a song that isn't fleeing anything (the vocabulary's most load-bearing do-not-use).
- **tension** → `Open Euphoria`. A qualified emotion, no paradox manufactured.
- **take** → one sentence. "A floor-filler that wants nothing more than the next eight bars and the body next to you." The depth-matching rule explicitly licenses stopping there.
- **contradiction** → **null**. The "do not manufacture one" rule fires.
- **arc** → 2 beats (`Build` → `Release`), mood close to flat. The floor-of-2 rule is what makes this legal; v13's `journey ≥ 4` would have forced two invented beats.
- **lines** → 1. The floor-of-1 rule; v13's `≥ 3` would have padded.

**This is the case v13 could not express.** Every relaxed floor (arc 2, lines 1, take 1, contradiction null) is exercised at once. If any one of them were still a hard minimum, the model would fabricate to satisfy it.

### 4b. Monochrome-deep: **Beautiful Things** (Benson Boone)

Lyric reality (diagnostic): real, specific depth ("there's no man as terrified as the man who stands to lose you"), but both verses sit in one register — grateful + anxious — with no movement.

- **lens** → CONFESSION, Form 1: `terror dressed as gratitude`. Depth is real, so the lens is a genuine claim, not a SURFACE descriptor. **The model must not lazily tag this SURFACE** — the diagnostic's inverse failure. (The future `lens-coherence` judge, Session 5, is the backstop here.)
- **tension** → `Grateful Terror`. Qualified emotion.
- **take** → 2–3 sentences. The depth is real, so the take stays full. **This is the field that decouples from `arc`.**
- **contradiction** → present: "He has everything he wanted, and that is exactly what terrifies him."
- **arc** → 2 beats, **mood repeats** (`Tender Dread` → `Tender Dread`). This is the precise case the "mood may repeat" rule exists for: structure without register change.

**The lesson v14 encodes:** depth and movement are independent axes. A deep-but-still song gets a full `take` *and* a short, flat `arc` at the same time. v13 conflated the two (a long interpretation implied a moving journey); v14 lets them diverge.

### 4c. Two-act narrative: **Pink Pony Club** (Chappell Roan)

Lyric reality (diagnostic): Tennessee (captivity/expectation) → West Hollywood (arrival/chosen identity), with a bridge that refuses to repudiate home ("Still love you and Tennessee").

- **lens** → ARRIVAL, **Form 2 or 3** to span both acts: `leaving as homecoming` or `becoming who you fled toward`. A Form-1 single thesis ("escape as freedom") would collapse one act into the other — exactly the diagnostic's Pattern B failure. The ARRIVAL family + the directional forms are the fix.
- **tension** → `Defiant Homesickness`.
- **take** → 3 sentences. The two-act structure earns the full length.
- **contradiction** → the bridge, textbook Pratfall: "She found where she belongs without ever stopping loving where she left."
- **arc** → 5–6 beats — `arc` *thrives* here; it was never the broken field. The diagnostic's finding holds: on narrative songs the arc is rich and it is the *lens* that was under-specified, now fixed by the ARRIVAL family.

### 4d. Foreign-language (bonus): **DtMF** (Bad Bunny)

Not one of the three required stress cases, but it is the only place rule 7 fires, so it is worth showing once.

- **lens** → AMBIVALENCE, Form 2: `nostalgia into a party` (or the vocabulary's `nostalgia as a party trick`). **Written in English**, per the lens spec's language rule.
- **lines** → original + gloss: `"Debí tirar más fotos (I should have taken more photos)"`. The lines spec's foreign-language convention produces exactly the diagnostic's Pattern A fix — the original keeps the music of the line, the gloss keeps it legible.

---

## 5. The activation decision (and why v13 stays live)

**v14 is registered but not active.** `getLyricalPrompt("14")` resolves; `ACTIVE_LYRICAL_VERSION` is still `"13"`.

The reason is structural, not cautious: `song-analysis.ts:113-115` selects the parse schema by *modality* (`SongAnalysisLyricalSchema` for lyrical, `SongAnalysisInstrumentalSchema` for instrumental), **not by prompt version**. `generateObject(prompt, schema)` then validates the model's JSON against that hardcoded schema. Flip the active version to "14" and the model would emit `read`-shaped JSON (`lens`, `arc`, `contradiction`, …) into a parser expecting `headline`/`journey`/`themes` — every lyrical analysis would fail Zod validation. The voice-audit jury (`exemplars.ts::loadGoldExemplars` → `SongAnalysisLyricalSchema`) is old-schema for the same reason (master §8.5).

So the cutover is a coordinated change, not a one-line version bump. It belongs to Session 5/6:

1. Teach `analyzeSong` to pick `ConceptReadSchema` when the active lyrical version is ≥14 (or store `{ read }` and branch on `prompt_version`).
2. Re-point the jury loader + judges at the new shape (Session 5's voice-audit migration).
3. Decide the `signals` generation path (still unbuilt — `theme_tags` vocab does not exist yet).

Until those land, shipping v14 as a selectable draft is the correct, non-breaking state. The brief sanctioned exactly this ("if in doubt, leave v13 active, ship v14 as draft, hand the cutover to Session 5/6").

---

## 6. Discoveries worth flagging (not schema changes)

Per master §8.3, anything that pushes back on a locked decision gets surfaced, not silently absorbed. Two things came up. **Neither is a schema problem; both are notes for Session 5.**

1. **The gold `texture` strings use em-dashes that v14's voice rules forbid.** Three of the four gold reads in `concept-data.ts` punctuate the texture's contrast with a dash ("A ballad that grows a spine — sparse piano…"). v13/v14's no-dash rule is locked and proven, so the prompt produces the contrast with a comma or a second sentence instead. **Consequence for Session 5:** when the gold reads are promoted into the voice-audit exemplar set, their textures (and any other dashed strings) must be normalized to the no-dash form, or they will fail the Tier-1 dash rule they are supposed to anchor. This is a gold-exemplar hygiene task, not a schema or prompt defect.

2. **SURFACE is the model's most likely abuse vector at scale.** The vocabulary already warns of this (§10): the inverse of the original problem is a *deep* song lazily tagged SURFACE to dodge the work (Beautiful Things, §4b, is the canonical trap). v14's prompt steers correctly — it routes to SURFACE only when there is *no buried claim* — but a prompt cannot fully enforce "did you actually look for the claim?". The real backstop is the `lens-coherence` judge in Session 5: it must check that a SURFACE lens was chosen because the *song* is thin, not because the *read* was lazy.

Neither finding fired the §8.3 "evidence against a working assumption" trigger — the schema, cardinality, lens grammar, and vocabulary all held. These are downstream-enforcement notes, recorded here and carried into the Session 5 brief.
