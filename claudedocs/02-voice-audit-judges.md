# Handoff — Phase 2: LLM-judge encode + gold calibration

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
and the Phase-1 "Progress so far" block (for the annotation utility signature).

This is the **highest-risk phase.** A miscalibrated judge silently corrupts the whole
research loop in Phase 4 — it will reward or punish the orchestrator's edits for the wrong
reasons. The discipline is non-negotiable: **every judge must pass all 9 golds AND catch a
deliberately-broken negative.** Pass-only is not calibrated; fire-only is not calibrated.

## Mission

Build the three GAP judges the golds need but the eval can't yet see — above all the
**grounding judge**, which closes the specificity/grounding loss that beat v14/v15.

## Where judges live

`scripts/voice-audit/tier2/judge.ts` registers pointwise judges (~line 80) and runs them via
`judgeAnalysis()`; each judge's rubric is a file in `tier2/prompts/*.ts` returning a
Zod-validated `{ passed, evidence[], ... }`. Follow that existing shape exactly. The acceptance
pattern to copy is `check-lens-coherence.ts` (runs a judge live against golds + broken cases).

## Tasks

### Judge 1 — Grounding (PRIORITY 1: GRD-1/2/3/4/6)

The single most important judge in the program. Inputs: the candidate `read` + the song's
**lyrics + vote-gated annotations** (use the Phase-1 utility, `votes_total > 15`). Flags any
field whose content cannot be traced to a heard lyric or a high-voted annotation. It must catch:
- **GRD-2** imported cultural reception — chart position, "song of the summer", awards,
  crowd/chant behavior, the video's real-world impact.
- **GRD-3** biography/beef not in lyrics or a high-voted annotation. (High-voted annotations
  ARE fair game per GRD-6, including real-person biography — so the judge needs the annotations
  to adjudicate, not just the lyrics.)
- **IMG-3** constructed atmosphere ("empty room" when nothing says the room is empty).

Licensed exceptions it must NOT flag: **texture** (grounded in audio features, GRD-8), and
anything that traces to a `votes_total > 15` annotation. Para-textual (cover art / music
video) is a *flag for human review* (GRD-5), not an auto-fail — surface it separately.

Return `{ grounded: boolean, ungrounded_claims: string[], rationale: string[] }`.

**Model:** strongly consider a stronger model than Gemini Flash here (grounding is subtle and
this is the priority-1 signal). The pairwise judge already uses Opus; matching it for grounding
is defensible. Treat the model choice as a calibration decision and record it.

### Judge 2 — Redundancy (XCT-1 / ARC-8 / LIN-8 / CON-2)

Each field must earn its keep. Flag cross-field duplication: a scene that repeats the take;
a `lines` quote that duplicates what image/take already spend; a contradiction that restates
take or lens. **Exception (must pass):** load-bearing *spine repetition* — As It Was lands
"as it was" in both take and scene on purpose (TYP-3). Calibrate so that passes.

Return `{ distinct: boolean, redundant_pairs: string[], rationale: string[] }`.

### Judge 3 — Voice-softness (SFT-1 / SFT-5 / SFT-7)

