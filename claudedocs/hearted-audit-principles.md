# Hearted Audit Principles — the distilled, codifiable rule set

Distilled from `hearted-read-spec.md`, then revised against your annotation pass (2026-06-05).
This strips provenance, session war-stories, and dated status prose, and renders every must-abide
rule as one atomic, taggable principle so it can be routed into the audit (`tier1/rules.ts`,
`tier2/` judges) and the v17 prompt.

**Standing authority (unchanged):** the 9 hand-revised golds in `scripts/voice-audit/exemplars/*.json`
are the truth; this doc is downstream. When a gold and a principle disagree, fix the principle.

**Annotation data available** (confirmed in `exemplars/lyrics/*.json`): each annotation carries
`text`, `votes_total`, `verified`, `state`, `pinnedRole`. GRD-6 / GRD-9 / LIN-9 rely on these.

**How to read each item**

- `layer:` where it gets codified — `tier1` (deterministic), `tier2` (LLM judge), `prompt` (v17
  instruction), `schema` (Zod), `editorial` (human-only, not gated), `data` (input/pipeline).
- `status:` `ENCODED` (already live), `PARTIAL` (partly live, has a gap), `GAP` (not codified yet).
- `rec:` `KEEP`, `CUT`, `DECIDE`, or `PENDING` (waiting on your call).

---

## A. Grounding (the gate that governs every field) — §1

**GRD-1** | Every word of every field traces to a heard **lyric** or an **annotation**. Nothing else.
`layer: prompt + tier2(NEW grounding judge)` · `status: GAP (only texture is grounded today)` · `rec: KEEP — priority 1`

**GRD-2** | Never import **cultural reception**: chart position, "song of the summer," crowd/chant behavior, awards, the video's real-world impact. *(Specialization of GRD-1.)*
`layer: prompt + tier2(NEW)` · `status: GAP` · `rec: KEEP`

**GRD-3** | Never import **biography or beef history** the lyrics/annotations don't state (artist alliances, prior moves, real-person facts). *(Subject to GRD-6: high-voted annotations are now an exception.)*
`layer: prompt + tier2(NEW)` · `status: GAP` · `rec: KEEP`

**GRD-4** | Never import anything you "just know" about the song from outside it.
`layer: prompt` · `status: GAP` · `rec: KEEP`

**GRD-5** | **Para-textual (cover art, music video) = flag, never use silently.** "Is it in the lyrics" is the higher bar; even an annotation tying art to a lyric stays flagged for human decision.
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**GRD-6** | **Annotation grounding is vote-gated.** A heard lyric is always valid. An annotation counts as grounding only when its `votes_total > 15`; low-voted annotations (≤ 15) are ignored. **Above the threshold, annotations are fair game — including real-person biography** (the former absolute ban on biographical annotations is relaxed to "high-voted only"). `verified` / `state` are available to tighten this further.
`layer: prompt + tier2(grounding) + data` · `status: GAP` · `rec: KEEP — revised per your note`

**GRD-7** | **The honest reflex:** when a claim can't survive "is that in the lyrics?", cut it — don't defend it.
`layer: editorial (authoring discipline)` · `status: GAP` · `rec: KEEP`

**GRD-8** | **`texture` is the one licensed exception** — grounded in *sound* (audio features + genre), not lyrics. Even there: "if you cannot hear it, you do not know it."
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**GRD-9** | The prompt/input **must include an annotations slot**, populated when annotations exist for the lyrics. Annotations are optional, so absent is fine — but when present they must reach the model (with `votes_total`, so GRD-6 can gate them). v16's template has no annotations slot today.
`layer: data/pipeline + prompt` · `status: GAP (task)` · `rec: KEEP — resolved per your note`

---

## B. Voice mechanics — hard rules (gate) — §2

