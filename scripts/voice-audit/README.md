# voice-audit

Regression gate for LLM-generated song analyses. Catches AI-writing tells (`"isn't X, it's Y"`, puffery adjectives, copula-avoidance verbs, academic register, book-report openers, disconnected journeys) before they ship.

Three tiers, cheapest first:

- **Tier 1** — deterministic regex + word-list rules. Free, runs in Vitest, ~10 ms per file. Gates CI.
- **Tier 2** — eight LLM judges: seven structured-output judges (register specificity, abstract-noun trap, essayistic register, arc narrative, lens coherence, redundancy, voice softness) via Gemini 2.5 Flash, plus the priority-1 grounding judge on Opus. Every judge emits its reasoning and evidence before its verdict boolean. Runs only on files that passed Tier 1. Bounded by a 250k input / 10k output token budget per run.
- **Tier 3** — human spot-check on 10% of outputs.

## Usage

```bash
bun run voice-audit                    # tier 1 + tier 2, full golden set
bun run voice-audit --tier 1           # deterministic only (fast, free)
bun run voice-audit --file <path>      # audit a single JSON
bun run voice-audit --baseline         # regenerate baseline.json
bun run voice-audit --compare          # diff against baseline, exit 1 on regression
bun run voice-audit --compare --ci     # CI mode: checked-in fixtures only, enforces severity + token budgets
```

Tier 2 requires `GEMINI_API_KEY`. Tier 1 needs nothing.

## Prompt-tuning loop (n=9 eval)

The eval set is **9 gold songs** — the unit of generalization. Multiple runs of one song are
repeated measures, not extra n. The loop is generate → evaluate → scoreboard:

```bash
# Generate analyses (PAID). v17 injects a leave-one-out few-shot {example} block and the song's
# own vote-gated {annotations}. Use an ODD run count for any variant you'll compare inferentially.
bun scripts/voice-audit/regen.ts --version 17 --songs golds --runs 3 --temperature 0.3

# Evaluate vs gold (PAID — Opus pairwise, ~$0.14/pair) and persist an eval artifact for diffing.
bun scripts/voice-audit/evaluate.ts --version 17 --temperature 0.3 --limit 3 \
  --out eval-artifacts/v17-base.json

# Scoreboard: per-song outcomes, marginal win-or-tie + Wilson CI, paired McNemar mid-p, length
# deltas, and the n=9 caveat. One artifact = marginal view; two = paired comparison.
bun scripts/voice-audit/scoreboard.ts eval-artifacts/v17-base.json [eval-artifacts/v18-cand.json]
```

Decision rule: never keep an edit on a 1-song wobble. Keep only with no gate regression,
song-spread improvement, rationale agreement, and no length gaming. McNemar significance is a
strong positive when it appears; its absence means "too noisy to trust", not "edit proven bad".
Captured variants are logged append-only in `experiments/changelog.md`.

## Grounding calibration

The cite-or-fail grounding judge has a calibration harness (PAID — Opus, items × repeats):

```bash
bun scripts/voice-audit/grounding-calibration.ts --repeats 3   # 9 golds + subtle negatives
```

It reports **self-consistency** (target 0.80 desired / 0.70 floor) and, separately, **raw
agreement** and **binary Cohen's κ** (~0.60 substantial) against the checked-in labels in
`fixtures/grounding-negatives.ts`. κ is jumpy on a tiny fixture — read it alongside the other two.

## Severity budget

Default: fail on any `high` hit; allow up to 2 `medium` hits. Override via `DEFAULT_SEVERITY_BUDGET` in `tier1/report.ts`.

## Adding new fixtures

When a production output reveals a new failure mode, snapshot it into the fixture set with relevant tags, then register it in `golden/index.json`. The golden set should evolve — don't freeze.

## Calibration

Phases 3–6 of the plan (human grading, rubric iteration, CI wiring, prompt rewrite) ship in follow-up PRs gated by the calibration result. See the voice-audit implementation plan.
