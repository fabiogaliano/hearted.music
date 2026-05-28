# Handoff: Song-Analysis Prompt Optimization — Eval-First Phase

Paste this whole file into a fresh conversation to continue. It is self-contained. You are a **research agent**: you may search the web for best practices, evaluation frameworks, and prompt-optimization techniques, then act to optimize the analysis prompt empirically.

---

## Mission

Find the best **song-analysis prompt for `gemini-2.5-flash`** that:
1. **Reads like Hearted** — warm, observant, image-rich, a friend who notices (see `v1_hearted_brand/brand/VOICE-AND-TONE.md`).
2. **Has no AI-writing tells** — both the surface tells we already encode (Tier-1 rules) **and** the statistical tells the rules miss (low lexical diversity, repetition, low burstiness, nominalization, POS skew).
3. **Uses no dashes or hyphens** (hard constraint; the brand prefers commas, and dashes are a practitioner-recognized tell).

We iterate empirically: change one thing, generate real analyses, score them, read the prose, compare, repeat.

**The previous phase already got us most of the way.** Read "Where things stand" before doing anything — do not relitigate solved problems.

---

## Where things stand (production already updated)

- **`ACTIVE_LYRICAL_VERSION = "13"`** (`src/lib/domains/enrichment/content-analysis/prompts/registry.ts`). v13 is the warm + dash-free + opener-fixed prompt.
- **Production generates at `temperature: 0.3`** (`song-analysis.ts:~117`, passed to `LlmService.generateObject`). This was the single biggest lever found (see below). Was previously unset (provider default ~1.0).
- **v13 @ 0.3, validated across 5 genres (15 runs):** mean-high **1.93**, mean-medium **1.47**, **1 dash in 15 runs**. Warm across all genres (confirmed by reading prose).
- Nothing is committed; changes are in the working tree on `main`.

### The two prior phases in one paragraph
Phase 1 (earlier handoff) used sentence-SHAPE constraints to kill participial closures, taking NLU from ~15 to ~2.7 high (v8, clinical but flat). Phase 2 (just finished) layered brand voice + a no-dash rule on top. Key results below.

### Results history (mean high over ≥3 runs; lower better)

| Version | Strategy | NLU high | notes |
|---|---|---|---|
| v8 | structural core, clinical, not dash-constrained | 2.7 | flat, the old baseline |
| v9 | prominent `THE VOICE` section + image-density | 8.3 | **regressed** — warmth summoned participials |
| v10 | subordinate warmth paragraph | 5.3 | still regressed |
| v11 | "bind warmth to shape" + scrub `the listener` prime + dehyphenate | 3.7 [0–8] @ default temp | warm, dash-free, but high variance |
| v12 | v11 + inline self-audit checklist | 4.0 | **negative result** — made medium worse |
| **v11 @ temp 0.3** | same prompt, low temperature | **1.67** | variance collapsed, mean halved |
| **v13 @ temp 0.3** | v11 + interpretation opener fix | **1.93 (5-song)** | **current production**; opener tell 5→1 |

---

## Hard-won lessons (DO NOT relitigate)

1. **Temperature is the dominant variance lever.** Generation ran at ~1.0; dropping to 0.3 halved mean-high and collapsed run-to-run variance, on *any* prompt. Prompt wording shapes the *center* of the output distribution; temperature controls its *spread*. When output is inconsistent, suspect temperature before prompt. Do NOT go to 0 (degenerate, repetitive, inflates lexical-repetition). 0.3 is the tested sweet spot; a micro-sweep (0.2 / 0.3 / 0.4) is a cheap open question.
2. **Constrain sentence SHAPE, not vocabulary.** "Each image is its own complete sentence, never a comma+`-ing` clause" beat every vocabulary ban.
3. **Prompt warmth and structural constraints pull opposite ways; bind warmth to shape.** Don't remove vivid imagery — teach its clean *form* (a complete sentence) vs the dirty form (a participial tail). v9/v10 removed/diluted this and regressed.
4. **Never put a Tier-1-banned phrase in the prompt** — it primes. v9/v10 used "the listener" (banned) and the interpretation field asked "what is this *about*?" which primed "This is about…". Removing the prime dropped openers 5→1.
5. **Long ban-lists backfire; rewrite examples beat prohibitions.** (Phase 1 finding, still holds.)
6. **Inline self-audit does NOT work** (v12). gemini-2.5-flash cannot reliably re-edit its own JSON in one forward pass — it rephrased into copula/puffery forms and naming tells primed them. A *separate* narrow rewrite call is different and is still on the table (Phase B below).
7. **Write the prompt body dash-free** (em dashes → commas, `2-4` → `2 to 4`, header `{artist}, "{title}"`). The model mirrors prompt punctuation; this drove output dashes to ~0. Don't even print hyphenated forms in `Wrong:` examples — state the de-hyphenated target instead.
8. **Variance is real; run ≥3×, compare means, read the prose.** A clean Tier-1 score is necessary, not sufficient.