**The house voice (prompt preamble):** a friend who notices music and says what they hear, warmly and
with certainty. Talk to the person as "you." Let the song act. Name feelings in plain words. No hedging.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**MEC-1** | One idea per sentence; end with a period. Two ideas → two sentences. **Short fragments are heavily discouraged** — allowed only rarely, when one genuinely lands (see SFT-5).
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP — tightened per your note`

**MEC-2** | **Never a comma followed by an `-ing` word** — the most-enforced mechanic; holds even for `-ing` adjectives.
`layer: tier1 participial-closure (HIGH)` · `status: ENCODED` · `rec: KEEP`

**MEC-3** | No trailing em dash ending a clause abruptly. **Paired parenthetical dashes are fine** (graded by parity).
`layer: tier1 dash (LOW even / MED odd)` · `status: ENCODED` · `rec: KEEP`

**MEC-4** | ~~No intra-word hyphens~~ — **CUT.** Intra-word hyphens are allowed ("late-night," "neon-lit"). *Phase B: drop the intra-word-hyphen penalty from the tier1 `dash` rule and its `rules.test.ts` case. Em-dash parity grading (MEC-3) is unaffected.*
`layer: —` · `status: was ENCODED (LOW) → removed` · `rec: CUT per your note`

**MEC-5** | Never open a field with "This is / It is / This song is" or any framing verb. Start with the noun or image.
`layer: tier1 book-report-opener (HIGH) + prompt` · `status: PARTIAL (only a fixed opener list fires; "It is"/"This song is" not caught)` · `rec: KEEP + close gap`

**MEC-6** | Say what something **is**. Never the AI thesis-pivot "it isn't X, it's Y." The ban is that **move**, not just the tokens (e.g. "drive to his house, not past his street"). **Scope caveat (from gold validation):** natural subordinate contrasts are NOT the move and must not be flagged — golds use "could never be bought, only inherited" (Not Like Us) and "not because it hurts less but because it proves she chose right" (Pink Pony). The tier1 token regex correctly ignores these; keep the editorial extension scoped to the thesis-pivot.
`layer: tier1 antithesis (HIGH, tokens) + editorial/tier2 (the move, scoped)` · `status: PARTIAL` · `rec: KEEP`

**MEC-7** | Never write "this song / the track / **the album** / the narrator / the singer / the speaker / the listener" — not once, in any field.
`layer: tier1 self-reference (HIGH) + prompt` · `status: PARTIAL ("the album" missing from the wordlist)` · `rec: KEEP + add "the album"`

**MEC-8** | No puffery adjectives ("blistering," "relentless," "haunting," "shimmering," "profound") or their adverbs.
`layer: tier1 puffery-adjective (MED)` · `status: ENCODED` · `rec: KEEP`

**MEC-9** | No significance-inflation verbs ("serves as," "represents," "underscores," "highlights," "frames," "acts as").
`layer: tier1 copula-avoidance (MED)` · `status: ENCODED` · `rec: KEEP`

**MEC-10** | **No structural-section names** (refrain/verse/chorus/bridge/hook/intro/outro/pre-chorus) in **any prose field** (`take`, `scene`, `image`, `contradiction`). Does **not** touch the `lines` array. Also resolve v16's stray "Pre Chorus" line.
`layer: tier1(NEW) + prompt` · `status: GAP (arc labels banned in prompt only; prose unscanned)` · `rec: KEEP — gate it (golds clean after GR2)`

---

## C. Voice mechanics — softer rules — §2

**SFT-1** | **No aphoristic kicker** ending a beat or take ("The calm is the cruelty"). End on movement, not a neat button.
`layer: tier2(NEW kicker check) + prompt` · `status: GAP` · `rec: KEEP — STRONG, promote to gate`

**SFT-2** | **The subject is the actor** — never the phrase, the metaphor, or "the words." Make the person act (apply where it reads naturally).
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP (soft)`

**SFT-3** | **Vary sentence openers** — no "he/he/he"; don't open adjacent fields with the same word.
`layer: tier2/editorial` · `status: GAP` · `rec: KEEP`

**SFT-4** | No chained-dots or rule-of-three as a crutch. Use a comma/colon or restructure.
`layer: tier1 rule-of-three (LOW) + editorial (chained dots)` · `status: PARTIAL` · `rec: KEEP`

**SFT-5** | **Connect the prose; don't fragment it.** Clipped standalone pronouncements sever the connective tissue. One fragment that lands is fine; a pile of them is the tell.
`layer: tier2(NEW fragmentation check) + editorial` · `status: GAP` · `rec: KEEP — STRONG`

**SFT-6** | No "and … and … and" chaining. Subordinate the condition, don't coordinate it.
`layer: editorial` · `status: GAP` · `rec: KEEP`

**SFT-7** | No mirrored "X is the Y" parallelism (manufactures profundity by symmetry).
`layer: tier2 (extend essayistic) + editorial` · `status: GAP` · `rec: KEEP`

**SFT-8** | **Don't rate the song as an object.** Tell its story from inside; don't stand outside and grade ("the meanest song you'll ever feel," "embedded without citation" = reviewer-speak).
`layer: tier2 essayistic-register + editorial` · `status: PARTIAL` · `rec: KEEP — STRONG`

