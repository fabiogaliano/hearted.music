# Eval design decision — song-analysis voice (Phase A)

Date: 2026-05-27. Author: research-agent handoff (eval-and-optimize phase).
Decides how we measure "reads like a warm human friend, not AI" so we can optimize against it
instead of overfitting the Tier-1 surface scorer (currently plateaued at ~1.9 high on v13@0.3).

## Discovery that reframes the brief

The handoff said "build an eval layer." One already exists (`scripts/voice-audit/`, built ~4 weeks ago):

- **Tier 2** = 4 *pointwise binary* Gemini judges (`register-specificity`, `abstract-noun-trap`,
  `essayistic-register`, `journey-narrative`), token-budgeted, evidence-quoted. Good failure-mode
  detectors; NOT a "which reads more human" preference signal.
- **Golden set** (`golden/index.json`) = ~20 production fixtures, every `calibrationGrade: null`.
  They are *regression fixtures*, not *hand-polished gold Hearted exemplars*.

So Phase A is **extend + recalibrate an existing system**, not greenfield.

## What the research changed about the plan

1. **Statistical tells are demoted from "target" to "guardrail."** The detection literature
   (Binoculars, DetectGPT, GPTZero) is built on "low perplexity + low burstiness = AI." That
   heuristic is largely obsolete for frontier models, which now produce *high*-perplexity,
   *high*-burstiness text; one benchmark found Zipf-law conformity the only strong single signal,
   with perplexity/burstiness/vocab-richness/word-length-SD reduced to tie-breakers. Binoculars
   needs two hosted LMs (impractical here). => We compute cheap descriptive stats (MTLD, real
   sentence-length burstiness distribution, function-word ratio) for *context*, but do NOT optimize
   against them. Optimizing toward "more human perplexity" would be chasing a weak proxy.
2. **Primary target = pairwise rubric judge.** Pairwise beats pointwise at matching human
   preference, but it *amplifies* bias ("The Comparative Trap"). Mitigations we adopt:
   swap-and-average both orders (position bias), a judge model **different** from the generator —
   Claude judging Gemini output, avoiding self-preference (service already supports `anthropic`),
   and an explicit Hearted rubric with required reasoning (G-Eval / RubricEval reduces variance).
3. **Brand-voice rubric = concrete dimensions, not "good/natural."** Score warmth/notices-detail,
   image-specificity, conversational register, absence-of-AI-tells; quote evidence; define the
   judge persona ("a Hearted editor").

## Chosen design

- **Reuse** the in-repo `LlmService.generateObject` + zod harness and the `experiments/` store.
  Reject pulling in promptfoo/DeepEval/Braintrust: a second harness for one metric is net cost, and
  our generator/judge transport is already wired (Vertex + Anthropic).
- **New: pairwise judge** (`tier2/pairwise.ts`) — Claude compares two analyses of the *same* song
  against the Hearted rubric, run both orders, average. Reports win/loss/tie per pair.
- **New: statistical tells** (`tier1/stats.ts` or `tier2/stats.ts`) — MTLD, burstiness distribution
  vs a human baseline, function-word ratio. Descriptive only; not a gate.
- **Anchor**: a small set of gold Hearted exemplars to compare candidates against (see open fork).
- **Keep** Tier-1 as the fast deterministic guardrail and the existing pointwise judges as
  failure-mode detectors. Layer the pairwise win-rate on top as the optimization target.

## Rejected

- Statistical tells as the optimization target (weak for frontier-model text — see above).
- Binoculars / perplexity scoring (needs two hosted LMs; weak signal for our case).
- External eval frameworks (parallel harness for marginal gain).
- A Gemini judge of Gemini output (self-preference bias).

## Open fork (needs user input before building the anchor)

Pairwise-vs-gold needs gold exemplars that don't exist yet. Either (a) hand-author a few gold
Hearted analyses (highest-fidelity anchor, needs the brand owner), (b) I draft candidates from the
voice guide for user approval, or (c) skip gold for v1 and run pairwise *candidate-vs-candidate*
(ranks prompt variants directly, no gold needed). (c) unblocks optimization immediately; gold can
be added later as an absolute anchor.

## Sources

LLM-as-judge / pairwise bias: arxiv 2406.12319 (Comparative Trap), 2510.12462, 2411.15594 (survey),
RubricEval/G-Eval. Detection signals: Pangram "Why Perplexity and Burstiness Fail", GPTZero
methodology, Counter Turing Test (CT2, EMNLP 2023). Brand-voice rubric: CXL LLM tone-of-voice
framework, Adnan Masood rubric-eval writeup.
