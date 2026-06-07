# Handoff — Phase 3: Author v17 + wire the research loop

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
`claudedocs/hearted-read-spec.md` (§6 = the v17 gap list), and both prior "Progress so far"
blocks (Phase 1's annotation utility, Phase 2's judges + their trust boundaries).

Two parts: **A** authors the first real candidate prompt (the centerpiece creative act),
**B** builds the one-command scoreboard the orchestrator will live in. Do NOT flip
`ACTIVE_LYRICAL_VERSION` — prod cutover is out of scope.

---

## Status after Block 1 (2026-06-06)

`claudedocs/06-block1-implementation-plan.md` (the eval-hardening block) was executed and partly
overtakes this handoff. What it actually built vs what this doc still asks for:

**Done (some of it differently than written below):**
- `lyrical-v17.ts` exists and is registered; `ACTIVE_LYRICAL_VERSION` stays `"13"`. It has since
  been authored from the principles and revised (2026-06-06) — see "Status after v17 revision."
- `{example}` and `{annotations}` are RUNTIME-injected (regen.ts), not baked into the file:
  `{example}` = leave-one-out few-shot from the pool [not-like-us, pink-pony-club, motion-sickness]
  via `renderExemplarBlock`; `{annotations}` = the song's own >15-vote block via the shared selector
  (`grounding-annotations.ts` → `renderAnnotationsBlockForPrompt`). `song-analysis.ts` accepts
  prebuilt blocks but prod (v13) does not use them yet.
- The eval is now a **two-command** flow: `evaluate.ts --out <artifact>` persists an `EvalArtifact`
  (per-run pairwise-vs-gold verdict + tier1 + word counts); `scoreboard.ts` reads 1–2 artifacts and
  prints marginal Wilson CI, paired McNemar mid-p, per-song W/T/L, length deltas, and the n=9
  caveat. Stats live in `stats.ts` (`wilsonInterval`, `mcnemarMidP`).
- All 8 tier-2 judges now emit rationale/evidence BEFORE the verdict boolean.
- Grounding judge is **cite-or-fail** (`supporting_evidence` required on a pass); a calibration
  harness (`grounding-calibration.ts`) + subtle-negative fixtures (`fixtures/grounding-negatives.ts`)
  exist (paid Opus run, not yet executed).
- `golds` tier added to regen; `experiments/changelog.md` is the append-only variant log.

**Remaining from this Phase 3 (still owed — NOT done by Block 1):**
- [x] **Re-validate the 9 golds against v17's own instructions** (Part A, final paragraph) — done
  2026-06-06, documented in `claudedocs/07-v17-gold-revalidation.md`. The caps held; seven non-cap
  rules the golds broke were softened (fragment cap, image over-target, phrase-not-sentence, lines
  no-repeat, take backstory-tense, plus self-reference and comma-splice clarifications). v17 edited.
- [~] **The scorecard fusion** (Part B §5): `evaluate.ts --pointwise` runs the 8 pointwise judges
  per candidate and persists their findings plus the two swapped pairwise rationales into the
  artifact; `scoreboard.ts` turns those into per-judge pass-rates (grounding called out), the "what
  keeps losing" digest (recurring judge evidence + non-winning rationales), and a per-judge A→B
  pass-rate diff. Aggregation is pure and unit-tested in `tier2-aggregate.ts`. What remains is
  folding the two-command flow (evaluate → scoreboard) behind a single command.
- [ ] **Capture + commit the v17 baseline** (a paid run; Block 1 WP5).

## Status after v17 revision (2026-06-06)

The registered `lyrical-v17.ts` is **authored from the principles** (Part A's gap list is closed in
the file) and has had a research-grounded revision pass on top.

Revision pass (left unstaged):
- **Gemini 2.5 Flash prompting researched and applied:** critical rules lead with the positive
  action (Gemini follows "do X" more reliably than a bare "never Y"); the grounding gate is
  restated right after the lyrics/annotations (long-context recency); the song is fenced under a
  `THE SONG TO ANALYZE` header so its facts can't blur with the worked examples.
- **Prompt prohibitions aligned to the tier1 gates** they never named: `hedging` ("seems to",
  "it's worth noting"), `academic-register` ("explores themes of", "delves into"), `ai-vocabulary`
  ("tapestry", "interplay", "nuanced").
