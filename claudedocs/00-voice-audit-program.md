# Voice-Audit Research Program — orientation & phase map

This is the README for the effort to turn the 9 hand-revised golds + the distilled
principles into (a) a calibrated eval that measures alignment with the golds, and (b) a
production song-analysis prompt iterated against that eval until it ties/wins the golds.

It is the shared context for the four phase handoffs, run in order:

- `claudedocs/01-voice-audit-deterministic.md`
- `claudedocs/02-voice-audit-judges.md`
- `claudedocs/03-voice-audit-v17-loop.md`
- `claudedocs/04-voice-audit-orchestrator.md`

Every phase handoff says "read this file and `hearted-audit-principles.md` first."

---

## 0. The two source-of-truth documents

- **The golds** — `scripts/voice-audit/exemplars/*.json` (9 songs, `{ read: ConceptRead }`)
  plus `exemplars/lyrics/*.json` (raw lyrics + Genius annotations with `votes_total`,
  `verified`, `state`, `pinnedRole`). These are the **truth**.
- **The principles** — `claudedocs/hearted-audit-principles.md`. Downstream of the golds.
  Each principle is tagged `layer:` (tier1 / tier2 / prompt / schema / editorial / data)
  and `status:` (ENCODED / PARTIAL / GAP). This program closes the GAPs.

**Standing rule (from the principles doc):** when a gold and a principle disagree, fix the
principle, not the gold — unless the gold is a genuine straggler bug (GR1/GR2 were).

---

## 1. Current state (verified against the code, 2026-06-05)

**Truth layer — DONE.**
- 9 golds revised + mutually consistent; `bun run test scripts/voice-audit/__tests__` green (72/72).
- Annotations present for 8/9 songs (No Sex for Ben has none — it's a surface-true chant).
  Richest: Not Like Us (62/97 lines annotated).

**Measurement layer — PARTIAL.**
- **Tier 1** — `scripts/voice-audit/tier1/rules.ts`, `runAllRules()` (~line 480). 13 rules live:
  antithesis (H), participial-closure (H), academic-register (H), self-reference (H),
  book-report-opener (H), copula-avoidance (M), puffery-adjective (M), ai-vocabulary (M),
  hedging (M), burstiness (LOW/non-gating), rule-of-three (LOW/non-gating),
  lexical-repetition (LOW), dash (LOW/MED). The `prose()` selector excludes
  `tension`/`lens`/arc `label`+`mood`; `dash` uses the wider `collectStringFields()` (not `lines`).
- **Tier 2 (pointwise, Gemini)** — `scripts/voice-audit/tier2/judge.ts` + `tier2/prompts/*.ts`.
  5 judges: register-specificity, abstract-noun-trap, essayistic-register, arc-narrative,
  lens-coherence. Each returns `{ passed, evidence[] }`.
- **Tier 3 (pairwise vs gold, Opus)** — `scripts/voice-audit/tier2/pairwise.ts`, driven by
  `evaluate.ts`. Runs each comparison **twice** (candidate=A/gold=B, then swapped) and
  reconciles to cancel position bias. **This is the real optimization target** (see the
  comment at the top of `evaluate.ts`). ~$0.14/pair.

**Prompt layer — BEHIND THE GOLDS.**
- Prompts live at `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v*.ts`;
  registry at `prompts/registry.ts`. `ACTIVE_LYRICAL_VERSION = "13"` (~line 51) — prod still
  runs the old 8-field schema. v14/v15/v16 written, never activated.
- Output schema: `content-analysis/concept-schema.ts` (`ConceptReadSchema`: image, lens,
  tension, take, contradiction?, arc[2..4], lines[1..5], texture?). `lines[].insight` was
  dropped (bare quotes now).
- Prompt assembly: `song-analysis.ts` `buildPrompt()` (~line 215) and the eval's
  `regen.ts` `buildPrompt()` (~line 147) both substitute `{artist} {title} {genres}
  {audio_features} {lyrics}` — **no `{annotations}` slot, no worked example.**

**The decisive session-5.5 finding:** v14 and v15 lost *every* pairwise comparison to gold —
on **specificity and grounding**, not voice mechanics. "The exact named detail, never the
euphemism." This is the frontier the whole research loop exists to close, and why the
**grounding judge is priority 1**.

---

## 2. The phase map

| Phase | Name | Kind of work | Risk | Gate |
|---|---|---|---|---|
| 1 | Deterministic + data encode | tier1 rules, MEC-4 removal, annotation plumbing | low | golds pass tier1; tests green |
| 2 | LLM-judge encode + calibration | grounding / redundancy / voice-softness judges | high | golds pass every judge; negatives caught |
| 3 | Author v17 + wire the loop | prompt-craft + one-command scoreboard | med | v17 registered; scoreboard runs; v17 baseline captured |
| 4 | The standing orchestrator | iterate prompt → score → converge | — | candidates tie/win pairwise vs gold, tier1/tier2 clean |

**Dependencies:** strictly linear 1 → 2 → 3 → 4 for scoring purposes (the loop in 3 wires
the gates from 1+2; the orchestrator in 4 needs all of it). Two safe overlaps if you want
to parallelize: Phase 1's tier1 work is independent of Phase 2's judges, and v17 *authoring*
(Phase 3 Part A) only needs the principles + golds, so it can begin during Phase 2 — but it
can't be *scored* until 1+2 land.

**Each phase produces a handoff note** appended to its own file (a "Progress so far" block)
so a fresh session can resume mid-phase, matching the existing session-5.5 convention.

---

## 3. Cross-cutting calibration discipline (applies to every phase)

1. **Golds are truth.** Every new rule/judge must be run against all 9 golds. All 9 must
   pass. If a gold fails: it's either a real gold bug (fix the gold, document it like
   GR1/GR2) or the rule is wrong (fix the rule). Never weaken a gold to satisfy a rule
   without writing down why.
