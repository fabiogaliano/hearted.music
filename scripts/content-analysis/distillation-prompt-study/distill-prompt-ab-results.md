# Final A/B/C: distiller prompt variants (2026-06-06)

Decisive pre-ship experiment for the `prompts/distill.ts` change. Full coverage, all 9 golds.
Script: `distill-prompt-ab.experiment.ts`. In memory (real cache untouched).

## Variants

- **V0** — current production prompt (lyric line shown, no guardrail). Baseline.
- **V1** — annotation-only (no lyric line at all).
- **V2** — keep the line but label it "context, not a fact source" + explicit guardrail.

## Method

127 distinct gold annotations × 3 variants distilled (Flash-Lite via Vertex, retry for quota).
One Opus judge call per annotation scored all three at once (neutral labels S1/S2/S3, order
rotated to cancel position bias), reporting per variant: leak_claims (facts from the lyric line
not in the annotation), invented_claims (facts in neither — genuine slips), grounding_score
(0/1/2), missing_grounding. 126 annotations had all three present and were judged.

## Result (full coverage)

| variant | coverage | leak% | invented% | grounding (mean) | major drops (score 0) |
| --- | --- | --- | --- | --- | --- |
| V0 (current) | 127/127 | 11% | 18% | 0.84 | 34 |
| **V1 (annotation-only)** | 126/127 | **0%** | **10%** | **1.56** | **6** |
| V2 (line + guardrail) | 127/127 | 5% | 16% | 0.98 | 30 |

Judge sanity (catches spliced invention): PASS. Judge errors: 1 (negligible).

**VERDICT: SHIP V1 (annotation-only).** V1 wins on every axis.

## Reading it

- **Leakage:** V1 = 0% vs V0 11%. The per-line log shows V1 never leaks (structurally — it can't
  see the line). V0 leaked on 15 annotations; **V2's guardrail only cut that to 5%** — telling the
  model "the line is context, don't use it" largely failed; it still anchored on the line.
- **Grounding:** V1 = 1.56 vs V0 0.84 — nearly double. And **major grounding drops: V1 = 6 vs
  V0 = 34, V2 = 30.** This is the key, counter-intuitive finding: keeping the line did NOT help
  grounding — it *hurt* it. With the line present, the model spends its 1–3 sentences partly
  restating/anchoring on the lyric, which both leaks and crowds out real annotation facts. Remove
  the line and the model focuses entirely on compressing the annotation → more grounding, fewer
  drops, zero leak.
- **Slips:** V1 = 10% vs V0 18%. Even genuine distortions are fewer annotation-only.
- The grounding-loss worry for annotation-only was wrong: V1 has the FEWEST drops, not the most.

V1's 6 residual drops (real, but rare ~5%) include e.g. not-like-us losing "Karl Malone
impregnated a 13-year-old" (the factual basis for a reference) and drivers-license losing
"swearing as a sign of maturity." Tolerable and far below V0/V2.

## Why V2 (my prior pick) lost

The guardrail approach assumed the leak was a labeling problem ("model didn't know the line was
context"). It wasn't — the model anchors on any line it's shown regardless of instructions. The
only reliable fix is to not show it. V2 ≈ V0 on grounding (0.98 vs 0.84) and still leaked.

## Recommended production change

Change `prompts/distill.ts` to the **annotation-only (V1)** prompt: drop the `lyricLine` argument
and every "what this line means" / hype-fallback reference; compress the annotation alone. Bump
`DISTILLER_VERSION` (v1 → v2) to invalidate the cache, then re-distill (lazy, per-song, cached).

Optional final confidence check (existing infra, not a new experiment): after shipping, run
`voice-audit` on 2–3 songs to confirm no end-to-end analysis regression.
