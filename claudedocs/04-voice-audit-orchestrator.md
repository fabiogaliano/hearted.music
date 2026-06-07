# Handoff — Phase 4: The prompt-research eval orchestrator (standing role)

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
and all three prior "Progress so far" blocks — especially Phase 3's v17 baseline scorecard +
scoreboard command, and Phase 2's note on which judge you trust least.

This is the final, standing prompt. Paste it to start (or resume) the research loop.

---

## Status after Phase 3 baseline capture (2026-06-07) — supersedes conflicts below

The v17 + v18 baselines are now captured, judged, and persisted (n=3/song, t0.3, all 9 golds;
full detail in doc 03's "Progress so far — v17 + v18 baselines captured" block). Several claims
further down are now STALE — correct them before iterating:

1. **The standing prior is refuted. Attack register, not grounding.** This doc (loop step 2,
   checklist) says the gap is specificity/grounding. It is NOT. Grounding passed **100% (27/27)**
   on both v17 and v18 — the v17 rebuild closed the grounding gap that sank v14/v15. The dominant
   failure across both versions is the **essayistic / book-report register** (`essayistic-register`
   0/27 on v17, 2/27 on v18), corroborated independently by the Opus pairwise rationales
   ("academic / book-report framing / puffery" vs gold "reads like a friend"). Diagnosis (loop
   steps 1–2) is already done — **start at step 3 with a register hypothesis.**
2. **The v17 baseline IS captured** — the "capture it first / nothing to reproduce" checklist item
   is done. Artifacts: `scripts/voice-audit/eval-artifacts/v17-base.json` and
   `…/v18-regrouped-base.json`.
3. **Iterate from v17, NOT v18.** v18 (`lyrical-v17-regrouped.ts`, registered "18") is a dead end:
   paired McNemar mid-p = **1.000** (indistinguishable — both lose all 9 songs), and it is *worse*
   on redundancy (−19pt) and voice-softness (−7pt). The next prompt is **v19 = v17 + one register
   edit**.
4. **The pointwise scorecard already emits** (the Block 1 note below says it doesn't — that's
   stale). `evaluate.ts --pointwise` runs the 8 judges and `scoreboard.ts` renders per-judge
   pass-rates + the "what keeps losing" digest + an A→B judge diff. You do NOT have to hand-read
   the rationales anymore (you still can).

**Strategic flag:** both v17 and v18 lose **all 9** golds (a hard floor, not a near-miss). If 2–3
register hypotheses don't move `essayistic-register`, suspect a gemini-2.5-flash register ceiling
and try `regen.ts --model gemini-2.5-pro` before grinding more prompt edits against the model.

**Two eval-mechanics fixes shipped with the baseline** (uncommitted, no methodology change): the
pointwise judges run on Vertex (`createLlmService("google-vertex")`) because the AI Studio key is
out of prepay credits; and `runClaude` now retries with backoff + `evaluate.ts` skips a
hard-failing candidate, so a single Opus `400 content-filter` can't discard a whole run (it did
once, on candidate 27/27, before the fix).

---

## Status after Block 1 (2026-06-06) — read before trusting the "exists" claims below

`claudedocs/06-block1-implementation-plan.md` built most of the instrument this role assumes, but
two things this prompt treats as existing do NOT yet:

- The **one-command scoreboard with the aggregated qualitative signal** (loop step 1–2) is not
  built. What exists: `evaluate.ts --out <artifact>` then `scoreboard.ts <A> [B]`, reporting
  per-song pairwise W/T/L vs gold, tier1, marginal Wilson CI, paired McNemar mid-p, and length
  deltas. It does NOT run the 8 pointwise judges or aggregate the recurring rationales / `problems`.
  To diagnose the dominant failure mode you must read the per-run pairwise rationales yourself, or
  build that aggregation first.
- The **v17 baseline scorecard** is not captured yet (Block 1 WP5 is a paid run, not done). And the
  registered `lyrical-v17.ts` is v16 + injection slots, not the from-the-principles v17 doc 03 asked
  for — so the "v17 baseline prompt" you inherit is thinner than that handoff implies.

Changed by Block 1, in your favor:
- All 8 judges reason before they decide (rationale/evidence precede the verdict boolean).
- The grounding judge is **cite-or-fail** (a pass must cite supporting lyrics/annotations). The
  "fix the judge, re-run gold + negative acceptance" reflex is now a real harness:
  `bun scripts/voice-audit/grounding-calibration.ts` over the 9 golds +
  `fixtures/grounding-negatives.ts` — reports self-consistency, raw agreement, and Cohen's κ.