One combined judge (saves tokens) returning per-check flags:
- **SFT-1 aphoristic kicker** — a neat AI-button ending a beat/take ("The calm is the
  cruelty"). **Hardest boundary:** golds legitimately end on short active turns/metaphors
  ("It becomes a vow.", "he is the one it cannot reach.") — those are NOT kickers (ARC-5 was
  softened to match the golds). The judge must distinguish the *button* from the *turn*. Lean
  entirely on the 9 golds to draw this line.
- **SFT-5 fragmentation** — a pile of clipped standalone pronouncements severing connective
  tissue. One fragment that lands is fine; the pile is the tell.
- **SFT-7 mirrored "X is the Y" parallelism** — manufactured profundity by symmetry.

Return `{ clean: boolean, kicker_hits: string[], fragment_hits: string[],
parallelism_hits: string[], rationale: string[] }`.

### Do NOT build judges for the editorial-only principles

SFT-2 (subject-is-actor), SFT-9 (simile crutch), SFT-3/6, ARC-10/11/12, IMG-4 — these are
`editorial` in the doc. They live in the v17 prompt (Phase 3) and the human's review. Adding
judges for them spends tokens to manufacture noise.

## The calibration gate (the actual deliverable)

For **each** of the three judges:
1. Run it live against all 9 golds → **all 9 must pass.**
2. Run it against ≥1–2 deliberately-broken negative fixtures → **must fire** with the right
   evidence. Build these in `tier2/` (e.g. a gold with a chart fact spliced into `take` for
   grounding; a gold whose contradiction restates the take for redundancy; a gold ending on
   "The calm is the cruelty" for the kicker). Wire them into a `check-*.ts` acceptance script
   mirroring `check-lens-coherence.ts`.

If a gold fails a judge, it's a calibration bug in the *judge prompt* (the golds are truth) —
tighten the rubric and the few-shot until the golds pass without making the judge toothless
against the negatives. This back-and-forth IS the work.

## Wire-in

Register the three judges in `judgeAnalysis()` so the harness runs them alongside the existing
five, and so Phase 3's scoreboard can read their results. Keep the token-budget accounting
consistent with the existing judges.

## Done criteria

- [ ] Grounding, redundancy, voice-softness judges built (shape matches existing judges).
- [ ] Each: all 9 golds pass.
- [ ] Each: ≥1 negative fixture caught, via a `check-*.ts` acceptance script.
- [ ] All three registered in `judgeAnalysis()`.
- [ ] Model choice per judge recorded with rationale (esp. grounding).
- [ ] `bun run test scripts/voice-audit/__tests__` green (judges that make live calls stay in
      acceptance scripts, not the vitest gate — match how `check-lens-coherence.ts` is wired).

## Hand to Phase 3

Append a "Progress so far" block: each judge's name, return schema, model, the negative
fixtures + what they catch, and any boundary you found hard to calibrate (the orchestrator
needs to know where a judge is least trustworthy).

---

## Progress so far — Phase 2 COMPLETE (2026-06-05)

All three judges built, registered in `judgeAnalysis()`, and calibrated: each passes all 9
golds and fires on its negatives via a `check-*.ts` acceptance script. `bun run test
scripts/voice-audit/__tests__` green (**96/96**, was 95 — the live judges stay in the check
scripts, not vitest); `bun run typecheck` clean. No production code flipped (research-only).

### The three judges (name · schema · model · wire-in)

1. **grounding** (PRIORITY 1) — `tier2/prompts/grounding.ts` + `tier2/grounding-judge.ts`.
   Schema `GroundingSchema` → `{ grounded: boolean, ungrounded_claims: string[],
   paratextual_flags: string[], rationale: string[] }`. **Model: Opus**, via the `claude`
   CLI (`runClaude`, same path the pairwise judge uses) — **not** Gemini and **not**
   `createLlmService`. Rationale: grounding is the subtlest call in the program (telling a
   fair interpretation of a heard lyric apart from an imported real-world fact) and the one
   place a miscalibration silently corrupts Phase 4; it earns the strong model. Cost ≈
   **$0.12–0.15 per read** (not-like-us is the outlier — 72 KB of annotations). Inputs: the
   `read` + the song's full **heard lyrics** + the **vote-gated annotations** (`> 15`, via the
   Phase-1 `selectGroundingAnnotations`/`renderAnnotationsBlock`, loaded by the new
   `scripts/voice-audit/lyrics-context.ts → loadGroundingContext(key)`). The judge is told to
   judge ONLY against those two sources and explicitly **not** use its own knowledge of the
   song — the exact inverse of the pairwise judge, which is told to use its knowledge.
   Para-textual ties (cover art / video) go to `paratextual_flags` for human review and do
   **not** fail the read (GRD-5). `grounded` is the gate.

2. **redundancy** — `tier2/prompts/redundancy.ts`. Schema `RedundancySchema` → `{ distinct:
   boolean, redundant_pairs: string[], rationale: string[] }`. **Model: Gemini** (via
   `makeJudge`, alongside the existing five). Read-only (prose fields; `lines` deliberately
   out of scope — see boundaries).