---

## The recommended path: EVALUATE FIRST, then optimize

**Rationale.** Tier-1 high is now ~1.9 and plateauing, with ~25% of remaining `participial-closure` hits being rule false positives (appositives like "taunting send off"). We are close to the ceiling of what the *surface* scorer can tell us. Pushing further (rewrite pass, more prompt tweaks) risks **overfitting to the proxy** instead of the real goal ("reads like a human friend, not AI"). The Tier-1 rules deliberately do not measure the statistical tells the detection literature considers most reliable. So the highest-leverage next move is to build a metric that measures the actual target, then optimize against *that*.

### Phase A — Build a real evaluation layer (do this first)

**Step 0 — research the eval-design space before you build anything.** Do not treat the design below as fixed; it is a starting hypothesis. First search the web and decide the approach. Look into: LLM-as-judge methodology and pitfalls (G-Eval, pairwise vs pointwise/Likert, position & verbosity & self-enhancement bias and how to control them, judge calibration, ensembling/self-consistency, choosing a judge model different from the generator); existing eval frameworks you could reuse rather than hand-roll (e.g. promptfoo, DeepEval, RAGAS-style metric libraries, OpenAI/Anthropic evals patterns, Braintrust); the AI-text-detection literature for which signals actually discriminate (DetectGPT, Binoculars, GPTZero's perplexity+burstiness framing, lexical-diversity/MTLD, POS and function-word distributions); and how others evaluate *brand-voice / tone adherence* specifically. Write a 5-to-10-line "eval design decision" note (what you chose and why, what you rejected) into a `claudedocs/` file before implementing. Then build it, keeping Tier-1 as a fast deterministic guardrail and layering the chosen metrics on top.

Starting hypothesis to pressure-test (not a spec):

1. **LLM-as-judge, pairwise.** A `gemini`/`claude` judge that compares two analyses of the same song ("which reads more like a warm human friend and less like AI? which better matches this Hearted voice rubric?"). Research: G-Eval, pairwise vs pointwise, position-bias mitigation (swap order, average), self-consistency, rubric design, judge-model choice (consider a *different* model than the generator to avoid self-preference). Build a small set of human-written / hand-polished "gold" Hearted analyses to anchor the comparison.
2. **Statistical tells the Tier-1 rules miss.** Implement a few cheaply: lexical diversity (type-token ratio, **MTLD**), true sentence-length **burstiness** (we have a crude CV; compare to human baselines), function-word ratios, optionally **perplexity / Binoculars-style** scoring if a small LM is available. Research the AI-text-detection literature (DetectGPT, Binoculars, GPTZero methodology, the "perplexity + burstiness" framing) for what actually discriminates.
3. **Sanity check with an external AI detector** on a handful of outputs to see if "passes Tier-1" correlates with "reads human".

Deliverable: a `scripts/voice-audit/` evaluator that, given stored experiment runs, reports judge win-rate vs gold + statistical-tell scores, alongside the existing Tier-1 tallies. This becomes the optimization target.

### Phase B — Optimize against the better metric

Only after Phase A gives a trustworthy target:

1. **Cheap wins first (free / low-cost):**
   - Rule precision: exempt the remaining appositive participial false positives ("taunting send off", "annoying details … resurface" — add `resurface` to `PARTICIPIAL_FINITE_VERBS`; the adjective+noun appositive is the harder, ambiguous case). Re-score history.
   - Temperature micro-sweep 0.2 / 0.3 / 0.4 on the fast loop; read prose (lower = cleaner but blander — find the warmth/cleanliness knee).
2. **Narrow rewrite second-pass** (the handoff's escape hatch, now in its ideal regime: only ~2 flagged sentences/analysis). Generate with v13@0.3, then for runs with `high` hits feed *only* the Tier-1-flagged spans (`hits[].field` + `hits[].span`) to a targeted "drop the trailing `-ing` clause / remove the framing opener" call. Fire only when hits exist. **Validate with the Phase-A judge** that the rewrite improves (not flattens) the prose — this is the whole point of building the eval first.
3. **Consider automated prompt optimization.** Research **DSPy** (MIPROv2, BootstrapFewShot), OPRO, evolutionary/APE prompt search. With a trustworthy metric (Phase A) and the harness already wired, an automated search over prompt variants may beat hand-tuning, which has plateaued. Weigh build cost vs. the marginal gain from ~1.9 → ~0 high.

### My opinion on "should we pursue the rewrite pass, or stay here?"
Neither, yet. **Build the eval first.** v13@0.3 is already a large, shippable win (warm + dash-free + ~2 high). The rewrite pass is the right *Phase B* tool but committing to it before we can measure "does this actually read more human" is optimizing blind. The eval is the unlock; the rewrite pass and/or DSPy are how you spend it.

---

## How to run (already wired up)

Prereqs (one-time): `gcloud auth application-default login --project=hearted-492606`; then `bun scripts/smoke-vertex.ts` should print `response: hello`. Generation runs via **Vertex AI** (`google-vertex:gemini-2.5-flash`, GCP-billed, no free-tier cap). Use `--provider google` only for one-offs (AI-Studio key, 20/min cap).

```bash
# Generate + audit. --songs: fast (2) | standard (5) | final (8) | comma-keys. --temperature sets sampling temp (recorded).
bun scripts/voice-audit/regen.ts --version 13 --songs fast --runs 3 --temperature 0.3
bun scripts/voice-audit/regen.ts --version 14 --songs standard --runs 3 --temperature 0.3

bun scripts/voice-audit/report-experiments.ts   # aggregate by song/version: mean/min/max high, top rules
bun scripts/voice-audit/rescore.ts              # re-score stored runs under current rules (no API calls)
bun run test scripts/voice-audit                # 39 rule tests (vitest via bun run test)
```

Cost tiers (generation is the billed step, scaling with `songs × runs`): **fast** (Not Like Us + Motion Sickness) to iterate; **standard** (5-song spread) for a candidate check; **final** (8 songs) for promotion only. Iterate on fast; never run `final` while exploring.

---

## Repo map

**Prompts** (versioned immutable files; production reads the active pointer):
- `src/lib/domains/enrichment/content-analysis/prompts/` — `lyrical-v2.ts … lyrical-v13.ts`, `instrumental-v{2,3}.ts`, `types.ts`, `registry.ts`.
- `registry.ts`: `ACTIVE_LYRICAL_VERSION` (= **"13"**), `getLyricalPrompt(v)`, `listLyricalVersions()`. Bump the pointer to ship.
- v13 = the current best. v11 = v13 without the opener fix. v8 = the old clinical baseline. Start a new prompt as `lyrical-v14.ts` (copy v13), register it, do NOT change the active pointer until it wins.

**Audit + experiment harness** (`scripts/voice-audit/`):
- `tier1/rules.ts` — 13 deterministic rules (the scorer). `dashes` added this phase; `PARTICIPIAL_FINITE_VERBS` extended for adjective-subject false positives.
- `regen.ts` — generate one+ songs with `--version/--model/--provider/--runs/--songs/--temperature`, audit, record. No DB writes.
- `experiments.ts` + `experiments/` — append-only store: full `<runId>.json` per run + `runs.jsonl`. Records `temperature`; runId gets a `__t0-3` suffix when set.
- `report-experiments.ts` — aggregates by version/model. **Note: groups by version+model, NOT temperature** — when comparing temps, read the `regen.ts` console summary or filter `*__t0-3*.json` directly (see below). Improving this to group by temperature is a nice-to-have.
- `rescore.ts` — re-runs current rules over stored analyses (free retroactive re-scoring after a rule change).
- `__tests__/rules.test.ts` — 39 rule unit tests; `fixtures/clean.json` is the dash-free "ideal" fixture.

**LLM transport:**
- `src/lib/integrations/llm/service.ts` — `LlmService`; `generateObject(prompt, schema, { maxOutputTokens?, temperature? })`. `temperature` undefined ⇒ provider default. (Pre-existing SDK deprecation warnings on `generateObject` are not your concern.)
- `src/lib/integrations/llm/config.ts` — `resolveLlmConfig(provider)`, `DEFAULT_LLM_PROVIDER = "google-vertex"`.
- `song-analysis.ts:~117` — production call, now passes `{ temperature: 0.3 }`.

**Brand (read before writing prompts):** `v1_hearted_brand/brand/VOICE-AND-TONE.md` (primary), `COPY-GUIDE.md`, `POSITIONING.md`.

**Findings docs (read these):** `claudedocs/voice-prompt-brand-voice-phase-findings-2026-05-27.md` (this phase, full detail), `claudedocs/voice-prompt-exploration-handoff.md` (prior phase).

---

## What the Tier-1 rules catch (the current scoreboard) — and their limit

`high`: `antithesis`, `participial-closure` (comma+`-ing` tail), `self-reference` ("this song"/"the track"), `academic-register` ("juxtaposition", "catharsis"), `book-report-opener` ("This is a…").
`medium`: `copula-avoidance` ("serves as", "frames"), `puffery-adjective`, `ai-vocabulary` (clustered, ≥2), `hedging`.
`low`: `burstiness` (sentence-length CV), `rule-of-three`, `lexical-repetition` (content word ≥3× — topical, comparative *within* a song only), `dash` (em/en/spaced → medium, intra-word hyphen → low; scans every field but exempts quoted lyric `line`s).

**Limit (the reason for Phase A):** these catch surface *constructions*. They do not measure lexical diversity, perplexity, real burstiness distributions, or POS skew — the signals the detection literature finds most reliable. A clean Tier-1 score is necessary, not sufficient. Inspect spans with:
```bash
cat scripts/voice-audit/experiments/*v13*t0-3*.json | jq -s -r '[.[] | .hits[] | select(.severity=="high")] | group_by(.rule) | map({rule:.[0].rule,n:length}) | .[] | "\(.rule): \(.n)"'
```

---

## The validation song set (in `regen.ts`)

`fast` = `not-like-us` + `motion-sickness`. `standard` = those + `drivers-license`, `ribs`, `blinding-lights`. `final` adds `too-sweet` (Hozier, high-valence), `dtmf` (Bad Bunny, Spanish/low-energy edge case), `do-i-wanna-know` (Arctic Monkeys, guitar-rock). Chosen for spread across genre/energy/valence/acousticness/cadence. Read at least one full output per song; `lexical-repetition` counts only compare within a song.

---

## Definition of done

A prompt (+ generation settings, + optional rewrite pass) that, over ≥3 runs on the `standard` set: holds **0 Tier-1 `high` and ≤1 `medium`**, **no dashes/hyphens**, **wins or ties the Phase-A judge vs the gold Hearted exemplars** (the new bar this phase), and **reads warm and human** on inspection. Then validate on `final` (8 songs) once before promoting (`ACTIVE_LYRICAL_VERSION`) and running `bun run test scripts/voice-audit src/lib/domains/enrichment/content-analysis`.

---

## Gotchas

- **Closing backtick in prompt files:** the `template` is a backtick string; field names inside use escaped backticks `` \`name\` ``, but the CLOSING backtick before `,` must be plain. Check after creating each file (typecheck catches it).
- **Vertex needs ADC** (see prereqs). `--provider google` is the rate-limited free tier — avoid for batches.
- **Run records accumulate** in `scripts/voice-audit/experiments/` and are part of history. `report-experiments` does not split by temperature — filter filenames (`*__t0-3*.json`) or read the `regen.ts` summary when comparing temps.
- **Don't relitigate:** long ban-lists (v3), inline self-audit (v12), prominent voice sections (v9/v10), temperature 0 or 1.0. All measured worse.
