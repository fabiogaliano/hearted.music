# voice-audit — implementation plan

A regression-gating eval for LLM-generated song analyses. Catches AI-writing tells before they reach `public/landing-songs/` or production.

## Context

The current `LYRICAL_ANALYSIS_PROMPT` in `src/lib/domains/enrichment/content-analysis/song-analysis.ts` produces outputs with AI-writing tells: antithesis constructions (`"This isn't merely X; it's Y"`), puffery adjectives (`blistering`, `definitive`), copula-avoidance verbs (`amplifies`, `frames`, `positions`), abstract-noun essay summaries (`cultural reclaiming`, `territorial statement`). The prompt already bans most of these — the bans don't hold because (a) lexical variants slip through, (b) ~20 `never/no/not` bullets prime defensive mode and trigger overcompensation. Fixing this by adding more bans makes it worse.

Instead: build a measurement harness first, then rewrite the prompt by subtraction, validate the rewrite against the harness.

## Goals

1. **Regression gate** — run on every PR that touches the analysis prompt or schema; fail CI when AI-tell hit-rate increases.
2. **Actionable signal** — failures include the quoted offending span, so the human can see *what* to fix in the prompt.
3. **Calibrated against human judgment** — the eval agrees with Fabio's grading ≥85% of the time on a 30-sample calibration set.
4. **Cheap to run** — Tier 1 is free; Tier 2 targets <$0.10 per full CI-set run with explicit token budgets.