2. **Prove the gate bites.** A judge that passes the golds but never fires is useless.
   Every new judge ships with ≥1 deliberately-broken negative fixture it must catch.
   Pass-the-golds + catch-the-negatives together = calibrated.
3. **Automate the mechanical; leave taste to the prompt + pairwise + human.** Only encode
   principles tagged `layer: tier1(NEW)` or `layer: tier2(NEW)` with `rec: KEEP`. The
   editorial-only items (SFT-2 subject-is-actor, SFT-9 simile crutch, ARC-10 stitch-beats,
   ARC-11/12 present-moment / no-bow, IMG-4 loaded-shorthand, etc.) belong in the v17 prompt
   and the human's review — automating them adds noise, not signal.
4. **The optimization target is pairwise win/tie-rate vs gold.** Tier-1 (0 high) and the
   tier-2 judges (esp. grounding) are **gates**, not the maximand. A candidate that is
   tier1-clean but loses every pair to gold has not improved.
5. **Use odd runs for real comparisons.** Historical notes in this program used `n=2`, but
   `claudedocs/06-block1-implementation-plan.md` supersedes that for any inferential baseline or
   variant comparison: use an **odd** number of runs per song so every song collapses to a
   majority outcome and the full `n=9` is preserved. Treat even-run histories as legacy fallback
   only. A practical default is `regen.ts --runs 3` with `evaluate.ts --limit 3`.

---

## 4. Out of scope (do NOT do in this program)

- **The Session-6 production cutover** — flipping `ACTIVE_LYRICAL_VERSION`, swapping
  `SongDetailPanel.tsx` → `ConceptPanel`, the existing-row re-enrichment plan, regenerating
  `golden/index.json` + `baseline.json`. The research loop always passes `--version 17`
  explicitly and never needs prod flipped. The orchestrator's deliverable ends at a converged
  prompt + a readiness signal; shipping it is a separate decision.
- The legacy `golden/` CI fixture set (20 production 8-field rows). Stale until Session 6;
  irrelevant to gold-based prompt research.

---

## 5. Quick command reference (verify line numbers — they drift)

```bash
# tier1-only audit of a single read
bun run voice-audit --tier 1 --file <path>

# generate n=3 candidates for v17 across all 9 gold songs, score tier1, record runs
bun scripts/voice-audit/regen.ts --version 17 --songs <gold-keys> --runs 3

# pairwise-judge stored v17 runs vs gold at an odd run count
bun scripts/voice-audit/evaluate.ts --version 17 --limit 3

# aggregate tier1 across stored runs
bun scripts/voice-audit/report-experiments.ts

# full vitest gate
bun run test scripts/voice-audit/__tests__
```

The Phase-3 deliverable is a single command that chains generate → tier1 → tier2 →
pairwise → unified scorecard, so the orchestrator runs one thing per iteration.
