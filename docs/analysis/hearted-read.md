# Hearted Read Spec — voice, grounding & field rules

**The encoded answer key** for what a Hearted song-read is and how it must sound. It is both
**the target** the production prompt (`content-analysis/prompts/lyrical-v*.ts`) must encode, and
**the rubric** the voice-audit judges score a candidate read against.

Two standing authorities:
- **The golds are the truth.** The 9 hand-revised exemplars in `scripts/voice-audit/exemplars/*.json`
  (+ raw lyrics/annotations in `exemplars/lyrics/*.json`) outrank this doc. When a gold and a rule
  disagree, **fix the rule** — unless the gold is a genuine straggler bug (see §K).
- **This doc outranks `lens-vocabulary.md`'s seeds.** The lens families/seeds are a starting palette;
  the gold's actual read wins ("that doc is not truth").

Codified across three layers: `scripts/voice-audit/tier1/rules.ts` (deterministic gate),
`scripts/voice-audit/tier2/` (LLM judges), and the v17+ prompt. Each rule below carries a stable
**ID** (`GRD-1`, `MEC-2`, …) that code comments and tests cite — keep the IDs stable. Where a rule
is automated, the tier1 rule name or tier2 judge is named inline.

---

## 0. The shape (current schema)

From `content-analysis/read-schema.ts` (`ConceptReadSchema`). **Zod is the permissive envelope; this
spec is the narrower target** — Zod floors are deliberately looser than the prompt so coherent output
is never silently rejected. `contradiction` and `texture` are **required keys with nullable values**
(explicit `null`, never silent omission); the brittle Zod regex for lens grammar was dropped in favour
of the prompt + the `lens-coherence` judge enforcing form.

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

Authoring/revision order: **take → image → lens → tension → contradiction → arc (beat by beat) →
lines → texture.** Draft the take first because it surfaces the lens.

---

## A. Grounding — the gate that governs every field

The single most-repeated correction across all 10 authoring sessions. It governs every field.

> Every word of every field traces to a heard **lyric** or a qualifying **annotation**. Nothing else.

- **GRD-1** | Every word traces to a heard lyric or annotation. *(prompt + tier2 grounding judge, Opus — priority 1.)*
- **GRD-2** | Never import **cultural reception** — chart position, "song of the summer," crowd/chant behaviour, awards, the video's real-world impact.
- **GRD-3** | Never import **biography or beef history** the lyrics/annotations don't state (subject to GRD-6).
- **GRD-4** | Never import anything you "just know" about the song from outside it.
- **GRD-5** | **Para-textual (cover art, music video) = flag, never use silently.** "Is it in the lyrics" is the higher bar; even an annotation tying art to a lyric stays flagged for human decision. *(Not Like Us: cover art + video both flagged, both declined.)*
- **GRD-6** | **Annotation grounding is vote-gated.** A heard lyric is always valid. An annotation counts as grounding only when `votes_total > 15` (floor `GROUNDING_MIN_VOTES = 16` in `content-analysis/grounding-annotations.ts`); low-voted annotations are ignored. **Above the threshold, even real-person biography is fair game.** `verified`/`state`/`pinnedRole` are available to tighten further. The three-tier reflex from drivers license: heard lyric (no disclosure) → interpretive annotation (annotation-sourced, not smuggled as lyric) → low-voted biography (ignored).
- **GRD-7** | **The honest reflex:** when a claim can't survive "is that in the lyrics?", cut it — don't defend it.
- **GRD-8** | **`texture` is the one licensed exception** — grounded in *sound* (audio features + genre), not lyrics. Even there: "if you cannot hear it, you do not know it."
- **GRD-9** | The prompt **must include an annotations slot**, populated (with `votes_total`) when annotations exist so GRD-6 can gate them. Data path: `selectGroundingAnnotations` + `renderAnnotationsBlock`.

---

## B. Voice mechanics — hard rules (gate)

