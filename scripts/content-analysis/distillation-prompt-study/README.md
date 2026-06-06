# Distillation prompt study (one-off)

Archive of the experiment that decided the annotation distiller should compress from the
**annotation alone**, with the lyric line removed. Outcome shipped in `prompts/distill.ts`
(distiller `v2`). These scripts are not part of the regular test run; they make live LLM calls.

The durable faithfulness gate lives one level up at `../check-distillation.ts`.

## Files

- `distill-prompt-ab.experiment.ts` — the deciding A/B/C: current prompt (V0) vs annotation-only
  (V1) vs line-as-context+guardrail (V2), scored on leakage / invented facts / grounding.
- `distill-annotation-only.experiment.ts` — earlier single-variant probe of annotation-only.
- `distill-prompt-ab-results.md` — final verdict snapshot (**SHIP V1**).
- `distill-annotation-only-results.md` — earlier annotation-only run snapshot.
- `check-distillation-results.md` — first faithfulness-gate run (with-line distiller) that
  surfaced the lyric-leakage problem and motivated the study.

## Outcome

Across all 9 gold docs, annotation-only (V1) beat the current prompt on every axis: 0% lyric
leakage (vs 11%), fewer invented facts (10% vs 18%), and nearly double the grounding score
(1.56 vs 0.84). Showing the distiller the lyric line made it restate the line — which both
leaked lyric facts and crowded out real annotation grounding. Removing the line fixed both.

## Re-running

```
bun scripts/content-analysis/distillation-prompt-study/distill-prompt-ab.experiment.ts [song-key...]
```

Live Vertex (distill) + Opus (judge) calls; in memory, the `annotation_distillation` cache is not
touched. Hits the Vertex per-minute quota — the built-in retry rides it out (slow but free on
throttled calls).
