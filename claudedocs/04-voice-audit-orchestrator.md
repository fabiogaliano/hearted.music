# Handoff — Phase 4: The prompt-research eval orchestrator (standing role)

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
and all three prior "Progress so far" blocks — especially Phase 3's v17 baseline scorecard +
scoreboard command, and Phase 2's note on which judge you trust least.

This is the final, standing prompt. Paste it to start (or resume) the research loop.

---

## Status after Round 3b — PAID ARBITER VERDICT (2026-06-07) — SUPERSEDES everything below

The deferred Opus pairwise ran. **It is decisive and it corrects the Round-3 "conditional GO" to a
NO-GO vs the gold bar.** Full detail: `claudedocs/08` ("ROUND 3b"). Headline:

- **Matched pairwise, n=3 × 9 golds (54 pairs), same v17 reads judged raw vs rewritten vs gold:**
  v17 raw **0W/0T/27L (0%)**, v17+rewrite **0W/0T/27L (0%)**. The rewrite cleaned tier1 HIGH → 0 on
  nearly every read and **converted zero losses.** Reproduces the established v17-raw floor (0/27).
- **The register was never why v17 loses to gold.** Judge rationales show three gap classes, only one
  register: (a) residual MEDIUM/ungated tells the rewrite doesn't target (puffery "profound", data-speak
  "low energy and valence", "The song grapples with"); (b) **depth/specific-noticing the rewrite cannot
  add** ("church camp", "one, two, three, freeze", "silence as the grief he allows"); (c) **correctness
  errors v17 makes and the rewrite preserves** (pink-pony "Midwest" → it's the South; as-it-was invented
  "a bell for help"; dtmf wrong "reggaeton beat"). (b)+(c) are not rewrite-addressable.
- **Call: NO-GO vs the gold bar.** v17 prompt stays converged (do not reopen). The rewrite pass is a
  real, content-safe artifact (cleans tier1, preserves grounding — both proven) but does NOT make v17
  rival the golds. ACTIVE stays **13**.