**The house voice:** a friend who notices music and says what they hear, warmly and with certainty.
Not a critic filing a report. Talk to the person as "you." Let the song act ("It found you. You kept
it."). Name feelings in plain words. No hedging ("perhaps," "might be"). One exclamation mark, ever.

- **MEC-1** | One idea per sentence; end with a period. **Short fragments are heavily discouraged** — allowed only rarely, when one genuinely lands ("She's already gone.").
- **MEC-2** | **Never a comma followed by an `-ing` word** — the most-enforced mechanic; holds even for `-ing` adjectives ("a single, exhilarating night" breaks it). *(tier1 `participial-closure`, HIGH.)*
- **MEC-3** | No trailing em dash ending a clause abruptly. **Paired parenthetical dashes are fine** ("withdrawals — from her, from the high — and the lights…"). *(tier1 `dash`, graded by parity: even = LOW, odd/trailing = MED.)*
- **MEC-4** | ~~No intra-word hyphens~~ — **CUT.** "late-night," "neon-lit" are allowed.
- **MEC-5** | Never open a field with "This is / It is / This song is" or any framing verb. Start with the noun or image. *(tier1 `book-report-opener`, HIGH.)*
- **MEC-6** | Say what something **is**. Never the AI thesis-pivot "it isn't X, it's Y" — the ban is the **move**, not just the tokens ("drive to his house, not past his street"). **Scope caveat:** natural subordinate contrasts are NOT the move and must not be flagged — golds use "could never be bought, only inherited" (Not Like Us), "not because it hurts less but because it proves she chose right" (Pink Pony). *(tier1 `antithesis`, HIGH, tokens; the "move" stays editorial/tier2, scoped.)*
- **MEC-7** | Never write "this song / the track / **the album** / the narrator / the singer / the speaker / the listener" — not once, any field. *(tier1 `self-reference`, HIGH. "the song" stays editorial — see GR3.)*
- **MEC-8** | No puffery adjectives ("blistering," "relentless," "haunting," "shimmering," "profound") or their adverbs. *(tier1 `puffery-adjective`, MED.)*
- **MEC-9** | No significance-inflation verbs ("serves as," "represents," "underscores," "highlights," "frames," "acts as"). *(tier1 `copula-avoidance`, MED.)*
- **MEC-10** | **No structural-section names** (refrain/verse/chorus/bridge/hook/intro/outro/pre-chorus) in the **interpretive prose fields** (`take`, `scene`, `image`, `contradiction`). Does **not** touch `lines`, arc `label`s, or **`texture`** — the sound-grounded field, where a musical term names a sonic motif ("ringing hollow underneath each hook") and is legitimate (see GR6). *(tier1 `structural-section`, HIGH; texture excluded.)*

---

## C. Voice mechanics — softer rules

- **SFT-1** | **No aphoristic kicker** ending a beat or take ("The calm is the cruelty"). End on movement, not a neat button. *(tier2 voice-softness; STRONG.)*
- **SFT-2** | **The subject is the actor** — never the phrase, the metaphor, or "the words." Make the person act.
- **SFT-3** | **Vary sentence openers** — no "he/he/he"; don't open adjacent fields with the same word.
- **SFT-4** | No chained-dots or rule-of-three as a crutch. Use a comma/colon or restructure. *(tier1 `rule-of-three`, LOW.)*
- **SFT-5** | **Connect the prose; don't fragment it.** Clipped standalone pronouncements sever the connective tissue a told story needs. One fragment that lands is fine; a pile of them is the tell. *(tier2 voice-softness; STRONG.)*
- **SFT-6** | No "and … and … and" chaining. Subordinate the condition, don't coordinate it.
- **SFT-7** | No mirrored "X is the Y" parallelism (manufactures profundity by symmetry). *(tier2 voice-softness / essayistic.)*
- **SFT-8** | **Don't rate the song as an object.** Tell its story from inside; don't stand outside and grade ("the meanest song you'll ever feel," "embedded without citation" = reviewer-speak). *(tier2 essayistic-register; STRONG.)*
- **SFT-9** | A simile must earn its space; watch for a metaphor-family crutch (five accounting metaphors in a row). **When confused, cut — don't explain; a metaphor that needs explaining has failed.**
- **SFT-10** | **Emotion is a lens, not a headline.** Tuck the feeling into the motion ("now drives through tears past it") instead of announcing it at a sentence's end.

---

## D. Interpret, don't describe

The deepest, most-recurring failure: **recapping the lyrics instead of telling the song's story.**

The test for any scene or take: **would this mean something to someone who knows the song cold?** If
it answers "what happens," it fails; it must answer "what it *means* / how it *feels*."

- **INT-1** | Tell the song's **story**, don't recap the lyrics. *(tier2 arc-narrative + register-specificity.)*
- **INT-2** | **"The person already listened to that."** Quoting real lyrics back into a scene is heavily discouraged; the job is the emotional turn underneath. Model is *cause > effect*: a beat that lists what happens is a timeline; a beat that shows what the listing *does to her* is a story. *(tier2 arc-narrative `recap_scenes`.)*
- **INT-3** | **Lead with the insight, then the evidence.** Inventory-first prose is a safety-seeking tell. *(soft prompt guidance.)*
- **INT-4** | The reliable unlock is the golds themselves — the prod prompt carries a worked example; the judge compares against the golds, not just a rubric.

---

## E. Field-by-field spec

### image — the felt moment
Concrete sensory phrase, ≤ 8 words, lowercase first word, no closing period — the *felt image*, **not**
the sound (sound is texture's job).
- **IMG-1** length/shape as above.
- **IMG-2** | Prefer a **single coherent moment**; two are acceptable if well-harmonized. Don't fuse images with opposite motion ("crying through the suburbs" + "red lights, stop signs").
- **IMG-3** | Grounded, not constructed atmosphere ("empty room" is imported when nothing says it's empty). *(This is the most sampling-sensitive grounding edge — a lone atmosphere flag should be re-run, not trusted.)*
- **IMG-4** | Carry the emotional fact, not just the place; prefer the loaded shorthand ("sin city" over "las vegas").
- **IMG-5** | Image and lens must not do the same work (two fields on one metaphor = one is dead).
- **IMG-6** | A bare heard line is often the strongest image (`psst. i see dead people`, `no sex for ben`).
- **IMG-7** | All-lowercase even for proper nouns.

### lens — the one buried claim
2–6 words, lowercase, in **exactly one of three forms** (full grammar + families in `lens-vocabulary.md`):
- **`X as/of/with Y`** — the critical form: the song is really Y. `license as eulogy`, `blessing as a loan`.
- **`X into Y`** — the transformation form. `insult into anthem`, `numbing into motion`.
- **`Verb-ing the X`** — the narrative form, when the motion is the meaning. `freezing the creep out`, `finding your way home by leaving`.

- **LEN-1…2** | Forms as above; **Y must be concrete and picturable** (a eulogy, a loan, a block party), never a feeling/quality.
- **LEN-3** | A **claim, not a category** — never a mood word, bare-noun tag ("heartbreak," "freedom"), or abstract summary noun as Y ("journey," "meditation"; "anthem" only as the output of an "into" turn).
- **LEN-4** | Test: you can say "X works as Y, because…" in one breath.
- **LEN-5** | 6-word **ceiling, not a target** ("if you need 7, you're describing").
- **LEN-6** | The "as" connector is **correct grammar, not an AI tell** — required; don't replace a valid Form-1 lens with a bare noun phrase.
- **LEN-7** | The **take must genuinely argue the lens** — coherence beats the answer-key seed (Motion Sickness's `anger with receipts` lost to `missing the person you escaped`). *(tier2 lens-coherence.)*
- **LEN-9** | The lens may stay abstract/poetic **when image and take already carry the explicit content** (Pink Pony's paradox without spelling out the queer reading).

### tension — the qualified feeling
Exactly two words, `[Modifier] [Core Emotion]`, each capitalized.
- **TEN-1** | Two-word shape. *(schema + tier1.)*
- **TEN-2** | The **feeling, not the paradox** (the paradox is contradiction's job).
- **TEN-3** | Don't overstate the weight ("Cruel Glee" → `Mocking Glee`; "terror" → `Blessed Unease`).
- **TEN-4** | The compound holds the **whole arc, not just the landing** ("Grounded Joy" → `Aching Warmth`).
- **TEN-5** | The core word is a real **emotion, not an act** ("Desperate Prayer" rejected).
- **TEN-6** | Don't duplicate an `arc` mood verbatim. *(tier1 `tension-mood-dedup`, MED — tension vs each beat mood. Beat-vs-beat repeats stay legal — see ARC-3.)*

### take — the read
1–3 sentences, present tense, written **through the lens**, leading with the insight.
- **TAK-1…2** | Shape as above; **scale to the song's real depth** — a layered song earns three sentences, a surface-true one earns one ("the take is bigger than the lyrics" is a failure).
- **TAK-3** | Close on the song's own image or word, not a thesis button.
- **TAK-4** | A voiced turn ("And that's the problem.") is allowed but used **very sparingly** — at most once, only when it earns its place.

### contradiction — the open knot
One sentence naming what the song refuses to resolve — true on both sides at once, **with no resolution**.
- **CON-1** | Shape as above.
- **CON-2** | Must say something **no other field says**.
- **CON-3** | **`null` is the honest, preferred call** for a song at peace with itself. Never manufacture one.
- **CON-4** | Don't close it with a thesis ("the joy and the grief belong to each other" = too resolved).
- **CON-5** | Tying the knot to the song's **central concrete anchor** sharpens it.

### arc — the emotional turns
2–4 beats, **most songs earn 3**; 4 only for a true four-movement song; 2 for a chant/one-mood. Count
real emotional turns, not sections.
- **ARC-1** | Beat count as above. *(schema 2–4.)*
- **ARC-2** | `label` = the emotional **event**, house form "The [event]"; **never Verse/Chorus/Bridge.**
- **ARC-3** | `mood` = 2–3 words; **may repeat** across beats (monochrome songs are honest).
- **ARC-4** | `scene` = one+ complete sentence inside the moment — the recap ban bites hardest here. *(tier2 arc-narrative + tier1.)*
- **ARC-5** | End on a concrete action/image; stop at the real turn. The ban is the *neat AI-button*, not every interpretive turn — golds end on short active metaphors ("It becomes a vow.") and those are fine.
- **ARC-6** | When a beat has many parallel events, **anchor on one or two**; don't catalogue at equal weight.
- **ARC-7** | No stepwise march ("He told her X. He was Y. She does Z."). *(tier2 `recap_scenes`.)*
- **ARC-8** | A scene must not **duplicate the same insight** the take/contradiction/image already spends. Exception: load-bearing spine repetition is fine (As It Was lands "as it was" in take *and* scene).
- **ARC-9** | Scene register matches the song's — a plain/chant song gets plain scenes; plain stays **song-specific, never generic**.
- **ARC-10** | **Stitch the beats** — a phrase/image from one beat echoes into the next; shuffling should break the story even when mood is flat.
- **ARC-11** | Scenes **stay in the present moment** — no anticipatory/consequence-signaling.
- **ARC-12** | The **last beat doesn't tie a bow.** Don't resolve the central tension; a song that ends conflicted ends conflicted (Pink Pony's "Loving Reconciliation" label was rejected as too tidy).
- **ARC-13** | Don't restate lyrics as the **substance** of a scene, **but** a quoted direct-speech fragment is allowed when the lyric *is* the emotional action; if you reference a lyric, use its **actual words**.
- **ARC-14** | `mood` is a two-word qualified emotion. *(tier1 `mood-width`, MED.)*
- **ARC-15** | A person named in a scene whom an outsider won't know gets **relationship context, not a bare name** ("his brother," not "Jan") — unless they're very famous.

### lines — the quotes
1–5 **exact** quotes, each `{ line }`, **no gloss** (the line speaks for itself).
- **LIN-1…2** | Shape as above; each line lands a **distinct** hit. Don't pad to five.
- **LIN-3** | Order by position in the song; span its emotional range.
- **LIN-4** | Foreign-language: quote the original, then an inline parenthetical English gloss (natural, not word-for-word) — `"Debí tirar más fotos (I should have taken more photos)"`.
- **LIN-5** | A line may carry `\n` to quote a couplet.
- **LIN-6** | `lines` is exempt from all prose rules (bare quotes; punctuation is the artist's).
- **LIN-7** | Memorability can outrank decodability — line selection is a taste call.
- **LIN-8** | Dedup against image/take/arc — don't quote a line another field already spends.
- **LIN-9** | **Use annotations to find lines** — prefer lines the (vote-gated, GRD-6) annotations mark important; the quote must still be exact heard text.

### texture — the sound (the one sound-grounded field)
- **TEX-1** | Write **only** when audio features are provided; `null` otherwise.
- **TEX-2** | One sentence on the physical sound, **turning on a contrast by its end** (comma or second sentence, never a trailing dash).
- **TEX-3** | Ground it in the data; **genre (from `song.genres`, not memory)** sharpens the words.
- **TEX-4** | `acousticness ≠ a specific instrument` (don't claim "piano").
- **TEX-6** | A human gold can be wrong about sound too ("propulsive" → "unhurried" at 107 BPM / energy 0.55).
- **TEX-7** | **Don't assert dynamics** (a build, swell, drop) from static averages — a single mean can't show a rise.
- **TEX-8** | Never infer the sound from the lyrics.
- **TEX-9** | End on an image; cut the slowing list.
- **TEX-10** | Carries the **tempo-vs-emotion gap** (bright sound over dark words) in its contrast clause.

---

## F. Specificity vs. the gold — the frontier

- **SPC-1** | Where the gold names the **exact noun/detail**, the candidate must too — never the category/euphemism ("what girls?" → "hide your lil' sister"). This is where v14/v15 lost to gold; pairwise-judge against the matching gold and read the **rationale**, not just win/tie/loss. *(tier2 register-specificity + pairwise.)*

---

## G. Song-type playbook

Match the read to the type (the golds were chosen to span this variance):

- **TYP-1 · Surface-true / chant** (No Sex for Ben) — short take (1 sentence), 2–3 beats, few lines, `contradiction: null`. Keep song-specific anchors; don't inflate; don't import depth.
- **TYP-2 · Foreign-language** (DtMF) — inline gloss; **lead with the specific cultural/diaspora reading**, not a generic "leaving home." Place-names get one phrase of context or get replaced. Lens always in English.
- **TYP-3 · Monochrome / one deep mood** (Beautiful Things) — repeated mood across beats is correct; load-bearing word repetition is earned.
- **TYP-4 · Two-act narrative** (Pink Pony) — ARRIVAL family holds both leaving and landing; name the real axis (the queer reading), don't euphemize; interpret the bridge, don't restate it.
- **TYP-5 · Tempo-vs-emotion gap** (As It Was, Blinding Lights) — the bright-sound/dark-words contrast lives in `texture`'s contrast clause.

---

## H. Cross-cutting

- **XCT-1** | **Each field must earn its keep.** If two fields say the same thing, one is dead — cut the redundancy (take vs contradiction; tension vs arc-mood; image vs lens; a `lines` quote already used).
- **XCT-2** | **Establish lyric agency before writing** — who holds the power, in which direction? ("hands that won't let go" inverted a song about something being *taken* from him.)

---

## J. The judge rubric — the gate order the eval runs

A candidate read passes "reads like Hearted" when it clears, in order:

1. **Grounding (gate)** — GRD-1…9. Imported reception/biography/sound-from-words → fail; annotations vote-gated.
2. **Voice mechanics (gate)** — MEC-1…10; editorial adds SFT-5/7/8/9. Tier-1 `rules.ts` automates most — run it first (free).
3. **Interpret-not-describe** — INT-1…4; SFT-1 (no kicker), SFT-2 (subject is actor), SFT-5 (no fragmenting).
4. **Field correctness** — IMG/LEN/TEN/TAK/CON/ARC/LIN/TEX as specified.
5. **Specificity vs. gold (frontier)** — SPC-1. Pairwise-judge against the matching gold; read the rationale.

Loop tooling: `scripts/voice-audit/` (`regen.ts`, `evaluate.ts`, `scoreboard.ts`, the tier2 `check-*` judges). The standing finding from the prompt-tuning rounds (logged in `scripts/voice-audit/experiments/changelog.md`): the antithesis pivot and the depth/correctness gap to gold **cannot be prompted away** — register is the only promptable axis, so these are gated, not coached.

---

## K. Gold-vs-rule conflicts — resolved

Validating rules against the actual `exemplars/*.json` (not just the sessions) surfaced places where a
shipped gold broke a rule. The golds are the standing authority, so "fix the gold" is not automatic.
All resolved 2026-06-05; vitest green (72/72), all moods two-word and none equal to their tension:

- **GR1** — blinding-lights one-word moods vs ARC-3/ARC-14 → gold fixed: "Yearning" → **"Lonely Yearning"**, "Resolute" → **"Blinded Resolve"**. Rule kept.
- **GR2** — dtmf "The chorus lands:" in a scene vs MEC-10 → gold fixed: → **"Then the admission he keeps circling:"**. Rule kept.
- **GR3** (minor) — dtmf "inside the song" meta-reference → **stays editorial**; the gold uses it deliberately to mark the photo-taken-within-the-recording moment. Adding "the song" to the hard ban would require revising this gold.
- **GR4 / GR5** — blinding-lights & pink-pony beat-1 moods duplicated the tension (TEN-6) → fixed to **"Sleepless Craving"** / **"Giddy Liberation"**.
- **GR6** — as-it-was "underneath each hook" in `texture` vs MEC-10 → **rule scoped, gold untouched**: MEC-10 covers the interpretive prose fields only and excludes `texture` (the sound-grounded field, GRD-8), where musical-structure vocabulary legitimately names the sound.

---

## L. The 9 golds at a glance

`scripts/voice-audit/exemplars/*.json` (keyed by `spotifyTrackId`, 4 use a stable slug); lyrics +
Genius annotations in `exemplars/lyrics/*.json`.

| key | song | lens | tension | variance it covers |
|---|---|---|---|---|
| not-like-us | Kendrick — Not Like Us | the diss as cultural eviction notice | Collective Contempt | name/beef-dense; hardest grounding test |
| drivers-license | Olivia Rodrigo | license as eulogy | Aching Disbelief | grief ballad; texture from DB |
| blinding-lights | The Weeknd | freedom that turns out to be absence | Hollow Euphoria | bright synth / lonely lyric |
| motion-sickness | Phoebe Bridgers | missing the person you escaped | Helpless Longing | texture-hallucination case; 4-beat |
| dtmf | Bad Bunny | the photo as the only way to hold what leaves | Aching Warmth | foreign-language + diaspora reading |
| no-sex-for-ben | The Rapture | freezing the creep out | Mocking Glee | surface-true chant; `contradiction: null` |
| beautiful-things | Benson Boone | blessing as a loan | Blessed Unease | monochrome deep dread; repeated mood |
| pink-pony-club | Chappell Roan | finding your way home by leaving | Unrepentant Joy | two-act ARRIVAL; queer reading |
| as-it-was | Harry Styles | silence as the grief he allows | Withheld Grief | tempo-vs-emotion; refusal/withholding |

---

## M. Eval discipline (the prompt-tuning loop)

For anyone iterating prompts against the golds (full operational guide: `scripts/voice-audit/README.md`):

- **The golds are the unit of generalization (n=9).** Multiple runs of one song are repeated measures, not extra n.
- **Use an odd run count** for any variant compared inferentially, so every song collapses to a majority outcome and the full n=9 is preserved. Even-run histories are legacy fallback only.
- **The optimization target is pairwise win-or-tie vs gold** (Opus, position-bias-cancelled by running each comparison twice and reconciling). Tier-1 (0 HIGH) and the tier-2 judges — especially grounding — are **gates**, not the maximand.
- **Stats:** marginal win-or-tie with a Wilson 95% CI; paired comparisons use McNemar mid-p. **Significance is a strong positive when it appears; its absence means "too noisy to trust," not "edit proven bad."** (If ties are ever scored 0.5 instead of binary win-or-tie, the CI method must change.)
- **When a win is fake:** if a candidate wins pairs by importing cultural reception/biography, stop and fix the *judge* before keeping the candidate — calibration debt compounds.
- **Demoted to descriptive-only guardrails:** statistical AI-detection signals (perplexity, burstiness, MTLD) are *not* optimization targets — frontier models produce high-perplexity text, so optimizing toward "more human perplexity" chases a weak proxy. Mitigate self-preference bias by using a judge model from a different family than the generator.
- **Prove the gate bites:** every new judge ships with ≥1 deliberately-broken negative fixture it must catch. Pass-the-golds + catch-the-negatives = calibrated.
- **Prod/eval dissonance (known gap):** prod `pipeline.ts` builds `AnalyzeSongInput` without `exampleText` or `annotationsBlock`, so prod runs the active prompt with **no few-shot examples**. The service never fetches golds itself — a caller assembles those. Measured both ways, the candidate still lost 0/27 to gold, so this does not change the NO-GO-on-matching-gold verdict.