- Diff view = `bun scripts/voice-audit/scoreboard.ts <prior-artifact> <new-artifact>`.
- Iteration log lives at `scripts/voice-audit/experiments/changelog.md` (append-only).

---

## Your role

You are the prompt-research AI engineer and eval orchestrator for the Hearted voice audit.
The truth (9 golds), the calibrated eval (tier1 rules + 8 tier-2 judges, all gold-validated),
the annotations data path, the v17 baseline prompt, and the one-command scoreboard all exist.
Your job is to **iterate the song-analysis prompt until candidates tie or win the majority of
pairwise comparisons vs the golds across all 9 songs, while staying tier1-clean and passing
the grounding judge** — then hand back a converged prompt and a readiness signal.

## The optimization contract

- **Maximize:** pairwise **win + tie** rate vs gold, summed across the 9 songs using an **odd**
  run count per song for any real comparison (default **n=3** so every song has a majority
  outcome). This is the target — not tier1 score.
- **Gates (must hold, never traded away):** tier1 = 0 HIGH; the **grounding judge** passes;
  the other judges trend clean. A candidate that wins pairs by *importing an ungrounded fact*
  is a calibration failure, not a win — see "When a win is fake" below.
- **Golds are truth.** You are not trying to beat the golds in the abstract; you are trying
  to make the prompt reliably produce reads of the golds' character. A candidate "beating" a
  gold usually means the gold is better and the judge slipped — investigate before celebrating.

## The loop (one hypothesis per iteration)

1. **Run the scoreboard** for the current best variant at an **odd** run count, typically n=3:
   `regen.ts --version <N> --songs golds --runs 3` → `evaluate.ts --version <N> --limit 3 --out
   <artifact>` → `scoreboard.ts <artifact>`. Read the per-song W/T/L and gate status. The
   **aggregated qualitative signal** is not auto-emitted yet (see the Block 1 status note above) —
   read the per-run pairwise rationales in the artifact directly until that aggregation is built.
2. **Diagnose** the single dominant failure mode. **Updated prior (2026-06-07 baseline,
   supersedes session 5.5):** the gap is the **essayistic / book-report register**, NOT
   specificity/grounding — grounding now passes 100% on v17+v18 and `essayistic-register` fails on
   ~every candidate (see the 2026-06-07 status block up top). The old "specificity / grounding"
   prior is closed. Confirm or refute against this run's rationales before acting.
3. **One hypothesis, one edit.** Make a single targeted change to the prompt (vN → vN+1).
   Never shotgun multiple edits — you won't know which one moved the needle. Register vN+1.
4. **Re-score vN+1** and **diff vs vN** (the scoreboard's diff view).
5. **Keep or revert.** Keep only when improvement is spread across songs, the gates still hold,
   and the scoreboard does **not** treat the move as indistinguishable from noise. McNemar is a
   strong positive signal when it fires, but otherwise acts as a **noise veto**, not a hard keep
   gate. Log every iteration (hypothesis → result → keep/revert) to a running changelog in
   `claudedocs/`.
6. **Use odd n throughout real comparisons.** Do not drop back to n=2. Use a smaller odd count
   only for smoke checks, and use the working odd count for any real keep/revert call so each
   song still collapses to a majority outcome.
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

- [x] `evaluate.ts --out` → `scoreboard.ts` runs end-to-end, and the v17 + v18 baselines ARE
  captured (2026-06-07; `eval-artifacts/v17-base.json`, `…/v18-regrouped-base.json`). Iterate from
  v17 (v18 is a dead end). The `--pointwise` per-judge pass-rates + "what keeps losing" digest now
  emit from `scoreboard.ts`.
- [ ] Tier-2 judges accept the 9 golds and reject the subtle negatives — run
  `bun scripts/voice-audit/grounding-calibration.ts` for grounding, and
  `bun run test scripts/voice-audit/__tests__/tier2-schemas.test.ts` for the rest.
- [ ] Tier-1 golds clean (`bun run test scripts/voice-audit/__tests__` green).
- [ ] You know, from Phase 2's note, which judge to trust least.

If any fails, you have eval debt — fix it before iterating the prompt, or every measurement
downstream is suspect.
