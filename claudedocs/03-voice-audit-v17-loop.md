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
- `lyrical-v17.ts` exists and is registered; `ACTIVE_LYRICAL_VERSION` stays `"13"`. **But it is v16
  + two slots, NOT a from-the-principles rewrite** — see the gap note in Part A.
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
- [ ] **v17 from the principles.** The gap-list closure in Part A (global grounding rule GRD-1…9
  stated in-prompt, specificity SPC-1 made loud, the editorial-only principles) was not authored.
  Either do it here, or let the Phase-4 loop evolve v17 toward it.
- [ ] **Re-validate the 9 golds against v17's own instructions** (Part A, final paragraph).
- [ ] **The full one-command scorecard** (Part B): the scoreboard does pairwise-vs-gold + tier1 +
  stats only. It does NOT run the 8 pointwise judges, per-judge pass-rates, or the aggregated
  qualitative signal Phase 4 depends on. That fusion is unbuilt.
- [ ] **Capture + commit the v17 baseline** (a paid run; Block 1 WP5).

---

## Part A — Author `lyrical-v17.ts`

Source of truth: `hearted-audit-principles.md` + the 9 golds. Use `lyrical-v16.ts` as a
*structural reference* (it already encodes most voice mechanics) but author v17 from the
principles — "start anew" per the user. New `prompts/lyrical-v17.ts`, registered in
`prompts/registry.ts` (do not change `ACTIVE_LYRICAL_VERSION`).

> **Block 1 status:** the registered `lyrical-v17.ts` is currently v16 + the `{example}` /
> `{annotations}` slots only. The from-the-principles authoring and gap-list closure below are
> still owed (or to be evolved by the Phase-4 loop).

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

> **Block 1 status:** built the statistical half of this — `evaluate.ts --out <artifact>` then
> `scoreboard.ts <A> [B]` (pairwise-vs-gold W/T/L, tier1, Wilson CI, paired McNemar, length deltas,
> n=9 caveat, A-vs-B diff). NOT built: a single command, the 8 pointwise judges in the scorecard,
> per-judge pass-rates, or the aggregated qualitative signal. Items 2–3 and 5's qualitative
> aggregation below remain to do.

Today the loop is two manual steps (`regen.ts` then `evaluate.ts`) and the new Phase-2 judges
aren't run on candidates. Build a single orchestrator command — extend `evaluate.ts` or add
`scripts/voice-audit/research.ts` — that, for a `--version`:

1. **Generate** an **odd** number of candidates/song across the 9 gold songs so each song can
   collapse to a majority outcome; use **n=3** for real baseline / variant comparisons.
2. **Tier 1** — `runAllRules()` on each.
3. **Tier 2 pointwise** — the 5 existing + 3 new judges on each candidate.
4. **Pairwise vs gold** — `pairwise.ts`, position-swapped (already double-runs).
5. **Scorecard** — emit one report (to `claudedocs/` or `experiments/`) with, per variant:
   - per-song pairwise **win / tie / loss vs gold** (the optimization target);
   - tier1 high/med totals; tier2 pass-rate per judge (grounding called out);
   - **aggregated qualitative signal** — the recurring pairwise rationales + judge `problems`
     ("what keeps losing"). This is what the orchestrator reads to form its next hypothesis.
   - a **diff vs a named prior variant** (did the last edit help?).

`claudedocs/06-block1-implementation-plan.md` supersedes the older n=2 assumption here: for any
real baseline / variant comparison, use an **odd** run count so no song becomes indeterminate.
Treat even-run histories as legacy fallback only.

Run it once on **v17** to capture the baseline scorecard. Expect v17 to still lose some pairs
(that's the orchestrator's job) — but grounding/specificity should already be visibly better
than the v14/v15 record, or v17's grounding additions aren't landing.

## Done criteria

Status as of Block 1 (2026-06-06): `[x]` done · `[~]` done differently / partial · `[ ]` open.

- [~] `lyrical-v17.ts` registered, ACTIVE unchanged — but v16 + slots, NOT authored from the principles.
- [~] `{annotations}` slot live, fed by the shared >15-vote selector — vote gate documented in the injected block's header, not in the template prose.
- [x] 1–2 golds as worked examples — done as RUNTIME leave-one-out injection, not embedded in the file (avoids leakage).
- [ ] All 9 golds re-validated against v17's own instructions — NOT done.
- [~] Scoreboard built (pairwise + tier1 + Wilson/McNemar/length, two commands) — the 8-judge pointwise + qualitative + diff fusion is NOT built.
- [ ] v17 baseline scorecard captured and committed — NOT done (paid; Block 1 WP5).

## Hand to Phase 4

Append a "Progress so far" block: the v17 baseline numbers (pairwise W/T/L per song, tier1,
judge pass-rates), the dominant failure mode the scorecard surfaced, the exact scoreboard
command + its flags, and which judge's verdicts you trust least (from Phase 2).