**SFT-9** | A simile must earn its space; watch for a metaphor-family crutch (five accounting metaphors in a row). If a figure makes the reader picture a literal thing nobody does, cut it. **When confused, cut — don't explain; a metaphor that needs explaining has failed.**
`layer: editorial` · `status: GAP` · `rec: KEEP — editorial`

**SFT-10** | **Emotion is a lens, not a headline.** Tuck the feeling into the motion ("drives through tears past it") instead of announcing it at a sentence's end.
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

---

## D. Interpret, don't describe — §3

**INT-1** | Tell the song's **story**, don't recap the lyrics. Test: would this mean anything to someone who knows the song cold? If it answers "what happens," it fails; it must answer "what it means / how it feels."
`layer: tier2 arc-narrative + register-specificity + prompt` · `status: PARTIAL` · `rec: KEEP`

**INT-2** | **"The person already listened to that."** Quoting real lyrics back into a scene is **heavily discouraged** (occasionally fine); the job is the emotional turn underneath. Model is *cause > effect*.
`layer: tier2 arc-narrative (recap_scenes)` · `status: ENCODED` · `rec: KEEP`

**INT-3** | **Lead with the insight, then the evidence.** Inventory-first prose may be a safety-seeking tell. *(You were unsure — kept as soft prompt guidance, not a gate.)*
`layer: prompt` · `status: PARTIAL` · `rec: KEEP (soft)`

**INT-4** | The reliable unlock is the golds themselves — the prod prompt should carry a worked example; the judge should compare against the golds, not just a rubric.
`layer: prompt (worked example) + tier2 pairwise` · `status: PARTIAL` · `rec: KEEP`

---

## E. Field correctness — §4

### image

**IMG-1** | Concrete sensory phrase, ≤ 8 words, lowercase first word, no closing period — the *felt image*, **not** the sound.
`layer: prompt + schema(len)` · `status: ENCODED` · `rec: KEEP`

**IMG-2** | Prefer a **single coherent moment**; two are acceptable if **well-harmonized**. Don't fuse two images with opposite motion ("crying through the suburbs" + "red lights, stop signs").
`layer: tier2 abstract-noun-trap (extend) + editorial` · `status: PARTIAL` · `rec: KEEP — softened per your note`

