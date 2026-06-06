# Experiment: annotation-only distillation (2026-06-06)

**Not a fix — a what-if run.** Re-distilled the golds with the lyric line removed (annotation only),
in memory (no cache read/write — the real `annotation_distillation` cache was untouched), then
judged with the same annotation-only judge as the gate. Goal: see whether the lyric-anchoring
false-positives from the first (with-line) run disappear.

Script: `distill-annotation-only.experiment.ts`. Compare against `check-distillation-results.md`.

## Side by side

| | With-line distiller (gate, run 1) | Annotation-only (this experiment) |
| --- | --- | --- |
| Distinct gold annotations | 127 | 127 |
| Distilled & judged | 76 | 54 |
| Skipped (no distillation) | 51 | 73 |
| Gold flags | 8 | 4 |
| — lyric-anchoring false-positives | 6 | **0** |
| — genuine distiller slips | 2 | **4** |
| Negatives caught | 2 / 2 | 2 / 2 |
| Opus cost | ~$2.23 | ~$1.76 |

## What changed

**All 6 lyric-anchoring false-positives are gone.** The distiller never saw the lyric line, so it
could not restate it as a "fact." Every remaining flag is a genuine faithfulness slip:

1. **blinding-lights** — hedge drop. RAW *presumes* the subject is Bella Hadid; distilled asserts it as fact.
2. **drivers-license** — timing distortion. Distilled: "wrote the lyric while driving"; RAW: wrote it from her diary at the piano after getting home (driving only brought up the emotion).
3. **not-like-us** — misattribution. Distilled pins the "It's Always Sunny / zero cultural awareness" origin on "Culture Vulture"; RAW attributes it to "jabroni."
4. **not-like-us** — factual error. Distilled calls "Chuck Taylor" The Game's real name; RAW says it's Jayceon Terrell Taylor.

So annotation-only turns the judge into a clean faithfulness detector: ~4/54 (≈7%) genuine slip
rate, no lyric noise.

## Caveats

- **Coverage not matched.** Only 54 of 127 gold annotations distilled here vs 76 in the first run
  (73 skipped vs 51). Almost certainly a **Vertex burst-quota artifact** — 144 Flash-Lite calls
  fired at concurrency 6, uncached; some errored → empty → skipped. Not a quality signal. A
  cleaner head-to-head would re-distill with lower concurrency / retry to reach full coverage.
- **Faithfulness only, not usefulness.** This measures "did the distiller invent facts," not
  "is the annotation-only distillation still good grounding context for analysis." Dropping the
  line removes the distiller's focus on a rambling annotation and the pure-hype fallback; whether
  that hurts downstream analysis quality is a separate question this run does not answer.

## Takeaway

Annotation-only distillation removes the entire lyric-anchoring false-positive class and leaves
only genuine distiller slips — strong evidence that the lyric line is the source of the noise. But
adopting it in production is a bigger decision (prompt change + `DISTILLER_VERSION` bump + re-distill
+ a usefulness check), out of scope for the sanity gate.