- **The ONE open, decision-relevant question this run did not test:** is v17+rewrite better than **v13
  (current prod)**? The free ship check said yes (cleaner + more grounded than v13's clean-but-thin),
  but the judge compared to GOLD, not v13. If the goal is "upgrade v13" (not "match gold"), the test to
  run is **v17+rewrite vs v13 head-to-head** (≈$3–4, n=3×9) — recommended, not yet run, separate auth.

Tools added Round 3b: `bun scripts/voice-audit/pairwise-rewrite.ts` (matched raw/rewrite vs gold,
resilient to judge JSON-parse failures). Artifacts: `eval-artifacts/{v17-raw-matched,v17-rewrite-matched}.json`.

---

## Status after Round 3 — the rewrite pass is BUILT (2026-06-07) — see Round 3b above for the verdict

The lever rounds 1–2 kept pointing at is now real. Full log: `claudedocs/08-voice-audit-phase4-changelog.md`
("ROUND 3" + the Round-3 readiness call). Headline:

- **Built `scripts/voice-audit/rewrite/rewrite-pass.ts`** — a second Flash call that takes a finished
  v17 read, is handed the exact tier1-flagged spans + per-rule fix recipes, and recasts ONLY those
  sentences. Surgical fidelity is enforced in code (`applySurgical` pins lens/tension/`lines`/arc
  labels+moods from the original, takes the model's text only for flagged fields, can't fill a null
  contradiction/texture) and unit-tested. A rewrite works where the prompt failed because it is a
  constrained transformation, not free composition — the model doesn't re-invent the tell.
- **It removes the tells, for free:** across the 9 golds' dirtiest v17 reads, **56 → 1** targeted HIGH
  tells (the 1 residual is a `participial-closure` rule false-positive on "a specific, shocking
  detail", not a real tell), mostly in one pass, ~3.2k tokens/read. Content preserved (unflagged
  sentences byte-identical in the diffs). `bun run test scripts/voice-audit/__tests__` → **159/159**.
- **Ship check (v13 prod vs v17 vs v17+rewrite, n=3 golds):** Σ HIGH **v13 5 / v17 15 / v17+rewrite 0**.
  More important than the number: v13 is generic-and-thin even when clean (As It Was: tier1-clean but
  "the past is a powerful force… universally felt," empty texture), while v17+rewrite is clean AND
  grounded (names, quotes, real lenses). v17+rewrite **dominates v13 on both cleanliness and depth.**
- **Call: conditional GO** to take v17 + the rewrite pass into the Session-6 cutover. Two gates remain
  before flipping `ACTIVE_LYRICAL_VERSION` (still 13): (1) ONE user-authorized paid Opus pairwise of
  **v17+rewrite vs gold** (the program's official arbiter; not run, cost) — does the clean grounded
  read convert losses to ties? and (2) wire the pass into the prod path (`song-analysis.ts`) with the
  tier1 rules + grounding judge as gates. **Do NOT reopen prompt iteration; v17 stays converged.**

Tools added this round: `bun scripts/voice-audit/rewrite-demo.ts` (BEFORE/AFTER on real v17 reads),
`bun scripts/voice-audit/ship-check.ts` (v13 vs v17 vs v17+rewrite). Artifacts in
`scripts/voice-audit/{rewrite-artifacts,ship-check-artifacts}/`.

---

## Status after Round 2 register research (2026-06-07) — SUPERSEDES everything below

User re-opened prompt research (web best-practices + 5–6 variants, smoke, pick best; Flash only, Pro
dropped on cost). Ran six fresh, research-backed single-edit variants of v17 — full log + sources in
`claudedocs/08-voice-audit-phase4-changelog.md` ("ROUND 2"). Headline:

- **No variant beats v17; none eliminates the pivot.** Free smoke (Flash n=3 × 9 golds, t0.3, tier1
  antithesis rule): v24 (copula-displacement) 0.23/c, v25 (micro-exemplars) 0.30, v28 (synthesis) 0.29,
  v17 0.31, v27 0.31, v26 0.36, v23 (pure-affirmative) 0.44. The v17/v24/v25/v27/v28 spread is **within
  noise** (n~30). Hand-read confirms: register gains (v24's direct protagonist reads, v25's
  second-person "you" on As It Was) are **marginal and song-dependent**, and the essayism + residual
  pivot are robust on **collective/non-protagonist songs** (Not Like Us, No Sex for Ben) across all
  seven versions — the model-level default, re-confirmed.
- **Two genuinely new findings (beyond round 1):** (1) **category-level naming is SAFE** — v27's
  abstract "thesis-antithesis/dialectical-hedging" prohibition does NOT prime the rate the way v20's
  concrete `Wrong:` strings did (0.31 vs 0.56); it's the better-phrased caution, an optional v17 wording
  refinement. (2) **pure-affirmative/guardrail-removal is WORST** (v23 0.44; corroborates v22) — v17's
  explicit caution does real work.
- **Elimination = prompt + gate, quantified.** Gate sim on the 200 fresh candidates: regenerate-on-hit
  lands a clean read in ~1.3 draws (v17 76% clean; **v24 80%/1.25 — cheapest to gate**), 0/9 songs
  all-pivoted. Prompt alone can't; prompt+the-already-built-gate can.
- **Call: NO-GO unchanged; v17 stands.** v23–v28 registered as dead-end records; ACTIVE still 13.
  Optional prompt polish = adopt v27's category-level line. Real lever = the tier1 regenerate-on-hit
  gate (optionally on v24). One open question the smoke can't answer, deferred to a user-authorized
  paid Opus pairwise: does the protagonist-song register polish convert any losses to ties? (Expected
  ≈ v17 from the qualitative read.)

---

## Status after Phase 4 convergence (2026-06-07) — SUPERSEDES everything below

The iteration loop ran and **converged to a NO-GO**. Full log + readiness call:
`claudedocs/08-voice-audit-phase4-changelog.md`. Headline:

- **5 experiments, none clears the bar.** v18 (regroup) dead; v19 + v20 (prohibition edits) routed
  around; v21 (demonstration re-weight) back to 0; Flash→pro swap (P1 n=1, P2 n=3) is the best
  measured at **17% win+tie / 1-of-8 songs** but still far below the majority-of-9 bar.
- **Converged best prompt = v17.** Nothing beat it. v18–v21 are registered dead ends; ACTIVE still 13.
- **The one wall:** the essayistic register — concretely the **"X is not Y. It is Z" antithesis
  pivot** + book-report framing — is a model-level Gemini-2.5 default (Flash AND pro), the dominant
  pairwise loss cause. Grounding (100%), specificity (~100%), tier1 mechanics are all solved.
- **Prompt-only iteration is exhausted.** Next lever must be non-prompt: a post-generation rewrite
  pass (recommended), a broadened tier1 antithesis gate + regenerate-on-hit, accept-the-gap, or
  fine-tune. See doc 08's "CONVERGENCE / READINESS CALL" for the full fork + the length/grounding
  calibration caveat on pro's marginal ties.
- **Opus 5-hour cap was hit** at the end of P2 (retries fired) — measurement is blocked until it
  resets; the rewrite-pass demo and the tier1 gate are both buildable/verifiable WITHOUT Opus.
  (Correction: the cap was NOT actually hit — those retries were transient CLI hiccups; budget was
  fine. Work continued.)

**Post-convergence (user-directed: kill the "X is not Y. It is Z" pivot, the most-evident AI tell):**
- **tier1 cross-sentence antithesis rule SHIPPED + calibrated** (`tier1/rules.ts`
  `ANTITHESIS_CROSS_SENTENCE`, HIGH; 0 hits on all 9 golds; `bun run test scripts/voice-audit/__tests__`
  153/153). It closes the hole where the old rule's `[^.]*?` stopped at the period and missed the
  dominant cross-sentence pivot — which is why tier1 read clean while the pairwise drowned in it.
- **CONCLUSIVE: the pivot cannot be prompted away.** Measured free across 4 prompts (v17 0.28 / v22
  no-mention 0.38 / v20 ban-with-examples 0.56 / v21 demo 0.63 hits/cand; pro 1.13). It is a
  base-model default; showing the literal pivot as a "Wrong:" example makes it WORSE. The lever is
  **non-generation**: regenerate-on-hit using the new gate (~1.3–1.4 draws at flash, ~73–77% clean)
  or a post-generation rewrite pass. Necessary cleanup of the #1 tell, but not alone sufficient to
  tie the golds. Production mechanism not yet built (prod-pipeline change). Full detail: doc 08.

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
