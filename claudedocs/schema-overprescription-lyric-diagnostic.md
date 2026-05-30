# Schema Over-Prescription — Lyric Diagnostic

**Date:** 2026-05-29 (Session 1 tail, user-steered; extended same day)
**Method:** Read the **lyrics only** (`song_lyrics.document`, local DB) — NOT `song_analysis` (old-prompt output, which can't diagnose its own replacement). Goal: catch fields that are over-prescriptive for the real distribution of songs before they get baked into prompt v14.

**Round 1 (4 songs):** Paradox-poor songs chosen for emotional extremes and surface-vibe.
**Round 2 (6 songs):** Added to stress-test across depth gradient, archetype, language, and valence/energy quadrants. Audio features (valence/energy/tempo) were used only to *select* diverse candidates; every interpretive judgment below comes from reading the lyrics. (DtMF's audio data — valence 0.03, energy 0.13 on a festive salsa/reggaeton track — is plainly unreliable, which reinforces the As It Was finding: do not trust audio features as a proxy for emotion.)

---

## Song table (10 total)

| Song | Archetype / why chosen | Lyric reality | val / enr |
|---|---|---|---|
| God's Plan (Drake) | Paradox-poor: gratitude track | Gratitude + faint paranoia + loyalty | 0.36 / 0.45 |
| Houdini (Dua Lipa) | Paradox-poor: high-energy flirt | Flirtation as a power-dare | 0.87 / 0.79 |
| Forever (Chris Brown) | Paradox-poor: pure dancefloor | Pure euphoria, one idea | 0.44 / 0.82 |
| No Sex For Ben (The Rapture) | Paradox-poor: content-zero chant | Repetitive insult chant; not *about* anything | 0.93 / 0.95 |
| DtMF (Bad Bunny) | Foreign language; festive/reflective | Nostalgia wearing a party hat; real subtext in Spanish | 0.03 / 0.13 |
| Ribs (Lorde) | Literary deep end | Fear of growing up; hyper-specific images; all fields earn their keep | 0.04 / 0.47 |
| Beautiful Things (Benson Boone) | Confessional ballad; flat arc | Grateful terror — real depth, single emotional register, no arc movement | 0.22 / 0.47 |
| As It Was (Harry Styles) | Tempo-emotion gap | 174 BPM production hiding floor-level loneliness; brightness as the lie | 0.66 / 0.73 |
| Pink Pony Club (Chappell Roan) | Narrative/journey | Two-act structure: Tennessee → West Hollywood; `arc` thrives, `lens` fights the plot | 0.51 / 0.65 |
| Thinkin Bout You (Frank Ocean) | Literary deep end | Unrequited love through misdirection; verse 2 denial makes chorus confession land harder | 0.20 / 0.34 |

---

## Depth gradient (10 songs placed)

```
SCHEMA THRIVES                                     SCHEMA BREAKS
──────────────────────────────────────────────────────────────────
Ribs          Thinkin      DtMF     As It Was     God's Plan
(Lorde)       Bout You     (BB)     (Styles)      (Drake)
              (Ocean)
                                                  Pink Pony   Beautiful   Houdini   Forever   No Sex
                                                  Club        Things                          For Ben
                                                  (Chappell)  (Boone)
```

More precisely as a ranked list (best → worst schema fit):

1. **Ribs** — literary, multi-dimensional, all fields have full purchase
2. **Thinkin Bout You** — literary, misdirection requires close reading, all fields earn their keep
3. **DtMF** — real subtext, festive/reflective tension; new edge: `lines` foreign-language gap
4. **As It Was** — `tension` as qualified emotion handles the audio-lyric gap cleanly; `arc` has real movement
5. **Pink Pony Club** — `arc` thrives on the narrative; `lens` partial (fights two-act structure)
6. **Beautiful Things** — real emotional depth but single-register; `arc` manufactures movement
7. **God's Plan** — some subtext; `lens` and `arc` stretch thin
8. **Houdini** — surface-legible; `lens` and `contradiction` grasp for depth
9. **Forever** — pure vibe; `arc` flat, `contradiction` empty, `lens` fabrication
10. **No Sex For Ben** — schema breaks; no interpretive frame exists

---

## Field-by-field verdict (updated with Round 2 evidence)

| Field | Universal? | Verdict | Round 2 change? |
|---|---|---|---|
| `texture` | Yes | Every song sounds like something. Never over-prescriptive. | Confirmed — holds across all 10. |
| `image` | Mostly | Even a chant has a hook. Holds for all 10. | Confirmed — "laughing till our ribs get tough" (Ribs), "gravity's holdin' me back" (As It Was) both strong. |
| `contradiction` | Yes (already optional) | Schema got this right — Forever/Ben get none; Ribs/Frank Ocean/PPC all get strong ones. | Confirmed — Pink Pony Club bridge ("Still love you and Tennessee") is a textbook Pratfall. |
| `tension` | Conflated | Works as *qualified emotion*; fails as "paradox." | **Strengthened.** As It Was is the clearest proof: "Hollow Brightness" is not a paradox, it's a qualified emotion — the field handles this well once recast. |
| `lines` | Floor too high | 3-5 minimum forces filler on 1-2-idea songs. | Confirmed. New wrinkle: **foreign-language songs** (DtMF) need a quoting convention — original or translation? Schema is silent. |
| `arc` | Assumes movement | Monochrome songs have structural beats but flat mood. | **Refined.** Beautiful Things adds a new case: emotionally deep but single-register. Arc movement fails not only on content-thin songs (Ben) but also on emotionally *narrow* songs. |
| `take` | Forces invention | Fixed ~3 sentences makes the model invent subtext on thin songs. | Confirmed. Thinkin Bout You could use 4-5 sentences to honor verse 2's misdirection — elasticity helps both directions. |
| `lens` | Breaks on thin content; also fights narrative structure | No lens exists for Ben. And for narrative/journey songs (Pink Pony Club), a single thesis fights a two-act plot. | **Extended.** New failure mode: narrative songs where the journey IS the content — a single noun-as-noun frame collapses the structure. |

---

## New over-prescription patterns (surfaced by Round 2)

### Pattern A — Foreign-language `lines` gap

DtMF is sung entirely in Spanish. The `lines` field asks for lyric quotes as "receipts." The receipts exist and are excellent — *"Debí tirar más fotos de cuando te tuve"* ("I should have taken more photos of when I had you") is the anchor of the whole song. But the schema has no convention for what to quote: the original (opaque to non-Spanish readers) or a translation (loses the music of the line). A model generating for DtMF will make an arbitrary choice, and both choices partially fail.

**This is only visible across a multilingual library.** The first 4 songs (all English) couldn't surface it.

→ **Feeds Session 2:** the lens vocabulary needs a note on foreign-language songs — does the lens phrase get written in English regardless of source language? Almost certainly yes, but the `lines` convention is a separate question that needs a prompt rule.

### Pattern B — Narrative structure vs. single-thesis `lens`

Pink Pony Club has a two-act structure: Tennessee (captivity/expectation) → West Hollywood (arrival/chosen identity), with a bridge reconciliation ("Still love you and Tennessee"). A single noun-as-noun lens can frame the departure ("escape as homecoming") or the arrival ("dance floor as chosen family") but not cleanly both. The bridge complicates any clean thesis: the song refuses to make leaving a full repudiation of home.

The `arc` field thrives here exactly because it has multiple beats. The `lens` field, by design, has one. For narrative/journey songs, this is an inherent tension — not a bug in the schema, but a gap in the lens vocabulary. A "journey" lens family with frames like "leaving as homecoming" or "escape into belonging" would give the model a form that can hold both directions.

**The arc field is not over-prescriptive on narrative songs — it's the lens field that's under-specified.**

→ **Feeds Session 2:** the lens vocabulary needs a journey/arrival family with frames built for two-act narrative structure.

### Pattern C — Emotionally deep but structurally flat (refined from Round 1)

Round 1 established that surface-true songs (Forever, Ben) have flat arcs. Round 2 adds a nuance: Beautiful Things is *not* content-thin — its emotional content is real and specific ("there's no man as terrified as the man who stands to lose you"). But both verses sit in the same register: grateful + anxious. The arc would be manufactured not because the song lacks depth, but because it lacks **movement**. Verse 1 and Verse 2 express the same duality with different words.

The original finding ("arc assumes movement") is refined: **arc manufactures movement when the song's emotional register is monochrome, regardless of whether the song has interpretive depth.** A deep, still song and a shallow, still song both break `arc` — for different reasons.

→ **Already in recommendations** (arc floor of 2, mood may repeat) — this refinement strengthens the case.

---

## The meta-finding — reaffirmed with refinement

**Original:** The schema encodes a critic's bias — it assumes every song rewards close-reading. On surface-true songs, required fields force the model to manufacture depth.

**Reaffirmed.** 6 additional songs across depth levels, archetypes, and languages confirm the core finding. Schema fitness scales with interpretive depth.

**Refinement:** Depth is the primary driver, but two secondary moderators cause partial failures even on deep songs:

1. **Structural movement** — arc fails on emotionally monochrome songs (Beautiful Things) even when interpretive depth is real. Depth ≠ movement.
2. **Interpretive singularity** — lens fights narrative songs (Pink Pony Club) where the journey itself is the content and no single thesis captures both acts. A deep song can have a structure that resists the lens's single-thesis grammar.

The fix remains the same — elastic cardinalities, honest `tension`, permission to be brief. But Session 2's lens vocabulary now has evidence for two specific families it needs to build: a **surface/descriptive** register (for content-thin songs, from Round 1) and a **journey/arrival** register (for narrative songs, from Round 2).

---

## Recommendations (inputs for Session 3 schema + Session 4 prompt)

*Unchanged from Round 1 — Round 2 confirms all six; two addenda added.*

1. **`tension`** → qualified emotion (modifier + core), explicitly NOT required to be paradoxical. Paradox burden moves to optional `contradiction`. (Fix master §2 glossary — calls `tension` a "paradox," borrows `contradiction`'s job.)
2. **`take`** → elastic length (1-3 sentences) + instruction to match the song's actual depth.
3. **`lens`** → define a lighter **descriptive register** / "surface" family for content-thin songs (Session 2 vocabulary). Hardest open question.
4. **`arc`** → allow flat-mood; floor of 2 beats; `mood` may repeat.
5. **`lines`** → lower floor to 1-2.
6. **Cross-cutting prompt rule** → explicit permission to be brief/flat; a surface-true song gets a surface-true read.
7. *(New — from Pattern A)* **`lines` language convention** → for foreign-language songs, the prompt needs an explicit rule: quote the original line with a parenthetical English gloss. Schema itself doesn't need to change; the prompt rule does.
8. *(New — from Pattern B)* **`lens` journey family** → Session 2 vocabulary must include a journey/arrival lens family ("escape as homecoming", "leaving into belonging") for two-act narrative songs. The noun-as-noun grammar holds; the family is what's missing.

---

## Where these land

- **Session 2 (lens vocabulary):** must account for (a) surface-true songs — descriptive/thin lens register; (b) narrative/journey songs — a journey/arrival lens family. Both now have lyric evidence.
- **Session 3 (Zod migration):** cardinality floors (`arc` >= 2, `lines` >= 1), `tension` optionality/redefinition, keep `contradiction` optional.
- **Session 4 (prompt v14):** "permission to be brief and flat" rule; depth-matching instruction; `tension` as qualified-emotion not paradox; foreign-language `lines` quoting convention.

---

## Lyrics-only attestation

No `song_analysis` rows were read. All judgments derive from `song_lyrics.document` (text extracted via `sections[].lines[].text` JSONB path, annotations excluded). Lyric lines quoted above are verbatim from the DB.
