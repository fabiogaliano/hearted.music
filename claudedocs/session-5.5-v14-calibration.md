# Session 5.5 — Calibrate v14 with the Eval Layer (first empirical contact)

## Start here

Open a fresh Claude Code session in this repo and paste:

```
I'm continuing the Hearted song-analysis concept redesign.
Master: claudedocs/concept-redesign-handoff-2026-05-28.md
This session: claudedocs/session-5.5-v14-calibration.md

Read both files, then execute this brief — run the now-migrated voice-audit
eval layer against real generated v14 output for the first time, read the
misses, and iterate lyrical-v14.ts until it clears measurable quality bars.
This is measurement + prompt-iteration mode, NOT engineering. Do not flip
generation or swap the panel (that's Session 6). Schema, lens vocabulary,
and grammar are locked (Sessions 1-3); only the v14 PROMPT may change here.
```

---

## Why this session exists

v14 has **never been generated or measured** — Session 4 validated it by *reasoning on paper* ("reads below are reasoned from the lyric reality… not generated", comparison-notes §4). Session 5 migrated the eval layer (jury, Tier-1/Tier-2, lens-coherence) to grade the `{ read }` shape — so **for the first time, v14 output can actually be scored against gold.** This session is that first empirical contact: generate v14 for real, measure it, and tighten the prompt before Session 6 flips it into preprod. The app is **preprod** (no users), so iterating freely is safe — the point is not risk, it's not building the matching layer on top of an unmeasured prompt.

## Inherited decisions (locked — do not relitigate)

1. **Schema, lens grammar, lens vocabulary** (Sessions 1–3): locked. This session does **not** touch `concept-schema.ts` or `concept-lens-vocabulary.md`. If generated output genuinely can't satisfy a jury rule without a schema/vocab change, **surface it per master §8.3 — do not silently edit them.**
2. **Voice-audit is migrated** (Session 5): `regen.ts --version 14`, `evaluate.ts`, the Tier-1/Tier-2 judges, and `check-lens-coherence.ts` all grade the read shape. This is the instrument.
3. **Generation stays on v13** (Session 5): `ACTIVE_LYRICAL_VERSION` is `"13"` and stays that way this session. `regen.ts --version 14` generates v14 **without** flipping production — generation in the harness is decoupled from the active version. The flip is Session 6.
4. **Only `lyrical-v14.ts` may be revised here**, and only to hit the bars below.

## What to read

- `claudedocs/session-4-prompt-v14-comparison.md` **§3 + §4** — the 4 gold and 3 stress songs (Forever / Beautiful Things / Pink Pony Club) reasoned through v14. **These are the paper predictions you are now testing against reality** — note where generated output diverges from them.
- `src/lib/domains/enrichment/content-analysis/prompts/lyrical-v14.ts` — the prompt under test.
- The eval tooling: `scripts/voice-audit/regen.ts`, `evaluate.ts`, `cli.ts`, `check-lens-coherence.ts`, `tier2/judge-persona.md` (the operational rubric), and `exemplars/*.json` (the gold bar).
- Master **§13** (success criteria + the kill-switch — your acceptance bar and your abort condition), **§8.2** (the working assumptions that real output might push back on), **§9** item 5 + `claudedocs/schema-overprescription-lyric-diagnostic.md` (the failure modes to watch: surface-true songs, monochrome arcs, narrative/two-act lenses, foreign-language lines).

## Prerequisites (this session needs live services)

- An LLM provider for generation — `regen.ts` defaults to `google-vertex` (GCP-billed gemini-2.5-flash); `--provider`/`--model` override.
- The pairwise judge (`evaluate.ts`) runs Opus via the Claude CLI (`tier2/claude-cli.ts`) — ~$0.14/pair.
- Lyric fetching via `DataFetcher` (the harness handles it; it caches under `scripts/prompt-lab/.cache`).

If a provider isn't available in the session, stop and tell the user which credential is missing rather than faking results.

## What to produce

