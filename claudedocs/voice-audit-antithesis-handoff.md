# Handoff — autonomous prompt research: kill the "it's not X, it's Y" pivot

Paste the block below into a fresh Claude Code conversation. It gives the mission, points at the
source-of-truth files and the harness, hands over the specific idea to try, and otherwise leaves the
agent to read the prior work and decide how to run the experiment.

---

You are the autonomous orchestrator for a prompt-research loop on the hearted.music song-analysis
voice. The target is the "it's not X, it's Y" antithesis pivot (the thesis-pivot / dismissive
comparison) in generated reads. A user wants to try a specific anti-pivot formulation (below).
Research it, design and run the experiment yourself, decide what works, and document it. Opus
pairwise judging is authorized this round.

Orient yourself first, then interpret rather than follow a script:
- Verify your base: you should be on the `concept-audit-principles` lineage, with prompts up to
  `lyrical-v28.ts` under `src/lib/domains/enrichment/content-analysis/prompts/` and
  `ACTIVE_LYRICAL_VERSION = "17"` in `registry.ts`. If the prompts stop at v13, you're on a stale
  worktree — stop and say so.
- This pivot has been worked extensively. Read `claudedocs/00-voice-audit-program.md`,
  `claudedocs/08-voice-audit-phase4-changelog.md`, and `claudedocs/hearted-audit-principles.md`, and
  the existing prompt variants (v17 is the converged baseline; v19–v28 are prior experiments). Form
  your own read of what's been tried, what worked, what didn't, and what's genuinely untested, and
  let that shape the experiment.
- The harness is in `scripts/voice-audit/` (prompt variants register in `prompts/registry.ts`;
  generation, deterministic tier1 scoring, the smoke analyzer, the variant-diff checker, the Opus
  pairwise eval, and a post-generation rewrite pass all live there). Read the scripts' headers for
  current usage; reuse them rather than inventing new flows.

Ground rules the project already enforces (confirm against the docs): golds are truth (all 9 keep
passing tier1; keep `bun run test scripts/voice-audit/__tests__` green); the basis of record is n=3,
t0.3, Flash, the 9 golds (n=1 is smoke-only); the optimization target is pairwise win+tie vs gold,
with tier1 and grounding as gates; record each hypothesis as a keep/revert row in the phase-4
changelog and leave dead-end variants in-tree as the record; don't change `ACTIVE_LYRICAL_VERSION`
or touch the prod path (`song-analysis.ts`) without asking.

The idea to test (verbatim — this is the one thing prescribed; everything else is your call):

> The LLM needs to know the pattern to avoid but more importantly it needs to be instructed better
> examples to follow.
>
> Try something like this:
>
> Write statements that express without using contrast, negation, or comparison.
> Use: direct definitions, metaphor or embodiment, cause/effect, situational description, small
> narrative scenes, as applicable. These are so much better than lazily comparing X to Y.
> Avoid: not, but, instead, just, any implied opposites.
> Verboten: "Not just X but Y". X is a distraction and associates Y with something worse. Be
> progressive/positive instead and positively associate Y with Z. I run all the stuff it generates
> through this prompt:
> **Instruction Title: "Direct Assertion: Eliminate Dismissive Comparisons"**
> **Instruction Detail:** "Scan the text for any sentence or clause pair that follows the pattern of:
> '[Statement A, often downplaying or negating a common perception]' followed by '[Statement B,
> presenting a more significant or impressive alternative]'. Common phrasings include: 'This isn't
> just…; it's…', 'It's not merely…; it's…', 'More than just…; this is…'.
> **Rewrite Action: Delete Statement A entirely.** Do not try to rephrase it. **Focus solely on
> Statement B. Strengthen Statement B (if necessary) so it stands alone powerfully.** Ensure
> Statement B is: Specific (clearly describes what the thing is or does); Benefit-Oriented
> (highlights the value to the reader); Confident (a direct, strong, positive assertion); Free of
> internal comparison (does not rely on comparing itself to something lesser)."
>
> (commenter Sable-Keech: "works even better enclosed in `<master_prompt_override_style_guide>…</…>`
> XML tags.")

Note for your own judgment as you design this: the author says "I run all the stuff it generates
through this prompt" — i.e. they apply the Direct Assertion block as a pass over already-generated
text, not only as a generation instruction. Decide for yourself how that maps onto this pipeline
(generation prompt vs. the existing rewrite pass) and what's worth testing where.

Deliver: the variant(s) you built and registered, the scored results (free deterministic + the Opus
pairwise on whatever you judge worth the spend), a changelog row, and a clear recommendation.
