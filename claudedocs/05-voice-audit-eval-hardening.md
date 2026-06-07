# Voice-Audit Eval Hardening — findings + what to build before Phase 3/4

Research-backed review of the voice-audit eval (`scripts/voice-audit/`) and the prerequisite
work that must land before capturing the v17 baseline and starting the Phase-4 loop.
Date: 2026-06-06. Sources at the bottom.

**TL;DR:** the system is already well-designed. The risk isn't the gates — it's that the
Phase-4 loop keeps/reverts prompt edits on a measurement that is (a) statistically noisy at
n=9, (b) contaminated by worked-example leakage, and (c) trusted without being measured.
Fix the instrument before the loop relies on it.

---

## 1. What's already best-practice (don't touch)

- **Pairwise-vs-gold as the maximand.** Correct for subjective creative text; pairwise tracks
  human preference better than pointwise (LitBench 2025: ~73% zero-shot human agreement).
- **Position-swap reconciliation** (`pairwise.ts` `reconcile()`): load-bearing, not optional —
  pairwise flips ~35% under distractors vs ~9% pointwise.
- **Burstiness/perplexity descriptive-only, never a gate** (`stats.ts`): strongly confirmed —
  Binoculars drops to ~42% on GPT-4-class text. Most teams get this wrong; you don't.
- **Wordlists from the Wikipedia "Signs of AI writing" cluster**: still valid in 2025
  (copula-avoidance, negative parallelism, rule-of-three, tapestry/testament/delve family).
- **Few-shot calibration inside judge prompts** (`redundancy.ts`, `voice-softness.ts` carry real
  gold PASS/FAIL pairs): this is the FaithJudge pattern.
- **"Prove the gate bites" discipline** (`00-...md §3`): more mature than most prod eval setups.

Also correct by omission: **do not adopt DSPy/OPRO/automated prompt search** — at n=9 with an
LLM-judged subjective objective they overfit catastrophically and you lose interpretability.
Borrow only the discipline: a changelog of every variant with win-rate + CI + hypothesis.

---

## 2. Findings, by leverage

### Tier A — protect the loop's integrity (highest leverage)

- **A1 — No confidence interval on the win-rate.** `evaluate.ts:198` prints a bare percentage.
  At n=9 a 6/9 win-rate has a 95% CI of ~[36%, 93%]; 5/9→6/9 is noise. The Phase-4 keep/revert
  rule has no significance floor. → For the simple **WIN-or-TIE song success rate**, add a
  **Wilson CI** over the 9 songs; for variant-vs-variant, add **paired McNemar (mid-p)** on the
  discordant songs only. Encode a minimum-detectable-effect floor (~3/9) in the loop.
- **A2 — Worked-example leakage.** Phase 3 embeds 2 golds as few-shot, then judges candidates
  against all 9 golds incl. those 2 (22% contaminated): the generator is shown the text it's
  scored against. → **Leave-one-out**: inject examples per-song, excluding the current song.
- **A3 — Judge calibration is asserted, not measured.** "Passes 9 golds + catches 1 obvious
  negative" tests the extremes, leaves the boundary unmeasured. → **Self-consistency** (run a
  judge 2–3× on the same gold, record flip rate; target ≥0.7 self-agreement) + a **graded
  subtle-negative set with Cohen's κ** (target ≥0.6), grounding judge first.

### Tier B — reduce bias/error inside the gates

- **B1 — Verdict emitted before rationale.** Judge JSON emits the boolean first, `rationale`
  last → post-hoc rationalization, not CoT. → Reorder so reasoning precedes the verdict in
  prompts + schemas. CoT-before-verdict gives significant agreement gains on subjective criteria.
- **B2 — Pointwise judges share the generator's family** (both Gemini Flash → self-preference
  risk; moderate, strongest on the quality-leaning judges). → Move quality-leaning pointwise
  judges off Gemini, or make them a small cross-family jury (PoLL: cheaper *and* more reliable).
- **B3 — Grounding judge doesn't cite its sources.** #1 grounding failure is parametric-knowledge
  override. → Require the judge to **quote the lyric/annotation that grounds each passed claim;
  fail any claim it can't cite.** Negatives are already the right kind (correct-but-unsourced).
- **B4 — Single Opus grounding judge = single point of failure.** → Self-consistency majority
  (overlaps A3); a 2-of-3 cross-family jury later.

### Tier C — robustness / future-proofing

- **C1 — Eval set too small (9).** Below every cited minimum (~30 to surface failure modes,
  ~100 for confidence). → Grow toward 20–30 stratified by your own TYP-1…5 song-types + era/
  genre/language. Held-out songs need no gold to exercise tier1/pointwise/grounding.