Non-goals: catching *every* subtle slop issue; replacing human review; grading taste ("is this analysis *good*?" — that's a separate, harder problem).

## Assumptions revalidated (2026-04-22)

- **Gemini pricing moved**: use current paid-tier assumptions for `gemini-2.5-flash` (**$0.30 / 1M input tokens, $2.50 / 1M output tokens** for text/image input+output). Cost goal is now **<$0.10** per full CI-set run, not <$0.05.
- **Burstiness is heuristic, not proof**: stylometry and detector literature support rhythm/variance as a useful signal, but not a standalone classifier. Keep it low-severity and calibrate from real outputs.
- **Judge-model bias is real**: same-family judging can skew scores. Keep human calibration as the primary guardrail and run periodic cross-judge checks with Anthropic.
- **CI must be offline-deterministic**: golden fixtures for CI must be checked into the repo. No Spotify/API fetching in PR checks.

Validation references:
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Self-preference bias in LLM judges: https://arxiv.org/abs/2410.21819
- Stylometric human-vs-LLM clustering (context for uniformity claims): https://www.nature.com/articles/s41599-025-05986-3

## Architecture

Three tiers, cheapest first. Tier 1 runs first and must pass before Tier 2 runs.

### Tier 1 — deterministic rules (free, typically <10 ms per file)

Pure TypeScript. Runs in Vitest. Each rule is a function `(analysis: SongAnalysis) => RuleResult[]` returning zero or more hits with `{field, span, rule, severity}`.

| Rule | Pattern / check | Severity |
|---|---|---|
| `antithesis` | `/(it'?s not |isn'?t |is not |not just |doesn'?t just |more than just |far from being |not merely |not simply )[^.]*?(,|;|—| but | it'?s | it is )/i` | high |
| `copula-avoidance` | substring match on `serves as`, `stands as`, `acts as`, `marks`, `represents`, `embodies`, `amplifies`, `frames`, `cements`, `positions`, `underscores`, `highlights the` | medium |
| `puffery-adjective` | word-list: `blistering`, `unstoppable`, `relentless`, `definitive`, `vibrant`, `profound`, `renowned`, `groundbreaking`, `captivating`, `transcendent`, `breathtaking`, `visceral`, `haunting`, `shimmering` | medium |
| `participial-closure` | sentence ends with `, \w+ing …` clause — pattern `/[,;] \w+ing [^.]+\.$/m` | high |
| `hedging` | `perhaps`, `might be`, `seems to`, `could be interpreted as`, `it's worth noting`, `it is important to note` | medium |
| `academic-register` | `disorientation`, `juxtaposition`, `dichotomy`, `catharsis`, `existential`, `commentary on`, `explores themes of`, `delves into` | high |
| `self-reference` | `this song`, `the track`, `the listener`, `the speaker`, `the narrator`, `the singer`, `the vocalist` | high |
| `book-report-opener` | field begins with `This is about`, `This is an anthem`, `This is a`, `This isn't`, `It's not just`, `More than a` | high |
| `burstiness` | coefficient of variation (std-dev / mean) of sentence lengths per field < threshold (flags suspiciously flat rhythm) | low |
| `rule-of-three` | three parallel `, X, Y, and Z` lists in a single field | low |

**Burstiness** is a supporting signal, not a gating signal by itself. Compute per field using a simple sentence splitter (`str.split(/(?<=[.!?])\s+/)`), then coefficient of variation (std-dev / mean sentence length). Initialize threshold from baseline distribution (start at p10 on known-good fixtures) and tune during calibration. Only apply on fields with ≥3 sentences.

Output: a `LintReport` summarizing hits per rule, per field, per file. Default CI threshold: exit non-zero if any `high` hit exists, or if total `medium` hits >2.

### Tier 2 — LLM judge (Gemini 2.5 Flash via existing `LlmService`)

Runs only on files that passed Tier 1 (no point judging prose that's already flagged). Four independent binary judges, each with a focused rubric and a required `evidence` quote.

Reuses `createLlmService("google")` from `src/lib/integrations/llm/service.ts` — same provider as prod (`GEMINI_API_KEY`), same SDK path, Zod-validated output via `generateObject`.

CI token budget guardrail: cap Tier 2 at **250k input tokens + 10k output tokens** per run (≈$0.10 at current 2.5 Flash pricing). Exceeding the cap fails the run as a cost regression.

| Judge | Question (positive framing) | Returns |
|---|---|---|
| `register-specificity` | Does this analysis make claims that could only be written about this specific song, or could most sentences apply to any song in the genre? | `{specific: boolean, generic_sentences: string[]}` |
| `abstract-noun-trap` | Does the `headline` name a concrete image or feeling, or does it rely on abstract summary nouns like *journey, tapestry, exploration, declaration, reclaiming, statement*? | `{concrete: boolean, offending_nouns: string[]}` |
| `essayistic-register` | Does the `interpretation` read like a friend talking about a song, or like a critic writing a review/essay? | `{conversational: boolean, essayistic_phrases: string[]}` |
| `journey-narrative` | Does the `journey` read as a connected story (each entry building on the last), or as four disconnected structural labels? | `{narrative: boolean, disconnect_points: string[]}` |

**Bias mitigations:**
- **Self-preference bias** (Gemini judging Gemini output): primary mitigation is human calibration (below). Add a periodic cross-judge check on 20% of samples with Anthropic; if disagreement vs Gemini exceeds 10 percentage points on any dimension, require prompt/rubric review before merging.
- **Position bias**: not applicable — we do absolute per-dimension scoring, not pairwise.
- **Verbosity bias**: each judge prompt contains an explicit counter-instruction — *longer is not better; look for filler and over-qualification.*

**Judge prompt principles** (the same "good mood" insight that applies to the generation prompt applies here):
- Positive question framing (`"Does this…"`, not `"Is this bad because…"`).
- Binary answer, not 1–5 scale. For this task, binary/low-cardinality labels are easier to calibrate and less noisy.
- Required evidence quote — makes failures actionable for prompt editing.
- Short rationale (2–3 bullets) + quoted evidence. Do not require long chain-of-thought output.

### Tier 3 — human spot-check (manual, periodic)

10% of golden-set outputs reviewed by Fabio every major prompt change. A plain spreadsheet (`claudedocs/voice-audit-spotcheck-YYYY-MM-DD.md`). Goal: catch judge drift. If human and judge disagree on more than 15% of samples, re-calibrate judge few-shot examples.

## Golden set

Use two datasets:

1. **CI set (required, deterministic):** the 20 existing `public/landing-songs/*.json` fixture files (excluding `index.json`).
2. **Extended set (optional, local/manual):** additional snapshots generated from `scripts/prompt-lab/test-songs.ts` once checked into the repo as static fixtures.

CI never fetches external data.

Location: `scripts/voice-audit/golden/` — a small index JSON pointing at the canonical fixture files (no duplication). Each entry carries diversity tags:

```ts
{
  songId: "6AI3ezQ4o3HUoP6Dhudph3",
  tags: { genre: "hip-hop", decade: "2020s", lyricalDensity: "high", valence: "low" },
  source: "public/landing-songs/6AI3ezQ4o3HUoP6Dhudph3.json",
  calibrationGrade: null   // filled during calibration step
}
```

**Evolution rule (criteria drift):** when a production output reveals a new failure mode, snapshot it into the fixture set with the relevant tag. Target 30–50 total over time. Don't freeze.

## Calibration (Hamel's "Critique Shadowing")

Before the judge is trusted:

1. Fabio grades 30 sample outputs (binary pass/fail per dimension) and writes a one-sentence critique for each fail.
2. Those critiques become few-shot examples embedded in each judge prompt.
3. Split into calibration (20) + holdout validation (10). Iterate on the 20 only.
4. Run the judge on the untouched 10 and require ≥85% agreement on all four dimensions.
5. Re-calibrate every 60 days or when the generation prompt is materially rewritten.

The calibration process itself will reveal rubric items we couldn't pre-specify — that's expected, not a bug.

## Directory layout

```
scripts/voice-audit/
├── README.md                     # how to run it
├── cli.ts                        # `bun scripts/voice-audit/cli.ts`
├── golden/
│   ├── index.json                # golden-set manifest
│   └── calibration.json          # Fabio's 30-sample grades
├── tier1/
│   ├── rules.ts                  # all rule functions
│   ├── burstiness.ts             # sentence-length variance
│   └── report.ts                 # LintReport aggregator
├── tier2/
│   ├── judge.ts                  # LlmService wrapper + rubric runner
│   ├── prompts/
│   │   ├── register-specificity.ts
│   │   ├── abstract-noun-trap.ts
│   │   ├── essayistic-register.ts
│   │   └── journey-narrative.ts
│   └── schemas.ts                # Zod schemas for each judge output
├── baseline.json                 # committed; updated intentionally on prompt promotion
└── __tests__/
    ├── rules.test.ts             # unit tests for every rule
    ├── burstiness.test.ts
    └── fixtures/
        ├── clean.json            # known-good analysis (should produce zero hits)
        └── ai-slop.json          # the 6AI3ezQ4o3HUoP6Dhudph3 offender (should hit ≥5 rules)
```

Why `scripts/voice-audit/` and not `src/`: this is a dev tool, not production code. Follows the `scripts/prompt-lab/` precedent.

## CLI surface

```
bun scripts/voice-audit/cli.ts                    # tier 1 + tier 2, full golden set
bun scripts/voice-audit/cli.ts --tier 1           # deterministic only (fast, free)
bun scripts/voice-audit/cli.ts --file <path>      # audit a single JSON
bun scripts/voice-audit/cli.ts --baseline         # regenerate baseline.json
bun scripts/voice-audit/cli.ts --compare          # diff against baseline, exit 1 on regression
bun scripts/voice-audit/cli.ts --compare --ci     # CI mode: checked-in fixtures only, enforce token/cost budget
bun scripts/voice-audit/cli.ts --calibrate        # interactive calibration TUI
```

Package.json script: `"voice-audit": "bun scripts/voice-audit/cli.ts"`.

## CI integration

Add a GitHub Actions step triggered on PRs that touch any of:
- `src/lib/domains/enrichment/content-analysis/**`
- `scripts/voice-audit/**`
- `scripts/prompt-lab/prompts.ts`

```yaml
- name: voice-audit
  run: bun run voice-audit --compare --ci
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

On regression: step fails, PR blocked. The step output includes the offending span per hit, so the reviewer sees *what* regressed without re-running locally.

On intentional prompt promotion: author runs `bun run voice-audit --baseline` locally, commits the new `baseline.json` alongside the prompt change, PR description explains why the baseline moved.

## Iteration loop

1. **Ship voice-audit** (this plan) against the current prompt. Record baseline.
2. **Inspect hits** — what does the current prompt fail on most? Likely: antithesis variants, abstract-noun summaries, puffery.
3. **Rewrite the prompt by subtraction** — the actual goal. Apply the "good mood" playbook:
   - Cut `never/no/not-this` bullets from ~20 down to 3–5.
   - Convert remaining rules to positive exemplars (`Do this:`).
   - Add permission-to-disagree: *"If a field doesn't fit this song, say so plainly instead of inventing one."*
   - Add permission-to-be-short: *"A good `interpretation` is one clear sentence; pad it only if you have more to say."*
4. **Re-run voice-audit** against the new prompt on the same golden set.
5. **Promote baseline** if hit-rate dropped without harming the (separate) taste-quality dimension Fabio eyeballs in Tier 3.

Expected first-pass result (hypothesis): 25–50% reduction in Tier 1 high/medium hits after prompt rewrite. Tier 2 register-specificity is likely the hardest to move.

## Tradeoffs acknowledged

- **Self-preference bias when Gemini judges Gemini**: real but mitigated by calibration + periodic cross-judge checks. If agreement degrades, switch Tier 2 default judge to Anthropic until recalibrated.
- **Regex brittleness**: pattern matching misses rewordings. This is *the* reason Tier 2 exists — LLM judge covers what regex cannot.
- **Golden-set overfitting**: the prompt might learn to pass the eval without getting better. Mitigation: continuously add new failure snapshots and keep Tier 3 human spot-checks.
- **No taste grading**: voice-audit catches AI tells, not whether the analysis is *insightful*. Insight quality remains a human-judgment dimension. We don't try to automate it.

## Phasing

| Phase | Deliverable | Time |
|---|---|---|
| 1 | Tier 1 rules + unit tests + CLI + baseline against current prompt | ~2 h |
| 2 | Tier 2 judge wiring, 4 judge prompts, Zod schemas | ~2 h |
| 3 | Calibration set (30 Fabio-graded samples) | ~1 h human work |
| 4 | Judge prompt iteration to ≥85% agreement | ~1–2 h |
| 5 | CI integration | ~30 min |
| 6 | Prompt rewrite (subtraction) + validation run | ~1–2 h |

Phases 1–2 ship in a single PR. Phase 3 is blocked on Fabio. Phases 4–6 land in follow-up PRs gated by the calibration result.

## Default decisions (override if Fabio disagrees)

1. **CI scope**: audit only the production prompt and checked-in fixtures. Prompt-lab variants run locally when doing prompt R&D.
2. **Calibration protocol**: grade a stratified random 30-sample set manually (not judge-filtered) to avoid selection bias.
3. **CI severity budget**: fail on any `high` hit; allow up to 2 `medium` hits total.
