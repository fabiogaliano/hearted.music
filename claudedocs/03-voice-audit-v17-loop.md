# Handoff — Phase 3: Author v17 + wire the research loop

**Read first:** `claudedocs/00-voice-audit-program.md`, `claudedocs/hearted-audit-principles.md`,
`claudedocs/hearted-read-spec.md` (§6 = the v17 gap list), and both prior "Progress so far"
blocks (Phase 1's annotation utility, Phase 2's judges + their trust boundaries).

Two parts: **A** authors the first real candidate prompt (the centerpiece creative act),
**B** builds the one-command scoreboard the orchestrator will live in. Do NOT flip
`ACTIVE_LYRICAL_VERSION` — prod cutover is out of scope.

## Part A — Author `lyrical-v17.ts`

Source of truth: `hearted-audit-principles.md` + the 9 golds. Use `lyrical-v16.ts` as a
*structural reference* (it already encodes most voice mechanics) but author v17 from the
principles — "start anew" per the user. New `prompts/lyrical-v17.ts`, registered in
`prompts/registry.ts` (do not change `ACTIVE_LYRICAL_VERSION`).

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

Today the loop is two manual steps (`regen.ts` then `evaluate.ts`) and the new Phase-2 judges
aren't run on candidates. Build a single orchestrator command — extend `evaluate.ts` or add
`scripts/voice-audit/research.ts` — that, for a `--version`:

1. **Generate** n=2 candidates/song across the 9 gold songs (`regen.ts --runs 2` semantics).
2. **Tier 1** — `runAllRules()` on each.
3. **Tier 2 pointwise** — the 5 existing + 3 new judges on each candidate.
4. **Pairwise vs gold** — `pairwise.ts`, position-swapped (already double-runs).
5. **Scorecard** — emit one report (to `claudedocs/` or `experiments/`) with, per variant:
   - per-song pairwise **win / tie / loss vs gold** (the optimization target);
   - tier1 high/med totals; tier2 pass-rate per judge (grounding called out);
   - **aggregated qualitative signal** — the recurring pairwise rationales + judge `problems`
     ("what keeps losing"). This is what the orchestrator reads to form its next hypothesis.
   - a **diff vs a named prior variant** (did the last edit help?).

Keep n=2 the default (`--limit 2` already is). Plumb an n=3 escalation flag for per-song
tie-breaks but don't make it default.

Run it once on **v17** to capture the baseline scorecard. Expect v17 to still lose some pairs
(that's the orchestrator's job) — but grounding/specificity should already be visibly better
than the v14/v15 record, or v17's grounding additions aren't landing.

## Done criteria

- [ ] `lyrical-v17.ts` authored from the principles, registered (ACTIVE unchanged).
- [ ] `{annotations}` slot live, fed by the Phase-1 utility, vote gate >15 documented in-prompt.
- [ ] 1–2 golds embedded as worked examples.
- [ ] All 9 golds re-validated against v17's own instructions (no instruction a gold violates).
- [ ] One command produces the full scorecard (pairwise + tier1 + 8 judges + qualitative + diff).
- [ ] v17 baseline scorecard captured and committed.

## Hand to Phase 4

Append a "Progress so far" block: the v17 baseline numbers (pairwise W/T/L per song, tier1,
judge pass-rates), the dominant failure mode the scorecard surfaced, the exact scoreboard
command + its flags, and which judge's verdicts you trust least (from Phase 2).