- **Internal contradictions fixed:** the comma+`-ing` example whose "fix" went passive ("the line
  is drawn") broke SFT-2 — now keeps the actor active and shows the recast, not only the chop; the
  "fragment" examples were actually full sentences; the lens self-test used "this song" (banned);
  `herated.music` → `hearted.music`.
- A flagged participial-closure-vs-`image` conflict is a **false alarm** (the rule needs a terminal
  `.!?`; the period-less `image` never matches), so the image's comma allowance stands.
- `bun run typecheck` clean; the seven runtime placeholders intact (one each in the body).

**Still owed (untouched by this pass):** the captured v17 baseline scorecard (paid; Block 1 WP5).
(The gold-by-gold re-validation that was owed here is now done — see `claudedocs/07-v17-gold-revalidation.md`
and the "Status after gold re-validation" block below.)

## Status after gold re-validation (2026-06-06)

The owed gold-by-gold pass is done and documented in `claudedocs/07-v17-gold-revalidation.md`. All
nine golds were read rule-by-rule against the revised v17. The caps the header comment already
claimed (lens/image word counts, take length, tension = 2 words, arc 2–4 beats, lines 1–5, texture
sentence count) all held — including the documented over-cap flexes. The new findings were all
**non-cap** rules the golds broke, softened in `lyrical-v17.ts` (golds are truth):

- **Fragment cap** ("at most one per field") — broken by stacked fragments in arc scenes
  (blinding-lights, dtmf) and as-it-was's quoted take close. Now allows deliberate stacked
  fragments; the arc-scene spec was also loosened from "complete sentences"; quoted-lyric fragments
  don't count.
- **Image over-target** — only allowed a "felt span / journey"; as-it-was's 9-word image is a bare
  heard line. Now admits a bare heard line too.
- **Phrase-not-sentence** vs the heard-line blessing — not-like-us's "psst. i see dead people" is a
  quoted sentence. Now exempts a quoted heard line.
- **Lines no-repeat** vs "end the take on the song's words" (an internal v17 contradiction) —
  as-it-was and not-like-us put the same signature line in take and lines. Now the signature line
  may appear as the exact pull-quote even when a field lands on it.
- **Take present-tense** — golds open with past-tense backstory. Now allowed for genuine backstory.
- Two preventive clarifications: the self-reference ban carves out the recording's own gesture
  (dtmf's "in the song" = the music pausing for the photo), and "don't chain them with commas" is
  scoped to comma splices, not `, and`/`, but` coordination.

`bun run typecheck` clean; the seven runtime placeholders intact. Left unstaged with the prior
revision pass. **Next:** the captured v17 baseline (paid).

---

## Part A — Author `lyrical-v17.ts`

Source of truth: `hearted-audit-principles.md` + the 9 golds. Use `lyrical-v16.ts` as a
*structural reference* (it already encodes most voice mechanics) but author v17 from the
principles — "start anew" per the user. New `prompts/lyrical-v17.ts`, registered in
`prompts/registry.ts` (do not change `ACTIVE_LYRICAL_VERSION`).

> **Status:** done — `lyrical-v17.ts` is authored from the principles and revised 2026-06-06; the
> gap list below is closed in the file and kept here as the spec it was authored against. See
> "Status after v17 revision."

Close the v17 gap list (spec §6, priority-ordered). The high-leverage additions:

1. **Global grounding rule (GRD-1…9).** Every word of every field traces to a heard lyric or
   a high-voted (>15) annotation — except `texture` (audio features). State the honest reflex
   (GRD-7): if a claim can't survive "is that in the lyrics?", cut it. This is the rule that
   v16 only applies to texture today.
2. **`{annotations}` slot (GRD-9 / LIN-9).** Add the template slot and document the vote gate
   inside the prompt: annotations with `votes_total > 15` are valid grounding (incl.
   real-person biography per GRD-6); ≤15 are ignored. Use them to *find lines* (LIN-9).
   Consume the Phase-1 utility when assembling the prompt in `regen.ts`/`song-analysis.ts`.
3. **Worked example (INT-4).** Embed 1–2 golds as in-prompt few-shot — your eval found "the
   reliable unlock is the golds themselves," and v14/v15 lost on specificity. Suggested:
   Not Like Us (specificity / exact named detail) + Pink Pony Club (two-act + the unspoken
   queer reading, lens stays poetic while image/take carry the content). Show the full read.
4. **Specificity (SPC-1).** "The exact named detail, never the euphemism" — the frontier that
   beat v14/v15. Make this loud.
5. The mechanical bans now gated in tier1 (structural names, mood width) plus the editorial-
   only principles that have no judge: subject-is-actor (SFT-2), no aphoristic kicker (SFT-1),
   vary openers (SFT-3), strengthen the recap ban (ARC-7), image discipline / one grounded
   felt moment (IMG-2/3), foreign-language cultural lead (TYP-2), tension weight (TEN-3),
   lines ordered by song position (LIN-3), stitch + present-moment + no-bow (ARC-10/11/12).

Then **re-validate the golds against v17's own rules**: read each gold and confirm it would
satisfy every instruction you wrote. If a gold violates an instruction, the instruction is
wrong (golds are truth) — soften it. v17 must be a prompt the golds could have been written under.

## Part B — Wire the research loop (one command)

> **Status:** the loop is a two-command flow. `evaluate.ts --out <artifact> [--pointwise]` persists
> per-run pairwise-vs-gold verdicts, tier1, word counts, the swapped pairwise rationales, and — under
> `--pointwise` — the 8 pointwise judges per candidate. `scoreboard.ts <A> [B]` prints marginal
> Wilson CI, paired McNemar mid-p, per-song W/T/L, length deltas, the n=9 caveat, per-judge
> pass-rates, the "what keeps losing" digest, and a per-judge A→B diff (aggregation in
> `tier2-aggregate.ts`). Steps 2–5 below are covered across these two commands; step 1 (odd-count
> generation) is regen.ts's. What remains is folding them behind the single command.

The single orchestrator command is what's left to build — but build it AFTER the v17 baseline, not
before. The baseline is a one-time paid run the current commands already cover, and that run is what
reveals the wrapper's right defaults; its payoff lands in Phase 4, where the loop repeats and the
odd-count rule is easy to fumble by hand. When built (`scripts/voice-audit/research.ts` or an
`evaluate.ts` mode), it should unify only the PAID steps — generate + judge + persist — and then hand
the artifact to `scoreboard.ts`; it must NOT re-implement rendering, because the paid/free split is
exactly what lets you re-render and re-diff a saved artifact for free. For a `--version` it runs:

1. **Generate** an **odd** number of candidates/song across the 9 gold songs so each song can
   collapse to a majority outcome; use **n=3** for real baseline / variant comparisons.
2. **Tier 1** — `runAllRules()` on each.
3. **Tier 2 pointwise** — the 5 existing + 3 new judges on each candidate.
4. **Pairwise vs gold** — `pairwise.ts`, position-swapped (already double-runs).
5. **Scorecard** — persist the `EvalArtifact` and hand it to `scoreboard.ts` (keep it
   re-renderable; don't re-emit the report). `scoreboard.ts` already prints, per variant:
   - per-song pairwise **win / tie / loss vs gold** (the optimization target);
   - tier1 high/med totals; tier2 pass-rate per judge (grounding called out);
   - **aggregated qualitative signal** — the recurring pairwise rationales + judge `problems`
     ("what keeps losing"). This is what the orchestrator reads to form its next hypothesis.
   - a **diff vs a named prior variant** (did the last edit help?).

`claudedocs/06-block1-implementation-plan.md` supersedes the older n=2 assumption here: for any
real baseline / variant comparison, use an **odd** run count so no song becomes indeterminate.
Treat even-run histories as legacy fallback only. The wrapper should bake odd n=3 + `--pointwise`
in rather than leave them to flags a hand-run could forget — that is half its reason to exist.

### Preflight before the paid baseline (cheap smoke)

WP5 is paid and should not double as the first integration test. The unit tests check the
aggregation math in isolation; they do not prove `evaluate → write → read → scoreboard` runs
together. Before burning the baseline, run the free smoke — `scripts/voice-audit/preflight.ts` —
which exercises the real binaries with no judge calls:

```
bun scripts/voice-audit/regen.ts --version 17 --songs golds --runs 3 --temperature 0.3   # ODD --runs; 'golds' = the 9 canonical baseline songs ('fast' = 2 of them for a cheaper wiring smoke)
bun scripts/voice-audit/preflight.ts --version 17        # free: dry-run path + artifact write→read→scoreboard round-trip
# preflight prints the PAID 1-song check to run last:
bun scripts/voice-audit/evaluate.ts --version 17 --songs not-like-us --limit 1 --pointwise --out eval-artifacts/preflight-1song.json
bun scripts/voice-audit/scoreboard.ts eval-artifacts/preflight-1song.json
```

Preflight exits non-zero if either free check fails (e.g. "no matching runs" → you forgot to
`regen.ts` first). Only after the free checks pass **and** the 1-song `--pointwise` run writes a
readable scorecard is the full WP5 baseline safe to burn.

Capture the v17 baseline now with the current commands — `regen.ts` → `evaluate.ts --pointwise
--out <artifact>` → `scoreboard.ts <artifact>`; the wrapper is not a prerequisite for it. Expect
v17 to still lose some pairs (that's the loop's job) — but grounding/specificity should already be
visibly better than the v14/v15 record, or v17's grounding additions aren't landing.

## Done criteria

Status as of Block 1 (2026-06-06): `[x]` done · `[~]` done differently / partial · `[ ]` open.

- [x] `lyrical-v17.ts` registered, ACTIVE unchanged — authored from the principles + revised 2026-06-06.
- [~] `{annotations}` slot live, fed by the shared >15-vote selector — vote gate documented in the injected block's header, not in the template prose.
- [x] 1–2 golds as worked examples — done as RUNTIME leave-one-out injection, not embedded in the file (avoids leakage).
- [x] All 9 golds re-validated against v17's own instructions — done 2026-06-06; caps held, seven non-cap rules softened. See `claudedocs/07-v17-gold-revalidation.md`.
- [~] Scoreboard built — `scoreboard.ts` reads the eval artifact into pairwise W/T/L + tier1 + Wilson/McNemar/length and, when `--pointwise` data is present, per-judge pass-rates + the qualitative "what keeps losing" digest + a per-judge A→B diff (`tier2-aggregate.ts`). Two commands (evaluate → scoreboard); the single-command wrapper is what remains.
- [ ] v17 baseline scorecard captured and committed — NOT done (paid; Block 1 WP5).

## Hand to Phase 4

Append a "Progress so far" block: the v17 baseline numbers (pairwise W/T/L per song, tier1,
judge pass-rates), the dominant failure mode the scorecard surfaced, the exact scoreboard
command + its flags, and which judge's verdicts you trust least (from Phase 2).

### Progress so far — v17 + v18 baselines captured (2026-06-07)

Both baselines are generated, judged, and persisted (n=3/song, t0.3, all 9 golds; left
uncommitted in the working tree per the run brief). Artifacts:
`scripts/voice-audit/eval-artifacts/v17-base.json` and `…/v18-regrouped-base.json`
(v18 = `lyrical-v17-regrouped.ts`, registered "18"). `ACTIVE_LYRICAL_VERSION` untouched ("13").

**Headline: both lose every gold.** v17 and v18 each go **0 win / 0 tie / 27 loss** across the
27 candidates → **0/9 songs** win-or-tie (Wilson95 [0.00, 0.30] each). Every song is
`(LOSS,LOSS,LOSS)`. So v17's grounding/specificity rebuild did NOT translate into pairwise wins
vs gold yet — but it did close the grounding gap that sank v14/v15 (grounding 100%, below), so
the loss has moved to a different, nameable cause.

**Per-song pairwise W/T/L vs gold (identical pattern both versions):**

| song | v17 | v18 |
|---|---|---|
| dtmf | L,L,L | L,L,L |
| beautiful-things | L,L,L | L,L,L |
| drivers-license | L,L,L | L,L,L |
| blinding-lights | L,L,L | L,L,L |
| motion-sickness | L,L,L | L,L,L |
| pink-pony-club | L,L,L | L,L,L |
| no-sex-for-ben | L,L,L | L,L,L |
| not-like-us | L,L,L | L,L,L |
| as-it-was | L,L,L | L,L,L |

**Tier-1 means (over 27 candidates):** v17 = **3.67 high / 0.85 medium**; v18 = **3.48 high /
0.59 medium**. (Tier-1 is the guardrail, not the target — both pass it broadly yet lose every
pair, which is the whole reason the pairwise judge is the optimization signal.)

**Tier-2 pointwise pass-rates (27 candidates each):**

| judge | v17 | v18 | Δ (B−A) |
|---|---|---|---|
| grounding (Opus, priority-1) | **100%** | **100%** | +0pt |
| register-specificity | 93%¹ | 100% | +7pt |
| abstract-noun-trap | 100% | 100% | +0pt |
| **essayistic-register** | **0%** | **7%** | +7pt |
| arc-narrative | 100% | 96% | −4pt |
| lens-coherence | 100% | 96% | −4pt |
| redundancy | 74% | **56%** | −19pt |
| voice-softness | 100% | 93% | −7pt |

**Dominant failure mode — essayistic / book-report register.** `essayistic-register` fails on
**all 27** v17 candidates and **25/27** v18 candidates, and the Opus pairwise rationales say the
same thing independently: the candidate "leans academic / book-report framing / puffery" while
gold "reads like a friend." Recurring tells from the "what keeps losing" digest: *"The song lives
in…", "finds its rhythm in the space between", "a defiant celebration of her survival", "the
ghost of what he lost is always dancing beside him", "vibrant queer community"* — abstract theme-
summary and appositive puffery instead of a person talking about a song. Gold wins on concrete,
song-specific detail in varied spoken rhythm ("This time he takes the photo.", "One, two, three,
freeze", "jaws on the floor"). **This is the Phase-4 target: kill the essayistic register without
losing the grounding gains.** Secondary: **redundancy** (arc beats re-asserting the take) — and
note v18's regrouping made redundancy *worse* (−19pt), not better.

**Paired comparison (v17 vs v18), McNemar mid-p over songs determinate in both:**
`both success 0 · both fail 9 · A>B b=0 · B>A c=0 · paired n=9 · mid-p = 1.000` → **not
significant; the two are indistinguishable at the optimization target** (both lose everywhere, so
there is zero discordance to test). The judge-diff shows v18's "regrouping" is a wash-to-negative:
+7pt register-specificity / +7pt essayistic (still ~0), but −19pt redundancy, −7pt voice-softness,
−4pt arc, −4pt lens. **No reason to prefer v18 over v17.**

**Exact scoreboard commands used:**
```
bun scripts/voice-audit/scoreboard.ts scripts/voice-audit/eval-artifacts/v17-base.json
bun scripts/voice-audit/scoreboard.ts scripts/voice-audit/eval-artifacts/v18-regrouped-base.json
bun scripts/voice-audit/scoreboard.ts scripts/voice-audit/eval-artifacts/v17-base.json scripts/voice-audit/eval-artifacts/v18-regrouped-base.json
```
(Generation: `regen.ts --version 17|18 --songs golds --runs 3 --temperature 0.3`; eval:
`evaluate.ts --version 17|18 --temperature 0.3 --limit 3 --pointwise --out <artifact>`. Keep
`--limit` ODD and `--temperature 0.3` on every step or runs won't match / a song collapses to
indeterminate.)

**Judge trust (Phase 2 boundary) — trust the 7 Gemini pointwise judges least.** They run on
Gemini 2.5 Flash judging Gemini-generated reads → self-preference bias (eval-hardening doc issue
**B2**). The verdict that decides keep/revert (pairwise vs gold) and the priority-1 grounding
judge both run on **Opus via the `claude` CLI** (cross-family, the trustworthy signal). Here the
pointwise `essayistic-register` happens to *agree* with the independent Opus pairwise rationales,
which corroborates the dominant-failure call — but a future cross-family / PoLL pointwise jury
(B2's fix) would harden the secondary judges (redundancy, voice-softness) that drove the v17→v18
diff. Most-trusted: grounding (Opus, 100%). Least-trusted: the Gemini pointwise cohort.

**Operational notes / caveats for the next run:**
- ¹ v17 `register-specificity` 93% includes **one Gemini judge-error** (a transient "No object
  generated: could not parse the response" on one as-it-was candidate, recorded as a fail). True
  pass-rate is ~96%; it does not touch the pairwise verdict or grounding.
- **Two pipeline fixes were required and are left uncommitted with the artifacts** (no methodology
  change — same model/judges/prompts):
  1. `evaluate.ts` pointwise judges repointed `createLlmService("google")` →
     `"google-vertex")` — the AI Studio key path is out of prepay credits; Vertex (ADC) is the
     billed path generation already uses. Same `gemini-2.5-flash`.
  2. `tier2/claude-cli.ts` `runClaude` now **retries with backoff** (4 attempts) and
     `evaluate.ts` skips a candidate that still throws, instead of aborting. The first full v17
     run died on candidate **27/27** to a one-off `400 Output blocked by content filtering policy`
     on an Opus pairwise call and — because the artifact writes only at the end — discarded all 26
     prior candidates. The re-run with retry completed 27/27 + 27/27, 0 retries needed, 0 skips.
- **Cost:** notional judge cost printed $5.52 (v17) + $6.34 (v18); the Opus CLI calls are
  subscription-covered (notional), so real spend is only the Vertex Gemini generation + pointwise
  (single-digit cents). The split is intentional: Gemini Flash for the 7 pointwise detectors, Opus
  for pairwise + grounding.