**IMG-3** | Grounded, not constructed atmosphere ("empty room" is imported when nothing says it's empty).
`layer: tier2(grounding) + editorial` · `status: GAP` · `rec: KEEP`

**IMG-4** | Carry the emotional fact, not just the place; prefer the loaded shorthand ("sin city" over "las vegas").
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**IMG-5** | Image and lens must not do the same work (two fields on one metaphor = one is dead).
`layer: tier2 lens-coherence (extend) + editorial` · `status: PARTIAL` · `rec: KEEP`

**IMG-6** | A bare heard line is often the strongest image.
`layer: prompt` · `status: PARTIAL` · `rec: KEEP`

**IMG-7** | All-lowercase even for proper nouns ("no sex for ben").
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

### lens

**LEN-1** | 2–6 words, lowercase, in exactly one of three forms: **X as/of/with Y** (critical), **X into Y** (transformation), **Verb-ing the X** (narrative).
`layer: prompt + tier2 lens-coherence` · `status: ENCODED` · `rec: KEEP`

**LEN-2** | Y must be **concrete and picturable** (a eulogy, a loan, a block party) — never a feeling/quality.
`layer: prompt + tier2 lens-coherence` · `status: ENCODED` · `rec: KEEP`

**LEN-3** | A **claim, not a category** — never a mood word, bare-noun tag ("heartbreak," "freedom"), or abstract summary noun as Y ("journey," "meditation"; "anthem" only as the output of an "into" turn).
`layer: tier2 lens-coherence + tier1 abstract-noun (image-adjacent)` · `status: ENCODED` · `rec: KEEP`

**LEN-4** | Test: you can say "X works as Y, because…" in one breath. *(Don't phrase the test with "this song" — MEC-7.)*
`layer: prompt + tier2` · `status: ENCODED` · `rec: KEEP — reworded per your note`

**LEN-5** | 6-word **ceiling, not a target** ("if you need 7, you're describing").
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**LEN-6** | The "as" connector is **correct grammar, not an AI tell** — it is required; don't replace a valid Form-1 lens with a bare noun phrase.
`layer: prompt + editorial (anti-regression note)` · `status: ENCODED` · `rec: KEEP`

**LEN-7** | The **take must genuinely argue the lens** — coherence beats the answer-key seed.
`layer: tier2 lens-coherence` · `status: ENCODED` · `rec: KEEP`

**LEN-8** | *(cut — "the gold/vocab-doc seed outranks the doc": process note, and unclear out of context. See section I.)*

**LEN-9** | The lens may stay abstract/poetic **when image and take already carry the explicit content** (Pink Pony's paradox without spelling out the queer reading).
`layer: prompt + tier2 lens-coherence` · `status: PARTIAL` · `rec: KEEP`

### tension

**TEN-1** | Exactly two words, `[Modifier] [Core Emotion]`, each capitalized.
`layer: prompt + schema(2-word)` · `status: ENCODED` · `rec: KEEP`

**TEN-2** | The **feeling, not the paradox** (the paradox is contradiction's job).
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**TEN-3** | Don't overstate the weight ("Cruel Glee" → `Mocking Glee`; "terror" → `Blessed Unease`).
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP`

**TEN-4** | The compound must hold the **whole arc, not just the landing** ("Grounded Joy" → `Aching Warmth`).
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**TEN-5** | The core word must be a real **emotion, not an act** ("Desperate Prayer" rejected; a single word fails the two-word rule).
`layer: prompt + tier1(2-word check)` · `status: PARTIAL` · `rec: KEEP`

**TEN-6** | Don't duplicate an `arc` mood verbatim (with the `tension` or another beat). ✓ golds fixed (GR4/GR5); all 9 comply.
`layer: tier1(NEW dedup) or editorial` · `status: GAP (golds clean; ready to gate)` · `rec: KEEP`

### take

**TAK-1** | 1–3 sentences, present tense, written **through the lens**, leading with the insight.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**TAK-2** | **Scale to the song's real depth** — a layered song earns three sentences; a surface-true one earns one. "The take is bigger than the lyrics" is a failure.
`layer: prompt + tier2 lens-coherence (SURFACE abuse)` · `status: ENCODED` · `rec: KEEP`

**TAK-3** | Close on the song's own image or word, not a thesis button.
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP`

**TAK-4** | A voiced turn ("And that's the problem.") is allowed but must be used **very sparingly** — at most once in a take, and only when it genuinely earns its place; the default is to avoid it. The bare 3–4-word throwaway is the risk. Golds keep their instances (beautiful-things bare form; blinding-lights / motion-sickness integrated) — no gold revision.
`layer: prompt (caution) + editorial` · `status: ENCODED (golds unchanged)` · `rec: KEEP — soft caution, "very sparingly"`

### contradiction

**CON-1** | One sentence naming what the song refuses to resolve — true on both sides at once, **with no resolution**.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**CON-2** | Must say something **no other field says** (if it restates take/lens, it's dead).
`layer: tier2(extend lens-coherence/redundancy) + editorial` · `status: PARTIAL` · `rec: KEEP`

**CON-3** | **`null` is the honest, preferred call** for a song at peace with itself. Never manufacture one.
`layer: prompt + schema(nullable)` · `status: ENCODED` · `rec: KEEP`

**CON-4** | Don't close it with a thesis ("the joy and the grief belong to each other" = too resolved).
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**CON-5** | Tying the knot to the song's **central concrete anchor** sharpens it (the driver's license / the route to his door).
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

### arc

> **Expansion (#69):** ARC-1…4 are the spec's set; **ARC-5…15 below were mined from the 10 raw authoring
> transcripts** for your taste calls. Each is a candidate for your selection pass.

**ARC-1** | 2–4 beats, **most songs earn 3**; 4 only for a true four-movement song; 2 for a chant/one-mood. Count real emotional turns, not sections; never pad to look thorough.
`layer: prompt + schema(2-4)` · `status: ENCODED` · `rec: KEEP`

**ARC-2** | `label` = the emotional **event**, house form "The [event]"; **never Verse/Chorus/Bridge.**
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**ARC-3** | `mood` = 2–3 words; **may repeat** across beats (monochrome songs are honest).
`layer: prompt + schema` · `status: ENCODED` · `rec: KEEP`

**ARC-4** | `scene` = one+ complete sentence inside the moment. The recap ban bites hardest here: subject acts, no aphoristic kicker, no comma+`-ing`.
`layer: tier2 arc-narrative + tier1` · `status: ENCODED` · `rec: KEEP`

> **Arc-scene taste expansion — mined from the 10 authoring transcripts (candidates for your selection).**
> Items already covered elsewhere were folded, not repeated: structural names → MEC-10; subject-is-actor →
> SFT-2; mirrored/negation parallelism → SFT-7/MEC-6; connect-prose/fragments → SFT-5/MEC-1; vary openers →
> SFT-3; spine-word repetition → TYP-3; scene burstiness → tier1; beat-count-from-sections → ARC-1/TYP-1/TYP-3.
>
> **Gold-validated (per the "validate against the exemplars, not just the sessions" check):** ARC-5/6/8 were
> softened below to match what the golds actually do; ARC-13 is gold-confirmed; gold-vs-rule conflicts are in §K.

**ARC-5** | End on a concrete action/image; **stop at the real turn.** The ban is the *neat AI-button* ("the calm is the cruelty") and the *over-explaining tag* ("the regret now the most useful thing he owns") — **not** every interpretive turn. Golds end on turns and short active metaphors ("It becomes a vow.", "he is the one it cannot reach.") and those are fine. *(As It Was / DtMF / Motion Sickness / Not Like Us)*
`layer: editorial + prompt (tier2 only if a clean signal emerges)` · `status: PARTIAL (SFT-1)` · `rec: KEEP — softened: golds end on turns, so editorial not a hard gate`

**ARC-6** | When a beat has many parallel events/details, **anchor on one or two** and let them carry the turn; don't catalogue many at equal weight. *(Gold check: DtMF scene 2 keeps two — "His brother has a son. His closest collaborator a daughter." — so "few," not strictly "one.")*
`layer: tier2 (extend recap_scenes) + prompt` · `status: PARTIAL` · `rec: KEEP — softened to "few"`

**ARC-7** | **No stepwise march** — "He told her X. He was Y. She does Z." Flowing, image-led prose instead. *(Motion Sickness — "if this kind of lingo is not in the prompt, tier 2 analysis for rejection it should")*
`layer: tier2 arc-narrative (recap_scenes)` · `status: PARTIAL` · `rec: KEEP — gate`

**ARC-8** | A scene must not **duplicate the same insight/sentence** the take, contradiction, or image already spends — each beat owns ground no other field holds. **Exception:** load-bearing spine repetition is fine (As It Was take *and* scene both land "as it was"; TYP-3). *(Beautiful Things "almost verbatim the take"; Motion Sickness; Not Like Us restates contradiction; drivers license)*
`layer: tier2 (NEW redundancy) + editorial` · `status: GAP` · `rec: KEEP — scoped to duplication; spine-words exempt`

**ARC-9** | **Scene register matches the song's** — a plain/chant song gets plain scenes and the closing beat gets no licence to turn writerly; but plain must stay **song-specific, never generic**. *(No Sex for Ben — "the lyrics are quite simple and direct, so should this be")*
`layer: prompt + tier2 register-specificity` · `status: PARTIAL` · `rec: KEEP`

**ARC-10** | **Stitch the beats** — a concrete phrase/image from one beat echoes into the next so scenes chain rather than list; shuffling should break the story even when mood is flat. *(As It Was callbacks; No Sex "shuffling should break the story")*
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**ARC-11** | Scenes **stay in the present moment** — no anticipatory/consequence-signaling, no looking ahead. *(Pink Pony — "remove this 'She already knows what leaving will cost.'")*
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**ARC-12** | The **last beat doesn't tie a bow.** Don't let the closing scene or label *resolve* the song's central tension — leave it open, the way the `contradiction` is open (CON-3). A song that ends conflicted should end conflicted. *(Pink Pony closes on "she keeps on dancing" — she still loves Tennessee and dances anyway, unresolved; the label "Loving Reconciliation" was rejected as "too tidy.")*
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**ARC-13** | Don't restate lyrics as the **substance** of a scene (recap) — **but** a quoted direct-speech fragment is allowed when the lyric *is* the emotional action; if you reference a lyric, use the song's **actual words**, not a lossy paraphrase. *(Pink Pony "God, what have you done." / "I'm just having fun."; "everyone" → "boys and girls can all be queens")* **✓ Gold-confirmed** — drivers license scene 2 and Pink Pony scenes 0–1 quote lyrics directly.
`layer: prompt + editorial` · `status: PARTIAL (INT-2)` · `rec: KEEP — note the exception`

**ARC-14** | Arc `mood` is a **two-word qualified emotion** — not an act ("Desperate Prayer"), not a lone bare word ("Arrival" → "Wild Arrival"). *(Beautiful Things, Pink Pony.)* ✓ blinding-lights fixed (GR1); all 9 golds now comply.
`layer: prompt + tier1(mood-width check)` · `status: GAP (golds clean; ready to gate)` · `rec: KEEP`

**ARC-15** | A person named in a scene whom an outsider won't know gets **relationship context, not a bare name** ("his brother," not "Jan") — **unless they're very famous** (no gloss needed for a Drake or a Beyoncé). *(DtMF — "who is Jan and Bernie? … makes sense to tell who they are rather than their name")*
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP — with the famous-person exception`

### lines

**LIN-1** | 1–5 **exact** quotes, each `{ line }`, **no gloss** (the line speaks for itself).
`layer: prompt + schema(1-5)` · `status: ENCODED` · `rec: KEEP`

**LIN-2** | Each line lands a **distinct** hit; a one-idea song earns one line. Don't pad to five.
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP`

**LIN-3** | Order by position in the song; span its emotional range.
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**LIN-4** | Foreign-language: quote the original, then an inline parenthetical English gloss (natural, not word-for-word).
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**LIN-5** | A line may carry `\n` to quote a couplet.
`layer: prompt + schema` · `status: ENCODED` · `rec: KEEP`

**LIN-6** | `lines` is exempt from all prose rules (bare quotes; punctuation is the artist's).
`layer: tier1 (already excludes lines)` · `status: ENCODED` · `rec: KEEP`

**LIN-7** | Memorability can outrank decodability — line selection is a taste call.
`layer: editorial` · `status: GAP` · `rec: KEEP`

**LIN-8** | Dedup against image/take/arc — don't quote a line another field already spends.
`layer: tier2(NEW redundancy) + editorial` · `status: GAP` · `rec: KEEP`

**LIN-9** | **Use annotations to find lines.** Prefer quoting lines the annotations mark as important/relevant (the quote must still be exact heard text; the annotation only guides *selection*). Subject to the GRD-6 vote gate.
`layer: prompt + data` · `status: GAP` · `rec: KEEP — new, from your note`

### texture

**TEX-1** | Write **only** when audio features are provided; `null` otherwise.
`layer: prompt + schema(nullable)` · `status: ENCODED` · `rec: KEEP`

**TEX-2** | One sentence on the physical sound, **turning on a contrast by its end** (comma or second sentence, never a trailing dash).
`layer: prompt + tier1 dash` · `status: ENCODED` · `rec: KEEP`

**TEX-3** | Ground it in the data: audio features are the sound; **genre (from the DB, not memory)** sharpens the words.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**TEX-4** | `acousticness ≠ a specific instrument` (don't claim "piano").
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP`

**TEX-5** | Genre comes from `song.genres`, not prior knowledge.
`layer: prompt + data` · `status: ENCODED` · `rec: KEEP`

**TEX-6** | A human gold can be wrong about sound too ("propulsive" → "unhurried" at 107 BPM / energy 0.55).
`layer: editorial (calibration note)` · `status: N/A` · `rec: KEEP`

**TEX-7** | **Don't assert dynamics** (a build, swell, drop) from static averages — a single mean can't show a rise.
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**TEX-8** | Never infer the sound from the lyrics: "if you cannot hear it, you do not know it."
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

**TEX-9** | End on an image; cut the slowing list (drop "güiro and hand drums" to land on "a party already turning into a memory").
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

**TEX-10** | Carries the **tempo-vs-emotion gap** (bright sound over dark words) in its contrast clause.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

---

## F. Specificity vs. the gold — the frontier — §9.5

**SPC-1** | Where the gold names the **exact noun/detail**, the candidate must too — never the category/euphemism ("what girls?" → "hide your lil' sister"). This is where v14/v15 lost to gold; pairwise-judge the candidate against the matching gold and read the **rationale**, not just win/tie/loss.
`layer: tier2 register-specificity + pairwise` · `status: ENCODED` · `rec: KEEP`

---

## G. Song-type conditionals — match the read to the type — §5

**TYP-1** | **Surface-true / chant** — short take (1 sentence), 2–3 beats, few lines, `contradiction: null`. Keep song-specific anchors; don't inflate; don't import depth.
`layer: prompt + tier2 lens-coherence (SURFACE)` · `status: ENCODED` · `rec: KEEP`

**TYP-2** | **Foreign-language** — inline gloss; **lead with the specific cultural/diaspora reading**, not a generic "leaving home." Place-names get one phrase of context or get replaced. Lens always in English.
`layer: prompt` · `status: PARTIAL (gloss yes; cultural-lead emphasis not explicit)` · `rec: KEEP`

**TYP-3** | **Monochrome / one deep mood** — repeated mood across beats is correct; load-bearing word repetition is earned.
`layer: prompt + tier2 arc-narrative (don't penalize flat mood)` · `status: ENCODED` · `rec: KEEP`

**TYP-4** | **Two-act narrative** — ARRIVAL family holds both leaving and landing; name the real axis (the queer reading), don't euphemize; interpret the bridge, don't restate it.
`layer: prompt + editorial` · `status: PARTIAL` · `rec: KEEP`

**TYP-5** | **Tempo-vs-emotion gap** — the bright-sound/dark-words contrast lives in `texture`'s contrast clause.
`layer: prompt` · `status: ENCODED` · `rec: KEEP`

---

## H. Cross-cutting principles — §7

**XCT-1** | **Each field must earn its keep.** If two fields say the same thing, one is dead — cut the redundancy (take vs contradiction; tension vs arc-mood; image vs lens; a `lines` quote already used).
`layer: tier2(NEW redundancy judge) + editorial` · `status: GAP` · `rec: KEEP`

**XCT-2** | **Establish lyric agency before writing** — who holds the power, in which direction? ("hands that won't let go" inverted a song about something being *taken* from him.)
`layer: prompt + editorial` · `status: GAP` · `rec: KEEP`

---

## I. CUT — fluff / provenance / collaboration process (approved)

Not entering the codifiable rule set:

- §intro provenance — lost handoff docs, re-audit-against-transcripts method.
- §0 working-order ("take → image → lens …") — authoring sequence, not a read constraint.
- §6 coverage map — dated v16-vs-v17 status; superseded by the `status:` tags above.
- §7 "diagnose before re-throwing options" — collaboration workflow.
- §7 communication preference ("current + 3 options + recommendation") — how *we* iterate.
- §7 "the user co-authors" — collaboration note.
- §7 Wikipedia *Signs of AI writing* page — diagnostic tool reference (its findings already in MEC/SFT).
- §7 "'properly done' = `bun run test` green" — test-discipline note.
- §7 "single source of truth for any rule number" — doc-hygiene meta-rule.
- §7 reproducibility caveat (old v14/v15 baselines unclean) — experiment hygiene.
- §8 "9 golds at a glance" table — reference, not principle.
- **LEN-8** (was "gold/vocab-doc seed outranks the doc") — process note, unclear out of context.
- **MEC-4** (no intra-word hyphens) — you allow "late-night"/"neon-lit"; pulled from the gate.

---

## J. Rubric assembly — the gate order the eval runs — §9

The kept principles compose into this scoring order (the audit's spine; not a new rule):

1. **Grounding (gate)** — GRD-1…9. Imported reception/biography/sound-from-words → fail; annotations vote-gated (GRD-6).
2. **Voice mechanics (gate)** — MEC-1…10; editorial adds SFT-5/7/8/9. Tier-1 `rules.ts` automates most; run it first (free).
3. **Interpret-not-describe** — INT-1…4; SFT-1 (no kicker), SFT-2 (subject is actor), SFT-5 (no fragmenting). Lead with insight; scenes render the turn, not a recap.
4. **Field correctness** — IMG/LEN/TEN/TAK/CON/ARC/LIN/TEX as specified.
5. **Specificity vs. gold (frontier)** — SPC-1. Pairwise-judge against the matching gold; read the rationale.

---

## K. Gold-vs-rule conflicts — found by validating against the 9 exemplars

Validating the rules against the actual `exemplars/*.json` (not just the sessions) surfaced places where a
**shipped gold breaks a rule**. The golds are the standing authority, so "fix the gold" is not automatic —
sometimes the gold reveals the rule is wrong. Each needs a call.

> **RESOLVED (2026-06-05):** GR1, GR2, GR4, GR5 fixed in the golds — vitest green (72/72); all moods are 2-word
> and none equals its tension. ARC-3 / ARC-14 (mood width), TEN-6 (mood dedup), and MEC-10 (structural names in
> prose) are now **unblocked** — safe to gate in Phase B. GR3 stays editorial.

**GR1 — blinding-lights one-word moods vs ARC-3 / ARC-14.** `blinding-lights` ships `mood: "Yearning"` (beat 0)
and `"Resolute"` (beat 2) — one word each, while ARC-3 (marked ENCODED) and ARC-14 require a two-word qualified
emotion. It is an original-4 gold, likely a straggler predating the standard. → two-word the moods (e.g.
"Aching Yearning" / "Quiet Resolve"), or relax the rule to allow a bare core emotion.
**→ RESOLVED:** beat 0 "Yearning" → **"Lonely Yearning"**, beat 2 "Resolute" → **"Blinded Resolve"**. Rule kept; gold fixed.

**GR2 — dtmf "The chorus lands:" in a scene vs MEC-10.** `dtmf` scene 0 reads "The chorus lands: I should have
taken more photos when I had you." — a structural-section name in prose, which MEC-10 bans (and the DtMF authoring
session itself banned "the chorus" in scenes). The shipped gold contradicts both. → revise the scene to drop
"chorus" (e.g. "Then the line that holds it all: …"), or carve a MEC-10 exception.
**→ RESOLVED:** "The chorus lands:" → **"Then the admission he keeps circling:"**. MEC-10 kept; gold fixed.

**GR3 (minor) — dtmf "in the song" / "inside the song" meta-reference vs SFT-8 / MEC-7.** `dtmf` take ("right
there in the song") and scene 1 ("inside the song") reference the song as an object. tier1 self-reference lists
"this song", not "the song", so it isn't gated today. Default (no decision needed unless you disagree): **leave
it editorial** — the DtMF gold uses "inside the song" deliberately to mark the photo-taken-within-the-recording
moment. Adding "the song" to the hard ban would require revising this gold.

**GR4 — blinding-lights beat-1 mood duplicated the tension (TEN-6).** Beat 1 shipped `mood: "Hollow Euphoria"`,
identical to the `tension`. **→ RESOLVED:** beat 1 → **"Sleepless Craving"**. (Found while fixing GR1.)

**GR5 — pink-pony-club beat-1 mood duplicated the tension (TEN-6).** Beat 1 (The Arrival) shipped
`mood: "Unrepentant Joy"`, identical to the `tension`. **→ RESOLVED:** beat 1 → **"Giddy Liberation"**. (Found while verifying GR4.)

**MEC-6 caveat (scope note, no decision).** Keep the editorial "ban the move" extension scoped to the AI
thesis-pivot ("it isn't X, it's Y"); do not flag the natural subordinate contrasts the golds use (see MEC-6).

---

## Revision log — annotation pass 2026-06-05

- **GRD-6** rewritten: annotation grounding vote-gated (`votes_total > 15`); real-person biography allowed if high-voted.
- **GRD-9** resolved: require an annotations slot in the prompt/input when annotations exist.
- **MEC-1** tightened: short fragments heavily discouraged.
- **MEC-4** CUT: intra-word hyphens allowed (Phase-B `dash`-rule + test change).
- **SFT-1 / SFT-5 / SFT-8** marked STRONG (promote toward gates).
- **INT-2** softened to "heavily discouraged"; **INT-3** kept soft (you were unsure).
- **IMG-2** softened: two images OK if well-harmonized.
- **LEN-4** reworded to avoid "this song"; **LEN-8** cut.
- **TAK-4** resolved: voiced-turn pivot allowed but "very sparingly"; golds unchanged.
- **LIN-9** added: use annotations to guide line selection.
- **ARC-5…15** added: 11 arc-scene taste calls mined from the 10 raw authoring transcripts (candidates for your selection).
- **Gold-validation pass** (per your push to validate against the exemplars, not just the sessions): read all 9 golds' arc data + ran a mechanical sweep. ARC-5/6/8 softened to match the golds; ARC-13 gold-confirmed; MEC-6 move-ban scoped; 3 gold-vs-rule conflicts logged in §K (GR1–GR3). Net: **4 golds break a rule** — blinding-lights (moods), dtmf (chorus + meta), not-like-us & pink-pony (antithesis caveat).
- **ARC annotation pass** (2026-06-05): ARC-5…15 reviewed — 9 kept as-is; ARC-12 rewritten in plain language ("last beat doesn't tie a bow"); ARC-15 graduated DECIDE → KEEP with a famous-person exception. GR1/GR2 deferred.
- **GR1/GR2 resolved** (2026-06-05): blinding-lights moods → "Lonely Yearning" / "Blinded Resolve"; dtmf scene 0 "The chorus lands:" → "Then the admission he keeps circling:". Mechanical audit clean (0 violations); `bun run test scripts/voice-audit/__tests__` green (72/72). MEC-10 + ARC-14 unblocked. GR3 stays editorial.
- **GR4/GR5 resolved** (2026-06-05): mood==tension duplications fixed — blinding-lights beat 1 "Hollow Euphoria" → "Sleepless Craving"; pink-pony-club beat 1 "Unrepentant Joy" → "Giddy Liberation". All 9 golds now have 2-word moods, none equal to their tension; vitest green. TEN-6 unblocked.
- **claudedocs cleanup** (2026-06-05): removed 12 superseded docs (11 `git rm` + 1 untracked) + empty `voice-compare/`; kept 9 (the 2 consolidation docs + 7 with unique live value); repointed 5 code-comment references to kept docs. Code clean (no dangling refs); deletions staged, not committed.
- DECIDE items resolved to KEEP: GRD-7, SFT-3, TEN-5, TEN-6, CON-5, TEX-6, TEX-9, LIN-7.
