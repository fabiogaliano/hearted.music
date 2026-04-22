# voice-audit

Regression gate for LLM-generated song analyses. Catches AI-writing tells (`"isn't X, it's Y"`, puffery adjectives, copula-avoidance verbs, academic register, book-report openers, disconnected journeys) before they ship.

Three tiers, cheapest first:

- **Tier 1** — deterministic regex + word-list rules. Free, runs in Vitest, ~10 ms per file. Gates CI.
- **Tier 2** — four binary LLM judges (register specificity, abstract-noun trap, essayistic register, journey narrative) via Gemini 2.5 Flash. Runs only on files that passed Tier 1. Bounded by a 250k input / 10k output token budget per run.
- **Tier 3** — human spot-check on 10% of outputs (see `claudedocs/`).

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

## Severity budget

Default: fail on any `high` hit; allow up to 2 `medium` hits. Override via `DEFAULT_SEVERITY_BUDGET` in `tier1/report.ts`.

## Adding new fixtures

When a production output reveals a new failure mode, snapshot it into the fixture set with relevant tags, then register it in `golden/index.json`. The golden set should evolve — don't freeze.

## Calibration

Phases 3–6 of the plan (human grading, rubric iteration, CI wiring, prompt rewrite) ship in follow-up PRs gated by the calibration result. See the voice-audit implementation plan.