- **C2 — No length-bias check in pairwise.** Verbosity is the most gameable judge bias. →
  Log wordcount-delta vs verdict (you already compute both in `stats.ts`); alert if |r| ≥ 0.5
  (the operational threshold `scoreboard.ts` ships — 0.3 fires on n=9 noise too often to be useful).
- **C3 — Wordlists get gamed.** → Add 2025-era terms ("align with", "enhance", "showcasing",
  "newfound sense of", "complex interplay", "transformative"); longer-term, an embedding-
  distance-from-human-corpus soft signal that resists the regex arms race.

---

## 3. The order

There is one decision that matters: you are about to run the optimization loop (Phase 03+04)
and **ship whatever prompt it picks** as the first prod release. So everything sorts into one
question — what must be true *before* the loop runs, vs. what's safe *after* you've shipped.
Nothing gets built *during* the loop; the loop is only prompt edits against the scoreboard.

### BLOCK 1 — before you optimize the prompt (do all of these first)

These gate the loop because the loop's output *is* your first prod prompt. Items 1 (authoring)
and 3–4 (judges) can run in parallel.

1. **Author v17 with an injected example slot** (A2 — Phase 03 Part A). Leave-one-out: examples
   injected per-song in `regen.ts`/`song-analysis.ts`, excluding the current song. Do NOT
   hardcode examples into the template — that bakes 22% leakage into the baseline.
2. **Build the scoreboard with the stats layer** (A1 + C2 — Phase 03 Part B). **Wilson CI** on
   every simple WIN-or-TIE win-rate, paired McNemar (mid-p) for the variant diff view,
   length-delta column.
3. **Rationale-before-verdict across the 8 judges** (B1). Cheap; touches all at once. Must
   precede baseline or you capture it with weaker judges and re-baseline.
4. **Harden + calibrate the grounding judge** (A3 + B3). Self-consistency flip-rate on each
   judge; a small graded-negative set + κ on grounding; fold in cite-or-fail. Makes Phase 04's
   "trust which judge least" a number and its "when a win is fake" reflex actionable.
5. **Then capture the v17 baseline.**

**Irreducible minimum if the deadline is brutal:** items 1 + 2. Without them the loop picks the
wrong prompt (noise + leakage). Items 3 + 4 make the *gates* trustworthy (don't ship a prompt
that hallucinates facts about real artists) — keep them for a user-facing release; they're the
cut line only if something must give.

Effort: 1 + 2 + 3 ≈ a day together; 4 is the more involved gate between "scoreboard exists" and
"loop can trust it."

### BLOCK 2 — the loop + first release (Phase 04)

Iterate prompt → score → keep/revert on song-spread improvements with McNemar used as a **noise
veto** (not a hard keep gate) → converge → **first prod release.**

### BLOCK 3 — after first release (safe to defer; none of it blocks shipping)

- **C1 — grow the eval set to 20–30** (stratified by TYP-1…5 + era/genre/language). Biggest
  long-term lever, but slow; the Block-1 CI work is the mitigation that lets you ship at n=9.
- **B2 / B4 — cross-family / juries** for the pointwise + grounding judges.
- **C3 — wordlist refresh + embedding-distance voice signal.**

---

## Sources

LLM-judge reliability / bias:
- LitBench — creative-writing eval benchmark — arXiv:2507.00769
- Pairwise vs pointwise feedback protocols — arXiv:2504.14716; Comparative Trap — arXiv:2406.12319
- Position-bias systematic study — arXiv:2406.07791 (ACL 2025)
- Length-controlled AlpacaEval — arXiv:2404.04475
- Self-preference bias — arXiv:2410.21819, arXiv:2604.22891
- Rating Roulette (judge self-inconsistency) — arXiv:2510.27106
- Replacing Judges with Juries (PoLL) — 2024; Eugene Yan, "Evaluating LLM-Evaluators"
- G-Eval (CoT + logprob) — Liu et al. 2023

Eval statistics / methodology:
- Anthropic, "A Statistical Approach to Model Evaluations"
- Hamel Husain, "Your AI Product Needs Evals" + "LLM-as-a-Judge"
- McNemar mid-p for small paired samples (adopted); bootstrap CIs (statsforevals.com) — considered
  but NOT adopted for the simple win-rate at n=9; Wilson was chosen instead (see
  `06-block1-implementation-plan.md` WP2). Bootstrap stays off the table for the marginal rate.
- Goodhart / overfitting — Doug Turnbull, "LLM Judges Aren't the Shortcut You Think"

Grounding / AI-slop:
- FaithJudge — arXiv:2505.04847; FactScore — EMNLP 2023; RAGAS faithfulness
- Judging Against the Reference (parametric-knowledge failures) — arXiv:2601.07506
- Binoculars (perplexity detection limits) — arXiv:2401.12070; Pangram, "Why Perplexity Fails"
- Wikipedia: Signs of AI Writing; PubMed AI-vocabulary study — PMC12679996