3. **voice-softness** — `tier2/prompts/voice-softness.ts`. Schema `VoiceSoftnessSchema` → `{
   clean: boolean, kicker_hits: string[], fragment_hits: string[], parallelism_hits:
   string[], rationale: string[] }`. **Model: Gemini** (via `makeJudge`). One combined judge
   for SFT-1 / SFT-5 / SFT-7.

`judgeAnalysis()` now takes an optional `context: { grounding?: GroundingContext }`. The five
existing + redundancy + voice-softness run on Gemini in the `JUDGES` loop; **grounding runs
only when `context.grounding` is supplied** (the generic `runTier2OnFiles` has no lyrics, so
it skips grounding — Phase 3's scoreboard must map each candidate's song → lyrics and pass the
context). Grounding's Opus cost is returned as `groundingCostUsd` and kept **off** the Gemini
token budget (the CLI reports dollars, not prompt/completion tokens).

### Calibration result (the deliverable)

| judge | acceptance script | result |
|---|---|---|
| grounding | `check-grounding.ts` | **12/12** — 9 golds grounded + 3 negatives flagged |
| redundancy | `check-redundancy.ts` | **11/11** — 9 golds distinct + 2 negatives flagged |
| voice-softness | `check-voice-softness.ts` | **12/12** — 9 golds clean + 3 negatives flagged |

Run them with `bun scripts/voice-audit/check-<judge>.ts`. `check-grounding.ts` accepts gold
keys as args to narrow the (expensive) positive set for cheap iteration, e.g.
`bun scripts/voice-audit/check-grounding.ts blinding-lights` (negatives always run). Total
Opus spend across the whole calibration was ≈ $3.

### Negative fixtures (built inline by mutating golds, like check-lens-coherence)

