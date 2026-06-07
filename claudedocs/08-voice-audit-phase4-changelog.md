# Voice-Audit Phase 4 — prompt-iteration changelog

Append-only. One row per hypothesis: **hypothesis → edit → result → keep/revert**. The basis of
record is **n=3, t0.3, 9 golds, `--pointwise`** (odd counts only; n=1 is smoke-only — never a
keep/revert basis). Optimization target = pairwise **win+tie** rate vs gold across the 9 songs.
Gates: tier1 0 HIGH, grounding judge passes. See `claudedocs/04-voice-audit-orchestrator.md`.

Baselines carried in (captured 2026-06-07, doc 03): **v17** and **v18** each **0/9 win-or-tie**
(0W/0T/27L), grounding **100%**, dominant failure **essayistic/book-report register**
(`essayistic-register` 0/27 v17, 2/27 v18). Iterate from **v17**; v18 is a dead end.

Artifacts: `scripts/voice-audit/eval-artifacts/{v17-base,v18-regrouped-base}.json`.

---

## H1 — v19: name the book-report register; turn the digest's recurring tells into Wrong→Right

- **Date:** 2026-06-07
- **Parent:** v17 (`lyrical-v17.ts`)
- **Hypothesis:** v17's essayistic-register failure is a *register* miss, not a content miss
  (grounding is already 100%). The existing soft "be the friend, not the critic" line tells but
  never shows. Naming the book-report register explicitly and converting the actual recurring
  failure tells from the "what keeps losing" digest into Wrong→Right pairs — the same
  corrected-pair pattern Gemini follows elsewhere in the prompt — should move
  `essayistic-register` off 0% and start converting losses to ties.