1. **A v14 run set** across the 8-song validation spread:
   `bun scripts/voice-audit/regen.ts --version 14 --songs final --runs 3`
   (records ~24 reads + Tier-1 tallies to `experiments/`). Start smaller — `--songs fast --runs 1` — to sanity-check the prompt emits valid `ConceptReadSchema` JSON before paying for the full spread.
2. **An eval report** from the migrated layer:
   - `bun scripts/voice-audit/evaluate.ts --version 14 --temperature 0.3` → pairwise win-rate vs gold + voice stats + Tier-1 means.
   - `bun scripts/voice-audit/cli.ts --tier 2` (or run the judges over the new runs) → Tier-2 pass rates incl. the new `lens-coherence` judge.
   - `bun scripts/voice-audit/check-lens-coherence.ts` → the decorative-lens / lazy-SURFACE acceptance check, now also runnable over the live golds.
3. **At least one prompt-revision cycle** if the bars aren't met: read the misses → edit `lyrical-v14.ts` → regenerate → re-score. The harness records every iteration, so versions stay comparable (the same loop that took v11→v13).
4. **A findings note** — `claudedocs/session-5.5-v14-calibration-findings.md`: the final numbers, what v14 got right vs the Session 4 paper predictions, what was changed and why, and — per §8.3 — any evidence that pushes back on a §8.2 working assumption (especially **lens slop at scale**, the kill-switch's #1 signal).

## Acceptance bar + stop condition

Targets (tune to taste; these are the starting line, not gospel):

- **Pairwise jury:** v14 wins-or-ties the gold read on **≥ ~65–70%** of the spread (the `evaluate.ts` "pass-rate (win+tie)" line). Gold is a high bar — losing some is expected; trending toward parity is the goal.
- **Tier-1:** **zero high**-severity hits, medium near zero, across the run set.
- **lens-coherence:** passes on all 8 songs; the two deliberately-broken reads in `check-lens-coherence.ts` are still flagged.
- **Qualitative spot-checks:** `tension` is a qualified emotion (not the paradox); no abstract-noun lenses (`a meditation on…`); surface-true songs route to SURFACE without manufactured depth; foreign-language lines carry the parenthetical gloss.

**Stop when** the bars are met, OR after diminishing returns across a few cycles — in which case either (a) accept the current v14 and document the residual gaps, or (b) if lenses are trending abstract / reads are regressing toward the old "pile of fields" feel even with the vocabulary in place, **that is the kill-switch (master §13)** — stop and surface to the user that the concept needs rethinking before Session 6, rather than shipping a prompt that doesn't hold.

## Which skills apply most directly

1. **`narrative-strategy-specialist`** (archived, `/Users/f/.claude/skills/archive/`) — defines what a *good* read is (image=hook, lens=thesis, take=development, contradiction=Pratfall). Use it to judge the misses, not just the jury's number.
2. **`creative-conceptualist-specialist`** (archived) — the Analyze→Identify→Violate frame is exactly how you tell a real lens from category-typical slop when reading generated lenses.

## Out of scope

- Flipping `ACTIVE_LYRICAL_VERSION` or swapping the production panel — **Session 6.**
- The `signals` / matching layer — still unbuilt, a later session.
- Editing `concept-schema.ts`, `concept-lens-vocabulary.md`, or the lens grammar. Only `lyrical-v14.ts` changes here. Anything that *seems* to need a schema/vocab change is a §8.3 surface-to-user event, not a silent edit.
- Re-running or re-migrating the voice-audit pipeline itself (Session 5 is done) — you are *using* it, not changing it.

## When this session ends

Run the master's §11 closing protocol: update §6 (final v14 state + calibration outcome + the run-set/findings files), §4 + the Quick-start table (mark 5.5 done, Session 6 next), add any §8.2-pushback evidence to §8.5, and **lightly revise the Session 6 brief** so its "inherited prompt" reference points at *calibrated v14* rather than paper-v14 (note if the prompt's wording changed). If the kill-switch fired, do not hand off to Session 6 — hand back to the user with the evidence.
