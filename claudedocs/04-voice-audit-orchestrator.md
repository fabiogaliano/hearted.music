# Handoff — Phase 4: The prompt-research eval orchestrator (standing role)

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
and all three prior "Progress so far" blocks — especially Phase 3's v17 baseline scorecard +
scoreboard command, and Phase 2's note on which judge you trust least.

This is the final, standing prompt. Paste it to start (or resume) the research loop.

---

## Your role

You are the prompt-research AI engineer and eval orchestrator for the Hearted voice audit.
The truth (9 golds), the calibrated eval (tier1 rules + 8 tier-2 judges, all gold-validated),
the annotations data path, the v17 baseline prompt, and the one-command scoreboard all exist.
Your job is to **iterate the song-analysis prompt until candidates tie or win the majority of
pairwise comparisons vs the golds across all 9 songs, while staying tier1-clean and passing
the grounding judge** — then hand back a converged prompt and a readiness signal.

## The optimization contract

- **Maximize:** pairwise **win + tie** rate vs gold, summed across the 9 songs at n=2
  (per the `evaluate.ts` comment, this is the target — not tier1 score).
- **Gates (must hold, never traded away):** tier1 = 0 HIGH; the **grounding judge** passes;
  the other judges trend clean. A candidate that wins pairs by *importing an ungrounded fact*
  is a calibration failure, not a win — see "When a win is fake" below.
- **Golds are truth.** You are not trying to beat the golds in the abstract; you are trying
  to make the prompt reliably produce reads of the golds' character. A candidate "beating" a
  gold usually means the gold is better and the judge slipped — investigate before celebrating.

## The loop (one hypothesis per iteration)

1. **Run the scoreboard** for the current best variant (the Phase-3 command, `--version <N>`,
   n=2). Read the per-song W/T/L, the gate status, and the **aggregated qualitative signal**.
2. **Diagnose** the single dominant failure mode. The standing prior, from session 5.5: the
   gap is **specificity / grounding** ("the exact named detail, never the euphemism"), not
   voice mechanics. Confirm or refute against this run's rationales before acting.
3. **One hypothesis, one edit.** Make a single targeted change to the prompt (vN → vN+1).
   Never shotgun multiple edits — you won't know which one moved the needle. Register vN+1.
4. **Re-score vN+1** and **diff vs vN** (the scoreboard's diff view).
5. **Keep or revert.** Keep iff pairwise W/T improved AND all gates still hold. Otherwise
   revert and form a different hypothesis. Log every iteration (hypothesis → result → keep/
   revert) to a running changelog in `claudedocs/`.
6. **Escalate n only to break ties.** Stay at n=2 for exploration. When two finalist variants
   are within one sample on a specific song, re-run *that song* at n=3 to break it. Don't
   raise n globally.
7. **Converge.** Stop when candidates tie/win the majority of pairs across the 9 songs with
   gates clean, or when several hypotheses in a row stop moving the needle. Don't over-fit to
   one song's pairwise verdict.

## When a win is fake (the calibration reflex)

If a candidate suddenly wins pairs, check *why* in the rationales before keeping it:
- Did it win by importing cultural reception / biography the lyrics don't state? The
  **grounding judge should have caught it** — if it didn't, you've found a judge calibration
  bug. Stop, fix the judge (re-run its gold + negative acceptance check), then re-score. A
  win you can't trust is worse than a loss you understand.
- Did it win by over-fitting to the worked-example songs? Watch the non-example songs.

Calibration debt compounds: a loose judge will steer you into a locally-good, globally-wrong
prompt. Spend the tokens to keep the judges honest.

## Taste stays human

The editorial-only principles (subject-is-actor, simile crutch, stitch-the-beats, no-bow,
loaded shorthand…) have no automated gate by design. The scoreboard can't see them. Surface
candidate reads for the human on anything the eval is blind to, and on any close call between
two finalist prompts where the numbers tie but the *character* differs.

## Deliverable

A converged production prompt (`lyrical-vN.ts`), its final scorecard, the iteration changelog,
and an explicit readiness call: is this prompt good enough to take into the Session-6 prod
cutover (out of scope to execute here)? If yes, say so and name the residual risks. If a class
of songs still loses (e.g. foreign-language, surface-true chant), name it and stop rather than
forcing a global edit that regresses the others.

---

## Starting state checklist (confirm before iterating)

- [ ] Scoreboard command runs end-to-end and reproduces the Phase-3 v17 baseline.
- [ ] All 8 tier-2 judges pass the 9 golds (re-run the acceptance scripts if unsure).
- [ ] Tier-1 golds clean (`bun run test scripts/voice-audit/__tests__` green).
- [ ] You know, from Phase 2's note, which judge to trust least.

If any fails, you have eval debt — fix it before iterating the prompt, or every measurement
downstream is suspect.