- **Edit (ONE):** new `SOUND LIKE A PERSON, NOT A BOOK REPORT:` section in `lyrical-v19.ts`,
  inserted between `INTERPRET, DON'T DESCRIBE` and `FIND THE READ BEFORE YOU WRITE IT`. Bans three
  named tells with the digest's verbatim failures as the Wrong side: the grand abstract opener
  ("The song lives in…", "finds its rhythm in…"), the theme-summary apposition ("a defiant
  celebration of her survival…"), the floating poetic flourish ("the ghost of what he lost is
  always dancing beside him"). Right rewrites are invented (NO-GOLD-BAKED-IN held). Template diff =
  exactly this one block; everything else byte-identical to v17. Registered "19"; ACTIVE still 13.
- **Smoke (n=1, 2026-06-07):** **DEAD ON ARRIVAL.** Generated 8/9 (motion-sickness's single
  candidate did not store — a generation gap, not the edit's fault). `eval-artifacts/v19-screen.json`.
  Designated smoke signal — `essayistic-register` — **0% → 0% (+0pt)**: did NOT move off zero.
  Pairwise 0W/0T/8L. Per the methodology, n=1 is smoke-only; the secondary-judge deltas
  (redundancy −24pt, voice-softness −12pt, abstract-noun-trap −12pt) are n=1-vs-n=3 noise, not read.
- **Why it failed (Opus pairwise rationales, convergent):** the phrase blocklist was routed around.
  I banned "The song lives in…" / "finds its rhythm in…"; Gemini produced "The song transforms…",
  "It charts a course…" instead — same book-report register, different tokens. It also kept
  restating the lens as decoration in the take. A blocklist of example phrases cannot suppress a
  *behavior*; it only teaches which exact strings to avoid.
- **New signal (separate target):** the candidate repeatedly leaks raw audio-feature vocabulary
  ("low energy and sad valence", "high danceability", "low valence wrap the vocals") out of
  `texture` into the `take`. Candidate for a later hypothesis (possibly tier1-able).
- **Keep/revert:** **REVERT.** Do not spend the n=3 run. `lyrical-v19.ts` stays in-tree + registered
  as the experiment record (dead end, like v18); ACTIVE untouched (13). H2 iterates from **v17**,
  not v19 — replace the phrase blocklist with a *behavioral* register edit (mandate the opening
  move + ban the apposition *form*), not more example phrases.

---

## H2 — v20 (proposed): replace the blocklist with a behavioral register mandate

- **Date:** 2026-06-07
- **Parent:** v17 (NOT v19 — v19 is the failed branch)
- **Hypothesis:** the dominant essayistic tell — cited in nearly every Opus pairwise rationale on
  BOTH Flash and pro — is the **antithesis thesis-pivot** ("This is not X. It is Y", "not a rival
  but a predator"). v17 has one weak line against it that shows only the in-clause form and gets
  buried, so the cross-sentence form sails through. A behavioral, example-driven ban covering all
  forms (in-clause, cross-sentence, mirrored) should drop the tell out of the candidates and start
  converting losses toward ties.
- **Edit (ONE):** REPLACE v17's "Say what something is. Don't say what it 'isn't'…" line with a
  behavioral ban: names the move as the book-report tell, kills it in every form, gives Wrong→Right
  pairs from the actual cited failures (invented Rights), and keeps the legit subordinate-contrast
  carve-out. Template diff = exactly that one paragraph; everything else byte-identical to v17.
  Registered "20"; ACTIVE still 13.
- **Read criteria (refined):** the pointwise `essayistic-register` judge looks saturated at 0%
  (stuck even on pro candidates the Opus pairwise rated close/tie), so judge mainly on the Opus
  pairwise rationales — did "not X, it is Y" drop out? — plus any pairwise tie/close-call movement.
- **Smoke (n=1) — FREE mechanism check, Opus NOT spent:** generated 9/9 (tier1 mean-high 2.89,
  intact). A free grep of the raw v20 take/contradiction/scene text for the antithesis pivot found
  it STILL present in **4/9** candidates, in forms the edit's examples didn't literally name:
  beautiful-things "aren't just gifts; they are a ticking clock"; no-sex-for-ben "is not just bad,
  but pathetic"; dtmf "are not separate from the past; they are built on it"; not-like-us "is not
  just about one man; it is about his whole crew." The edit banned "This is not X. It is Y."; the
  model routed to "X is not just Y; it is Z" / "not just X, but Y." Same routing-around failure as v19.
- **Keep/revert:** **REVERT.** Opus smoke not spent — the free raw-text check already shows the
  mechanism failed (tell not suppressed). `lyrical-v20.ts` stays in-tree + registered as the record;
  ACTIVE untouched (13).
- **META-FINDING (across v19 + v20):** example-driven NEGATIVE instruction does not suppress the
  essayistic register on gemini-2.5-flash. Showing "here are bad forms, avoid them" teaches the
  model to avoid those exact strings and generate structurally-identical variants around them. Two
  prohibition edits failed this way; the pro probe (P1) showed the tells survive a model swap too.
  Next lever must change: from PROHIBITION to DEMONSTRATION (make the worked-example/{example} slot
  dominant, trim the wall of negative rules) or to a PIPELINE gate (a tier1 rule that catches the
  "not just X" / cross-sentence antithesis and forces regeneration). Strategic call — see below.

## P1 — Probe: v17 prompt UNCHANGED, model swap Flash → gemini-2.5-pro (model-ceiling test)

- **Date:** 2026-06-07 · **n=1 smoke**, 8/9 songs (dtmf generation dropped; excluded via `--songs`
  so no Flash fallback). Prompt held at v17; only `regen --model gemini-2.5-pro` changed.
  Artifacts: `eval-artifacts/v17-pro-screen.json` (model verified `google-vertex:gemini-2.5-pro`)
  vs `v17-base.json` (Flash n=3).
- **Question:** is the essayistic-register failure a gemini-2.5-flash ceiling? If a stronger model
  clears it with the same prompt, the fix is the model, not the prompt.
- **Result (divergent signals):**
  - Strict pointwise `essayistic-register`: **0% → 0%** — unchanged. Pro does NOT clear the register judge.
  - Opus pairwise vs gold: **0% → 13%** (1 tie / 8) — first non-loss in the whole program, several
    "close call" rationales. tier1 mean-high **3.67 → 2.13** (pro adheres to the mechanics better).
  - The lone tie (drivers-license) is **shaky**: its rationale flags invented details ("In-N-Out
    parking lot", "white Honda") not in the song — a possible fake tie / grounding-judge slip
    (the "when a win is fake" reflex), not a clean win.
  - Secondary judge deltas (voice-softness −25pt, redundancy +13pt, abstract-noun −12pt) are
    n=1-vs-n=3 noise; not read.
- **Conclusion: pro is NOT a register ceiling-break.** The dominant tells survive the model swap —
  the **antithesis pivot ("This is not X. It is Y", "not just a feeling. It is…", "not a rival but
  a predator")** and the **book-report opener ("This is…", "The song is…")** appear in nearly every
  pro pairwise rationale, the same as on Flash. Pro mainly cleans tier1 (a guardrail we already
  pass) and buys one shaky tie. **The register is a prompt/behavior problem, model-independent.**
- **Keep/revert:** no keep. Stay on Flash (cheaper; pro's only real gain is on tier1, which isn't
  the target). The probe SHARPENS H2: the single most-cited essayistic tell across both models is
  the **antithesis thesis-pivot** (MEC-6 / SFT-7 mirrored parallelism) plus the book-report opener
  — target those two moves behaviorally, not a phrase blocklist.

## H3 — v21: demonstration over prohibition (elevate the worked examples above the rule-wall)

- **Date:** 2026-06-07 · **Parent:** v17 (branches from v17, not v19/v20).
- **Rationale (research-backed):** web research confirms few-shot exemplars steer style more
  reliably than verbal rules ("you can remove instructions if your examples are clear enough"), and
  negative "don't" rules are weak for register — which is why v19/v20 (both prohibition) were routed
  around. The demonstration lever is ALREADY present: `regen.ts` injects 2 full leave-one-out gold
  reads into `{example}` (rendered by `renderExemplarBlock`, "study their voice… write in the same
  voice"). But it competes against a ~20-rule prohibition wall and the prompt never says the examples
  OUTRANK the rules for voice — so the model obeys rules that *describe* essayistic constructions
  while banning them.
- **Edit (ONE):** insert one all-positive directive after `{example}` — "THE BAR IS THOSE EXAMPLES,
  NOT THIS LIST OF RULES… follow the examples… The rules… do not set the voice; the examples do."
  No new prohibition, no bad-register text to copy, no gate touched. Template diff = exactly that
  block. Registered "21"; ACTIVE still 13. typecheck clean.
- **Smoke (n=1) — FREE register scan (8/9; motion-sickness gen dropped):** MIXED. Several takes now
  open concretely on the person (beautiful-things, dtmf, blinding-lights — the example voice
  landing), but the book-report frame persists on no-sex-for-ben ("The song is a relentless… public
  denunciation"), not-like-us ("This is a declaration of war…"), as-it-was ("The song opens with…");
  antithesis pivot on ~3–4. Partial improvement, not a clean miss → free check can't decide it, so
  the Opus pairwise was spent.
- **INDEPENDENT FINDING (fixable, future hypothesis):** not-like-us's take opens **"This is a
  declaration of war"** — *verbatim v17's own `Wrong:` example* (template line 84). The model is
  lifting the prompt's in-prose negative examples as templates. v17 carries several `Wrong:` snippets;
  neutralizing/relocating them (or not spelling bad text at all) is a clean candidate edit, separate
  from H3.
- **Smoke (n=1) Opus result — `eval-artifacts/v21-screen.json`:** **0W/0T/8L (0%)** — back to the
  floor (worse than pro's 1 tie). Pointwise essayistic-register still 0%. Opus rationales cite the
  same tells: as-it-was "opens like a book report ('The song opens with…')"; dtmf "leans on
  antithesis ('This isn't a paralysis; it is a push')"; not-like-us "'This is a declaration of war,
  not just… but'" + **data-speak leak** ("Its low valence suggests a negative emotional tone").
  redundancy +13pt but register flat (n=1-vs-n=3 noise on the rest).
- **Keep/revert:** **REVERT.** One re-weighting sentence cannot overcome the ~20-rule wall. v21
  stays in-tree as the record; ACTIVE untouched (13).
- **DECISION POINT:** three Flash register hypotheses (v19 prohibition, v20 prohibition, v21
  demonstration-lite) have all failed to move the pairwise off 0. Per the brief's escalation ("2–3
  register hypotheses don't move it → suspect a Flash ceiling, try pro BEFORE grinding more prompt
  edits"), stop grinding Flash. The pro n=1 probe (P1) was the strongest signal in the program
  (cleaner tier1, 1 tie, close-calls). Next: **confirm pro at n=3 on v17** (basis-of-record) — does
  the prescribed escalation actually convert? See P2 below.

## P2 — Confirm: v17 prompt UNCHANGED on gemini-2.5-pro at n=3 (basis-of-record escalation)

- **Date:** 2026-06-07 · prompt held at v17, `regen --model gemini-2.5-pro --runs 3`. Confirms the
  P1 n=1 hint at the basis-of-record. Opus n=3 eval (81 calls) GATED behind verifying clean per-song
  pro coverage (≥3 fresh pro runs/song) to avoid Flash/pro-n1 contamination in selectCandidates.
- **Coverage:** pro generation is flaky — dtmf got 1 run, blinding-lights/as-it-was 2 each, the
  other 6 got 3. A reproduction of `selectCandidates` (newest-3 by version+temp) confirmed 8/9 songs
  resolve to all-pro at `--limit 3`; only dtmf is mixed (PRO,flash,flash) and was EXCLUDED via
  `--songs`. Evaluated 8 clean songs, 24 pro candidates. Artifact model verified all
  `google-vertex:gemini-2.5-pro`.
- **Result — `eval-artifacts/v17-pro-n3.json`:** **0 win / 4 tie / 20 loss → 17% win+tie**;
  per-song majority **1/8** (drivers-license TIE,TIE,LOSS). pink-pony (LOSS,TIE,LOSS) and as-it-was
  (LOSS,LOSS,TIE) each scraped one tie; the other 5 lost all 3. Gates held: grounding 100% (23/23),
  specificity 100%, tier1 1.75 high (cleanest of any run). essayistic-register 13% (3/24) — off
  Flash's 0% but still failing 21/24.
- **Two Opus retries (as-it-was, motion-sickness) fired** — the brief's 5-hour-cap signal. Stop
  launching big Opus runs.
- **Call:** pro is the strongest setup measured, and STILL **1/8 songs** — far below the bar
  (majority of 9). The 4 ties correlate with length (success Δ+131 vs fail Δ+45, r=0.43), and the
  free scan shows the **"X is not Y. It is Z" antithesis pivot in nearly every one of the 24 pro
  candidates** — pro produces the essayistic register as much as Flash. The model swap cleans tier1
  and scrapes a few length-driven ties; it does NOT fix the register. No keep (cost ~3–5× Flash for
  a register that isn't fixed).

---

# CONVERGENCE / READINESS CALL (2026-06-07)

**The loop has converged. The answer is a NO-GO for the Session-6 prod cutover, and the reason is
a single, well-localized, model-level wall.**

**What's solved (do not re-litigate):** grounding 100% (Opus, priority-1) on every version/model;
tier1 mechanics clean (1.7–3.7 high, all non-blocking); register-specificity ~100%; the v17 rebuild
closed the v14/v15 specificity/grounding gap entirely.

**The one residual risk — and it is the whole ballgame:** the **essayistic / book-report register**,
concretely the **"X is not Y. It is Z" antithesis thesis-pivot** plus book-report framing
("The song is a…", "This is a…"). It is the dominant reason candidates lose to the golds in the
Opus pairwise, on every version and both models.

**It resists every lever tried (5 experiments):**
| # | lever | result |
|---|---|---|
| v18 | regroup arc | dead (McNemar 1.000; worse on redundancy/voice-softness) |
| v19 | prohibition: blocklist essayistic openers | routed around (new openers substituted) |
| v20 | prohibition: behavioral ban on antithesis pivot + examples | routed around (new forms substituted) |
| v21 | demonstration: re-weight examples above the rule-wall | insufficient; pairwise back to 0 |
| P1/P2 | model swap Flash → gemini-2.5-pro (n=1, n=3) | best measured (17% / 1-of-8) but register pervasive; ties length-driven |

**Diagnosis:** the "X is not Y. It is Z" construction is how the Gemini 2.5 family writes by default.
Negative prompting teaches it to dodge the exact banned strings and emit structural twins (confirmed
twice). A stronger model writes the same register more fluently. Three orthogonal prompt-edit classes
+ a model upgrade all failed to remove it. **Prompt-only iteration has hit diminishing returns.**

**Converged best prompt:** **v17** (no edit beat it; v18–v21 all reverted). If shipping anything from
this program, ship v17 — but know it produces the AI register.

**Recommended paths (human's call — taste + cost + architecture):**
1. **Post-generation rewrite pass (most promising, cheap):** a second Flash call that takes the
   draft read and rewrites only the antithesis-pivot / book-report sentences into the friend
   register, preserving all grounded content. Attacks the failure where it is catchable — the
   finished text — instead of trying to suppress a default tendency at generation. No Opus needed to
   generate; Flash-rewrites-Flash.
2. **Deterministic de-essayist tier1 rule + regenerate-on-hit:** broaden the tier1 `antithesis` rule
   (currently in-clause/token-scoped) to catch cross-sentence "X is not Y. It is Z" and "not just X;
   it is Y". Won't fix generation, but makes the failure VISIBLE/gateable and enables reject-and-retry.
   This is why tier1 reads ~clean (1.75 high) while the pairwise loses — the dominant tell isn't gated.
   (Phase-1 territory; untouched per scope.)
3. **Accept the register gap and ship v17/v13** as "grounded, specific, mechanically clean, but
   AI-voiced." Honest if the rewrite pass isn't worth the latency/cost.
4. **Heavier lifts:** fine-tune on the golds, or a gold-dense few-shot regime.

**Calibration caveat to verify before trusting marginal "wins":** pro's ties correlate with length
(r=0.43) and drivers-license's n=1 tie used possibly-imported detail ("In-N-Out parking lot",
"white Honda") while grounding passed 100%. The 17% may be mildly inflated by the judge rewarding
longer/detail-dense candidates. Doesn't change the headline (register is the wall), but spot-check
the grounding judge (`grounding-calibration.ts`) before treating any pro tie as a real win.

**Uncovered:** dtmf (chronic pro-generation flakiness — 0/1/1 valid runs across attempts); motion-
sickness also flaky on n=1. Both generated fine on Flash. If pursuing pro, investigate the
generation drops (likely content-filter or length).

# POST-CONVERGENCE: target the antithesis pivot directly (2026-06-07, user-directed)

User priority: the **"X is not Y. It is Z" antithesis pivot** is the most evident AI tell and must
go. Two levers: (1) extend tier1 to catch it; (2) experiment to stop generating it. (Opus was NOT
actually capped — the earlier retries were transient CLI hiccups; ~72% of the window remained.)

## T1 — tier1 cross-sentence antithesis rule (DONE, shipped uncommitted)

- **Gap found:** the existing tier1 `antithesis` rule (`ANTITHESIS_FRAME`) uses `[^.]*?`, which stops
  at the period — so it catches the same-sentence form ("not just X; it is Y") but MISSES the
  cross-sentence pivot ("This is not a diss track. **It is** testifying."). That's why tier1 read
  ~clean (1.75 high on pro) while the pairwise drowned in the pivot — the dominant tell was ungated.
- **Rule added** (`scripts/voice-audit/tier1/rules.ts`, `ANTITHESIS_CROSS_SENTENCE`, folded into the
  HIGH `antithesis` rule): a negated copular clause ending a sentence, then a next sentence that
  RE-ASSERTS with a copula (pronoun + is/are/'s/a/an/the…). The copula re-assertion is the signature;
  narrative continuations ("She is not ready. She drives anyway.") use action verbs and are skipped,
  and the golds' legit contrasts ("could never be bought, only inherited"; "the door stays shut, not
  slammed") have no "is not … It is" shape.
- **Calibrated:** **0 hits on all 9 golds** (golds-are-truth gate intact — `exemplars.test.ts` green);
  catches the pivot on the real losing candidates. 4 unit tests added (positive + contracted +
  narrative-skip + gold-contrast-skip). **`bun run test scripts/voice-audit/__tests__` → 153/153.**
- **Baseline rate the rule now reveals (free, via runAllRules):**
  | version/model | n | % with antithesis | hits/cand |
  |---|---|---|---|
  | v17/flash | 40 | 23% | 0.28 |
  | **v17/pro** | 31 | **52%** | **1.13** |
  | v20/flash (ban) | 9 | 22% | 0.56 |
  | v21/flash (demo) | 8 | 50% | 0.63 |
  Pro is the WORST (more fluent → more pivots), and the prohibition/demo edits *raised* the rate.
- **Correlation with outcome (pro n=3, free join of artifact verdicts × recomputed antithesis):**
  TIES 75% antithesis-free (3/4) vs LOSSES 50% (10/20). Directional (pivot ↔ losing) but n=4 ties is
  small; and half the LOSSES are pivot-free too → **killing the pivot is necessary cleanup of the
  most-evident tell, not sufficient to tie the golds** (book-report openers, data-speak remain).

## H4 — v22: the PRIMING test (remove v17's anti-pivot line)

- **Hypothesis:** v20 (ban) and v21 raised the antithesis rate → naming the pivot PRIMES it
  ("don't think of an elephant"). Removing v17's "Say what something is. Don't say what it 'isn't'…"
  line should LOWER the rate. v22 = v17 minus that one line (diff verified = the single deletion).
- **Measurement:** FREE — regen v22 flash n=3, count antithesis via the new rule, compare to v17's
  0.28/cand & 23%. Opus only if the rate drops.
- **Result (free, n=26):** v22 = **0.38 hits/cand, 27% with-pivot** vs v17's 0.28 / 23% — flat-to-
  slightly-HIGHER, not lower. **Priming REFUTED.** No Opus spent (drop criterion not met).
- **Keep/revert:** REVERT. v22 in-tree as the record; ACTIVE untouched (13).

## CONCLUSIVE FINDING — the pivot cannot be prompted away; it must be GATED away

Four prompt formulations now measured against the antithesis rate (free, deterministic):
| prompt | how it treats the pivot | hits/cand |
|---|---|---|
| v17 | one mild "don't pivot" line | **0.28** (lowest) |
| v22 | no mention at all | 0.38 |
| v20 | strong ban WITH "Wrong:" pivot examples | 0.56 |
| v21 | "match the examples" demonstration | 0.63 |

The pivot is a **base-model default** (~0.28–0.38/cand on flash, **1.13 on pro**) essentially
independent of how the prompt addresses it — and **showing the literal pivot string as a "Wrong:"
example makes it WORSE** (v20; corroborated by not-like-us copying v17's "This is a declaration of
war" verbatim). Prohibition, demonstration, and removal all failed to reduce it. **You cannot prompt
it away.**

**Therefore the only reliable lever to "not get those" is non-generation:**
1. **Regenerate-on-hit (cheapest, uses the new gate):** at generation, reject any read with
   `antithesis > 0` and resample. Flash is ~73–77% pivot-free, so the gate accepts a clean draft in
   ~1.3–1.4 draws on average. Deterministic, no extra model, leverages exactly the rule shipped in T1.
2. **Post-generation rewrite pass:** a second Flash call that rewrites only the pivot/book-report
   sentences into the friend register, preserving grounded content. Fixes otherwise-good reads
   instead of discarding them. Verify removal for free with the same rule.

Caveat (unchanged): removing the pivot is necessary cleanup of the most-evident tell, but flash
candidates lost the pairwise even when pivot-free — other register issues (book-report openers,
data-speak leak) remain. The gate makes the #1 tell *gone and measurable*; it does not by itself
tie the golds.

**Status:** tier1 gate shipped + calibrated (153/153). Production mechanism (regenerate-on-hit or
rewrite pass) is a generation-path change — recommended, not yet built (it touches the prod pipeline,
a separate decision). Prompt-side research is exhausted: v17 remains the converged best prompt.

---

# ROUND 2 — research-backed register variants (H5–H10, 2026-06-07, user-directed)

User re-opened prompt research: "v17 is our best… research the web on best practices… completely
eliminate 'it is… isn't' and similar… try 5 or 6 adjustments, smoke, pick the best." Goal: kill the
pivot via the prompt. Flash only (Pro dropped — too expensive). The prior round's 4 formulations
(v17 mild line / v20 concrete-ban / v21 demo / v22 removal) all shared one flaw — they either *named
the pivot with a concrete bad-string example* (primes) or *removed the guidance into a vacuum*. This
round tests the corners those missed, each variant a single guarded edit to v17 (string-replace that
throws on a no-op so a mismatched anchor can't ship a v17 clone).

**Web research (sources at end) — the distinction the prior round missed:**
- Positive instructions beat negative for register; "larger LLMs perform *worse* on negative
  instructions"; negative prompts "shift focus toward what you're avoiding" (= the v20/v21 priming).
- **Concrete phrase-banning fails/primes, but *category-level* naming works** — "prohibiting
  'thesis-antithesis patterns,' 'dialectical hedging,' 'rhetorical equivocation' is significantly more
  effective," paired with "define affirmatively; treat contrast as a high-impact tool used sparingly."
- Few-shot *voice samples* (2–5) beat instructions for register (Gemini: "always include examples").
- Full elimination needs **sequence-level enforcement (Antislop) or fine-tuning (FTPO)** — i.e. the
  gate/rewrite, not the prompt. (Confirms the prior call from the literature.)

**Method:** free smoke = regen Flash n=3 × 9 golds, t0.3, score with the tier1 cross-sentence
antithesis rule (`runAllRules`). Same basis as the prior free measurements; v17 re-run this session as
the control. Scripts: `scripts/voice-audit/verify-variants.ts` (diff/guard check),
`analyze-smoke.ts` (rate table + per-song coverage + gate sim).

| version | lever | antith/c | % w/pivot | book/c | high/c |
|---|---|---|---|---|---|
| **v24** | copula-displacement (verbs of action; reserve is/are for plain fact) | **0.23** | 20% | 0.00 | **3.30** |
| v28 | synthesis: v24 + v25 | 0.29 | 25% | 0.04 | 3.75 |
| v25 | sentence-level friend-voice micro-exemplars | 0.30 | 23% | 0.00 | 3.30 |
| **v17** | control | 0.31 | 24% | 0.03 | 3.97 |
| v27 | category-level prohibition + affirmative, no concrete strings | 0.31 | 24% | 0.03 | 3.48 |
| v26 | purge v17's spelled `Wrong:` book-report strings | 0.36 | 25% | 0.04 | 3.54 |
| v23 | pure-affirmative line (zero negation words, no examples) | **0.44** | 33% | 0.07 | 4.30 |

**The differences among v17/v24/v25/v27/v28 are within smoke noise** (20% vs 25% w/pivot ≈ 6/30 vs
7/28; not distinguishable at n~30). What is robust + the hand-read of the actual prose:

- **H5 / v23 — pure-affirmative is the WORST (0.44).** Stripping all negation and the guardrail let
  the base default reassert (corroborates v22's removal → 0.38). **REVERT.** Lesson: v17's explicit
  caution does real work; you cannot just go positive-and-silent.
- **H6 / v24 — copula-displacement: best free score + cleanest, but partly rule-dodging.** Hand-read:
  genuinely direct, person-acting, present-tense on PROTAGONIST songs (drivers-license, DtMF, Motion
  Sickness, Blinding Lights). BUT on collective/argument songs (Not Like Us) the copula ban just
  reroutes the essayism into "It defines/weaponizes/draws…" (uncaught by the antithesis regex →
  flatters the count; one NLU candidate hit high=10). Real but partial. **DO NOT KEEP as a win** — the
  free gain is within noise and the register fix doesn't reach the songs that actually fail.
- **H7 / v25 — micro-exemplars: genuine second-person voice transfer.** Hand-read: As It Was rendered
  in "you" ("The world has shifted, and you find yourself in a new, solitary space… You ring the bell
  for help, but no one comes") — directly traceable to the voice-block, where v17 stayed in "he."
  COST: occasionally adds a pivot at confident take-closings (Pink Pony Club "not just a place; it is
  …"). Net: marginal, song-dependent. **REVERT** (as a measured win); the voice block is a candidate
  to fold into v17 only if a pairwise later shows it converts.
- **H8 / v26 — purging the spelled `Wrong:` strings did not help (0.36, flat-to-worse).** The H3
  finding (not-like-us copied "This is a declaration of war" verbatim) was real, but removing the
  source does not lower the *aggregate* pivot rate. **REVERT.**
- **H9 / v27 — category-level naming is SAFE (0.31 ≈ v17), unlike concrete banning (v20 0.56).** The
  genuinely NEW, research-validated finding: abstract category-level prohibition does NOT spike the
  rate the way v20's concrete `Wrong:` strings did. It doesn't *beat* v17, but it is the better-phrased
  way to state the same caution (no priming, all-affirmative framing). **Optional keep** as a wording
  refinement to v17's anti-pivot line; not a measurable win on its own.
- **H10 / v28 — synthesis (v24 + v25) did NOT stack (0.29 ≈ v17).** Inherits v25's second-person As It
  Was win AND its PPC pivot; collective-song essayism persists (one NLU candidate high=13). No
  additive gain. **REVERT.**

**Gate simulation (read-only, on the 200 candidates generated this round):** the pivot is ELIMINABLE
by prompt+gate, not prompt alone. Regenerate-on-hit (reject antithesis>0, resample) lands an
antithesis-clean draft in **~1.3 draws** (v17 76% clean / 1.32; **v24 80% clean / 1.25** — the lowest
base rate is the cheapest to gate), and on **0/9** songs did every draw pivot.

**IMPORTANT CORRECTION — v17 is NOT "tier1-clean," only gateable on the pivot subset.** The antithesis
gate removes ~8% of v17's HIGH hits. Per-candidate HIGH composition (this round):

| version | antithesis | participial-closure | self-reference | book-report | Σ high/c | % candidates 0-HIGH |
|---|---|---|---|---|---|---|
| v17 | 0.31 | **3.38** | 0.17 | 0.03 | 3.97 | **0%** |
| v24 | 0.23 | 2.93 | 0.10 | 0.00 | 3.30 | 0% |

The dominant tier1 tell is **participial-closure** (the "comma + -ing" construction the prompt
explicitly bans, ~3.4/read anyway), not the antithesis pivot — the pivot just READS as the most
evident tell to a human. And **0% of candidates are fully HIGH-clean**, so you **cannot resample to
tier1-clean** — a regenerate-on-hit gate can only ever fix what it gates on (the pivot). The only path
to an actually-clean read is a **rewrite pass** that surgically fixes participial-closure + antithesis
+ self-reference together. This makes the rewrite pass *higher-leverage than the antithesis gate*, not a
co-equal alternative — and it is consistent with the prior session already ranking the rewrite pass as
"most promising."

## CONVERGENCE — round 2 re-confirms the NO-GO; v17 stands

Six fresh, research-backed levers (v23–v28) **do not beat v17** on the pivot and **none eliminates it**.
The essayistic register + residual pivot are concentrated on **collective/non-protagonist songs** (Not
Like Us, No Sex for Ben — "The song is a public trial… It lists…") and are robust across all seven
versions including v17 — confirming the model-level Gemini-2.5 default diagnosed in round 1.

- **Best prompt: still v17.** No keep. v23–v28 registered in-tree as the experiment record (dead ends);
  ACTIVE still 13.
- **One optional prompt nicety:** swap v17's negatively-phrased anti-pivot line for v27's category-level
  + affirmative phrasing (safe, research-aligned, no priming, ~equal rate). Wording polish, not a win.
- **The lever that actually eliminates the pivot is the gate** (tier1 regenerate-on-hit, already built
  + calibrated) — optionally on the lower-base-rate v24 prompt to cut resample cost. Prod-pipeline
  change, still out of scope here (human's call). A rewrite pass is the alternative.
- **Untested by design:** a paid Opus pairwise on v28/v24/v25 vs gold (does the protagonist-song
  register polish convert any losses to ties?). The free + qualitative evidence shows v28 ≈ v17 on the
  failing songs, so no movement is expected; deferred to a user-authorized run rather than spent
  autonomously (cost). This is the one open question the smoke cannot answer.

**Sources (round-2 web research):**
- "Why Does AI Keep Saying 'It's Not X, It's Y'?" — DEV Community (category-level vs phrase-banning; affirmative reframe)
- "Some alternatives to 'It's not X; it's Y'" — Hardly Working / Substack (positive rewrite patterns)
- "Positive Prompts Outperform Negative Ones with LLMs" — Gadlet; KAIST finding via prompt-engineering best-practice roundups
- "Antislop: Identifying and Eliminating Repetitive Patterns in LMs" (arXiv 2510.15061) — sequence-level enforcement + FTPO
- Google "Prompt design strategies" (ai.google.dev) — always include few-shot examples; persona/instruction placement
- Humanizing-LLM editing guides (louisbouchard.ai; sabrina.dev) — 2–5 voice samples; negative-parallelism as the AI tell

# ROUND 3 — the rewrite pass, built and shipped (2026-06-07, user-directed)

Round 2 ended on the call that the register CANNOT be prompted away and that the **rewrite pass** is
higher-leverage than the antithesis gate (it can fix participial-closure + antithesis + self-reference
together; the gate only fixes the pivot, and 0% of candidates are gateable-to-clean). This round
**builds that rewrite pass**, proves it removes the tells for free, and runs the ship check (v13 vs
v17+rewrite) the program was waiting on.

## What was built

- **`scripts/voice-audit/rewrite/rewrite-pass.ts`** — `rewriteRead(read, llm, {maxPasses})`. A
  second Flash call that takes a finished `ConceptRead`, computes its tier1 HIGH hits, hands the model
  the **exact flagged spans by field** with a per-rule fix recipe (only the recipes for rules that
  actually fired, so it doesn't re-prime the full catalogue — the H4 priming lesson), and asks it to
  recast only those sentences. Loops up to `maxPasses` (default 2) until the targeted HIGH rules clear.
  - **Why a rewrite works where the prompt didn't:** generation is free composition, so the model
    falls into its essayistic default; a rewrite is a *constrained transformation* — the model is
    handed the sentence and told which construction to remove, so it doesn't re-invent the tell.
  - **Surgical guarantee (in code, not trusted to the model):** `applySurgical` pins lens/tension/
    `lines`/arc-labels/arc-moods from the ORIGINAL and takes the model's text ONLY for fields that
    were actually flagged this pass; a null contradiction/texture can never be filled. So a flagged
    sentence is the only thing that can change — unit-tested in `__tests__/rewrite-pass.test.ts` (6
    tests, incl. an adversarial model output that tries to corrupt every field and is rejected).
- **`scripts/voice-audit/rewrite-demo.ts`** — runs the pass on the dirtiest real v17 read per song
  from `experiments/` and prints BEFORE/AFTER HIGH composition (free, via `runAllRules`) + prose.
- **`scripts/voice-audit/ship-check.ts`** — generates v13 (prod, legacy shape) + v17 fresh per song,
  rewrites v17, scores all three on the SAME tier1 surface (v13 adapted: interpretation→take,
  journey→arc scene, sonic_texture→texture), dumps prose side-by-side.

**One bug found + fixed during the build:** the first prompt rendered each arc beat as
`beat N (label — mood): <scene>`, and the model echoed `"beat N"` back AS the scene value — destroying
content. Fixed by presenting the scene as an unambiguous `scene N:` value AND making `applySurgical`
field-aware (an unflagged or corrupted scene is discarded in favour of the original). `bun run test
scripts/voice-audit/__tests__` → **159/159** (153 + 6 new).

## Result 1 — the pass removes the tells, for free (rewrite-demo, 9 golds, dirtiest read each)

| total across 9 dirtiest v17 reads | targeted HIGH tells | Σ HIGH |
|---|---|---|
| BEFORE (v17 flash) | **56** | 56 |
| AFTER (+rewrite, ≤2 passes) | **1** | 1 |

55 of 56 genuine tells gone, mostly in **one pass**, ~3.2k tokens/read (Flash, cheap). The lone
residual (No Sex for Ben) is a **tier1 rule false-positive**, not a pass failure: `participialClosure`
flags `"a specific, shocking detail"` because "shocking" ends in `-ing` and the following noun
("detail") isn't a known determiner — but it's an adjective in a list, already good prose, so the
model correctly leaves it. (A narrow `participial-closure` blind spot: `comma + -ing-adjective + bare
noun`. Out of scope to fix this round; noted for tier1.) Content fidelity verified by direct diff:
flagged sentences recast with meaning intact ("find him alone, sitting on the floor." → "find him
alone. He sits on the floor."), **unflagged sentences byte-identical**, every named detail preserved.
One minor drift class: killing an antithesis pivot can drop a framing word ("not just a diss track;
it is a declaration of war" → "A declaration of war") — defensible (genre framing, not a lyric claim).

## Result 2 — the ship check: v13 (prod) vs v17 vs v17+rewrite

n=3 golds (not-like-us, drivers-license, as-it-was), fresh Flash generations, t0.3. Σ HIGH / read:

| song | v13 (prod) | v17 raw | v17 + rewrite |
|---|---|---|---|
| not-like-us | 1 | 10 | **0** |
| drivers-license | 4 | 0 | **0** |
| as-it-was | 0 | 5 | **0** |
| **total** | **5** | **15** | **0** |

The number is only half the story — **tier1 sees register, not grounding/specificity, which is v17's
whole gain.** The prose read is decisive and one-directional:

- **v13 is not reliably clean** (4 HIGH on drivers-license) AND it is **generic/thin**: Not Like Us
  reads "a definitive statement of loyalty… draws a clear line in the sand… Cultural Reclamation" with
  **zero names or quotes**; As It Was is tier1-clean but nearly empty — "The past is a powerful force.
  It shapes your present… universally felt," with an **empty `sonic_texture`**. This is exactly the
  "clean but says nothing" failure the v17 rebuild was meant to fix.
- **v17+rewrite is clean AND grounded** on every song: Not Like Us names Drake-as-colonizer, "hide
  your lil' sister," "certified pedophiles," the owl label, "drake's mansion on a sex offender
  registry map"; drivers-license has the blonde girl, white cars, "still fuckin' loves him"; As It Was
  has the goddaughter voicemail, "rings a bell for help, but no one comes," the locked door, the
  father living alone. The lenses are real claims ("a milestone as a funeral," "vulnerability as a
  locked door"), not moods.

So v17+rewrite **dominates v13 on both axes** (cleanliness AND depth) for these three. v17 raw confirms
the tells are pervasive at generation (15 HIGH/3 songs) — the rewrite is what makes it shippable.

# READINESS CALL (Round 3) — conditional GO for the cutover, with the rewrite pass in the pipeline

**The NO-GO from rounds 1–2 was "v17 produces the AI register and the prompt can't stop it." Round 3
removes that blocker with a mechanism, not a prompt.** Recommendation:

- **GO to take v17 + the rewrite pass into the Session-6 cutover plan**, on the evidence that
  v17+rewrite is tier1-clean (0 HIGH) and materially more grounded/specific than today's v13 — i.e. it
  ships v13's cleanliness without v13's generic thinness. The mechanism is cheap (Flash-on-Flash, ~1
  extra call/song, 1–2 passes) and its content fidelity is guaranteed in code + unit-tested.
- **Conditions / what is NOT yet proven (do before flipping `ACTIVE_LYRICAL_VERSION`):**
  1. **The official arbiter is still the paid Opus pairwise vs gold; it was NOT run** (cost; deferred
     to user authorization per the contract). The free tier1 + qualitative read is strong and
     one-directional, but the program's keep/revert bar is the pairwise. Recommend a small
     authorized run: **v17+rewrite vs gold, n=3, the 9 golds** — the open question is whether the
     now-clean grounded read converts the pairwise losses to ties/wins. Expectation from the prose
     read: yes for protagonist + collective songs; the residual risk is the judge rewarding gold's
     specific *turns* the rewrite preserves but doesn't add.
  2. **Productionize the pass** — it currently lives in `scripts/`. The cutover needs it in the prod
     generation path (`song-analysis.ts`), wired after the v17 generation, with the same tier1 rules
     as the in-pipeline gate. That is a prod-pipeline change (the Session-6 panel swap already
     touches this file), still the human's call.
  3. **Grounding was not independently re-judged** post-rewrite. The pass only recasts existing
     sentences (verified: no new facts in the diffs), so grounding should be inherited from v17's
     100% — but the productionization run should include the grounding judge as a gate, cheaply.
- **Residual risks named:** the `participial-closure` adjective-in-a-list false-positive (cosmetic,
  ~1/9 reads, leaves a HIGH that isn't a real tell — fix the rule or accept); the minor framing-word
  drop when an antithesis pivot is killed; and Flash's intermittent "could not parse" generation drops
  (the ship-check retries 3×; prod needs the same).

**Bottom line:** prompt iteration stays converged at v17 (do not reopen it). The lever the last two
rounds pointed at is now **built, measured, and content-safe**. The remaining gate to a true GO is one
user-authorized paid pairwise + the prod wiring — not more research.

# ROUND 3b — the paid arbiter VERDICT on the rewrite pass (2026-06-07, user-authorized)

Ran the deferred Opus pairwise. **Matched within-run design** (`scripts/voice-audit/pairwise-rewrite.ts`):
for each gold, the newest-3 real v17 flash reads were judged RAW vs gold AND after the rewrite pass vs
gold — same candidates both sides, so the only variable is the rewrite. n=3 × 9 golds = **54 pairs**,
Opus judge both orders, ~$5 spend. Two artifacts: `eval-artifacts/{v17-raw-matched,v17-rewrite-matched}.json`.

## Result — the rewrite buys ZERO pairwise conversions

| variant (matched, vs gold) | W/T/L | win+tie | songs success |
|---|---|---|---|
| v17 raw | **0 / 0 / 27** | **0%** | 0/9 |
| v17 + rewrite | **0 / 0 / 27** | **0%** | 0/9 |

The rewrite drove tier1 HIGH → 0 on nearly every read (a few residuals: one motion-sickness read
5→5, the no-sex-for-ben / beautiful-things `participial` false-positive →1) and **converted not one
loss to a tie**. This REPRODUCES the established v17-raw flash floor (0/27, `v17-base.json`) and proves
the rewrite's effect on the pairwise-vs-gold metric is **nil**. The register tells were never why v17
loses to gold.

## Why gold wins (judge rationales) — three gap classes, only one is register

- **(a) Residual register the rewrite did not catch** — because it is MEDIUM or UNGATED, outside the
  HIGH set the rewrite targets: **puffery** ("profound anxiety," "profound terror" — `profound` is a
  *medium* rule, untouched), **data-speak** ("low energy and valence" — no tier1 rule at all), and
  **book-report openers tier1 misses** ("The song grapples with," "The song is a public trial" — the
  `book-report-opener` list only has "This song is," not "The song…"). Fixable by broadening the
  rewrite's target set + the tier1 lists — but not the main event.
- **(b) Depth / specific noticing the rewrite STRUCTURALLY cannot add** — gold notices: "in a band
  the year she was born," "church camp," the "one, two, three, freeze" drop, "The regret does not
  leave. It becomes a vow," "silence as the grief he allows." A surgical register rewrite rephrases;
  it cannot invent insight or surface a detail the draft never had.
- **(c) Correctness / grounding errors the rewrite faithfully PRESERVES** — v17 misreads
  pink-pony-club as "a Midwest hometown" (it is Tennessee/the South), invents "a bell for help that no
  one answers" on as-it-was, asserts a wrong "reggaeton beat" on dtmf. These are generation defects;
  the rewrite carries them through unchanged.

# READINESS CALL — CORRECTED to NO-GO vs the gold bar (supersedes Round-3's "conditional GO")

My Round-3 "conditional GO" was premised on the pairwise being likely to convert. **It does not — 0/54,
confirmed by the program's official arbiter.** Correcting the call honestly:

- **Against the optimization contract (tie/win the majority vs gold): NO-GO.** Neither v17 nor
  v17+rewrite ties a single gold across 54 pairs. The rewrite is a real, content-safe engineering
  artifact (cleans tier1, preserves grounding — proven), but it does **not** close the gap to gold,
  because the gap is depth + correctness (b, c), not register. This re-confirms, now against the paid
  judge, the rounds 1–2 diagnosis. **v17 prompt stays converged; do not reopen it.**
- **What the rewrite IS good for is a different question this run did NOT test:** is v17+rewrite better
  than **v13 (current prod)**? The free ship check (Round 3) said yes on cleanliness + grounding — but
  the judge was never asked v17+rewrite-vs-v13 head-to-head, and the (c) rationales surface real v17
  misread/data-speak risks that temper it. **If the goal is "upgrade v13," the decision-relevant test
  is v17+rewrite vs v13 directly** (≈$3–4, n=3×9) — NOT vs gold. Recommended before any cutover, but
  not run here (separate authorization).
- **If anyone still wants to chase the gold bar** (out of scope per "don't grind"): the only levers
  left are non-register — add insight/correctness at generation (gold-dense few-shot, fine-tune, or a
  stronger model: pro hit the ceiling at 17%/1-of-8, length-driven), plus broaden the rewrite to (a)
  medium+ungated tells. None is a prompt edit; all were already flagged as the heavy lifts.

**Bottom line:** the rewrite pass works exactly as designed and is the right tool for "ship clean,
grounded reads" — but the paid arbiter is unambiguous that it does not make v17 rival the golds. The
honest program verdict is **NO-GO on matching gold**; the live product decision (upgrade v13?) is a
separate, cheaper head-to-head that remains open.

<!-- next rows below -->