- **grounding**: `broken:reception` (chart/"song of the summer"/tour spliced into
  no-sex-for-ben's take — zero annotations, so unambiguous, GRD-2); `broken:biography`
  (a record-deal/viral-audition backstory spliced into beautiful-things, GRD-3);
  `broken:atmosphere` ("empty rain-soaked parking lot at 3 a.m." spliced into a
  drivers-license scene, IMG-3).
- **redundancy**: `broken:contradiction-restates-take` (drivers-license contradiction set to
  two verbatim take sentences, CON-2); `broken:scene-restates-take` (a beautiful-things scene
  replaced by the take's verbatim opening sentence, ARC-8).
- **voice-softness**: `broken:kicker` ("The calm is the cruelty." appended to a take — fires
  kicker **and** parallelism); `broken:fragment-pile` (a scene replaced by a pile of clipped
  fragments, SFT-5); `broken:parallelism` ("She is the question; he is the answer." appended,
  SFT-7).

### Provider note (important for Phase 3 running these)

The AI Studio `google` key (`GEMINI_API_KEY`) is **out of prepay credits** in this env, so the
Gemini check scripts use **`createLlmService("google-vertex")`** (GCP-billed, ADC — the config
default and what the stored experiments used). `check-lens-coherence.ts` still hardcodes
`"google"` and will fail until the AI Studio key is topped up or it's repointed to vertex; the
prod `runTier2OnFiles` default is also still `"google"`. Phase 3 should standardize the
pointwise judges on `google-vertex` (or pass an explicit `llm`).

### Boundaries that were hard to calibrate — where each judge is least trustworthy

These are the orchestrator's danger zones (Phase 4): a judge is weakest exactly here.

- **grounding — atmospheric color vs. fabricated setting (IMG-3). This is the judge's most
  sampling-sensitive edge — watch it.** IMG-3 is the softest of the three grounding checks,
  and Opus (at the CLI's default temperature) tends to flag **exactly one** atmospheric
  interpretive detail per full run, and *which* one drifts: the first full pass flagged
  blinding-lights "the whole city burning at **4 a.m.**"; after the first fix it instead
  flagged drivers-license "the **empty road**" as "contradicting the song's traffic/white-cars
  imagery." Both are the read rendering a *stated feeling* as physical atmosphere (up-till-
  sunrise → 4 a.m.; "I drive alone past your street" → empty road), which is grounded
  interpretation, not an import. The fix that held (verified on both flaky golds + the
  negatives, 5/5, then certified by a clean full 12/12 pass): make the atmosphere check
  **narrow and conservative** — fire ONLY on a
  wholly new physical place/object/weather the song never references (the negative's "rain-
  soaked parking lot"), and explicitly never on (a) emotion rendered as atmosphere, (b) a
  later beat's atmosphere "contradicting" an earlier one (songs move), or (c) "empty"/"alone"
  framing when the lyric states the solitude. Reception (GRD-2) and biography (GRD-3) — the
  signals that actually beat v14/v15 — are far more stable; atmosphere is the soft tail.
  **For Phase 4: if grounding flaps on a single atmospheric detail, it is almost certainly
  this, not a real import** — treat a lone IMG-3 atmosphere flag with suspicion (re-run, or
  human-confirm) and trust the reception/biography flags. Consider pinning the grounding model
  to a low temperature if the CLI path ever exposes it. The para-textual surface is advisory,
  never a fail.
- **grounding — output shape.** Opus sometimes returns `ungrounded_claims` items as
  `{claim, reason}` objects instead of strings; `GroundingSchema` now coerces objects to one
  readable string (`coercedStringArray`) so a real flag is never lost to a parse error. Only
  the hand-parsed Opus path needs this; the `generateObject` judges adhere to `string[]`.
- **redundancy — the least trustworthy judge; treat as advisory, not a hard gate.** It
  reliably catches **wholesale duplication** (a field that is essentially a verbatim copy of
  another with nothing added) — that is all the negatives are, and all it should fire on. It
  does **not** reliably catch the subtle CON-2 case (a contradiction that *rewords* the take's
  thesis without copying a sentence), because the golds legitimately do two things that look
  identical to a naive judge: (a) take/contradiction/arc all orbit one central insight (that's
  coherence, the point of the read), and (b) the take *previews* a beat's anchor sentence that
  the scene then dramatizes verbatim (the take→scene relationship + TYP-3 spine repetition —
  As It Was "as it was", motion-sickness "she got out, glad of it", dtmf's grandfather line).
  Calibrating it to pass those forced the firing bar up to "essentially a copy". **`lines` was
  removed from its scope entirely** — quoting the song's pivotal words echoes the take by
  nature, so LIN-8 stays editorial. Net: redundancy is a low-recall gate. Phase 4 should treat
  a redundancy flag as a strong signal but a *pass* as weak evidence, and lean on the human +
  pairwise for the subtle reword/echo cases.
- **voice-softness — kicker (SFT-1) is the knife-edge.** The golds end beats on short active
  turns ("It becomes a vow.", "he is the one it cannot reach.", "She still fuckin' loves
  him.") and a wry colloquial aside ("The denial doing what denial does.") — none are kickers.
  The boundary that works: a **kicker manufactures profundity in abstract poster-language and
  admires itself**; a **turn** advances the person/moment and a **wry aside** uses plain
  conversational words. The judge leans on few-shots that are the actual golds (PASS) vs. the
  named anti-patterns "The calm is the cruelty" / "the regret now the most useful thing he
  owns" (FAIL). It is calibrated, but this is the field most likely to drift on a novel
  candidate; if Phase 4 sees softness flapping, add the disputed line to the PASS/FAIL
  few-shots rather than loosening the definition. SFT-5 (fragment *pile* vs. single landing)
  and SFT-7 (mirrored "X is the Y" vs. a grounded paradox like not-like-us's contradiction)
  were comparatively stable.

### Files

- New: `tier2/prompts/grounding.ts`, `tier2/prompts/redundancy.ts`,
  `tier2/prompts/voice-softness.ts`, `tier2/grounding-judge.ts`, `lyrics-context.ts`,
  `check-grounding.ts`, `check-redundancy.ts`, `check-voice-softness.ts`.
- Edited: `tier2/schemas.ts` (3 schemas + `coercedStringArray` + types), `tier2/judge.ts`
  (registered redundancy + voice-softness; grounding pass + `JudgeContext`),
  `__tests__/tier2-schemas.test.ts` (3 new schemas, incl. the non-failing para-textual case).
- No gold edited; no fixture edited. The golds passed every judge as-is (the "4 a.m." flag was
  a judge over-reach, fixed in the judge per the standing rule — golds are truth).
