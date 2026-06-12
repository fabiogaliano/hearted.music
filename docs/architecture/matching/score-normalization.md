# Score-fusion normalization: which candidate set?

**Date:** 2026-06-10
**Status:** Implemented (pre-prod #1 from `roadmap.md`).
**Scope:** Per-candidate-set score normalization before fusion in
`src/lib/domains/taste/song-matching/`.

## Problem

Fusion combined three signals on incompatible scales:

```
final = embedding·0.5 + audio·0.3 + genre·0.2
```

E5-family cosines cluster in a narrow ~0.75–0.90 band (low-temperature InfoNCE
anisotropy). The old code stretched them with `(sim − 0.5) / 0.5`, still leaving
an effective ~0.5–0.8 range, while audio and genre spanned the full 0–1. So per
unit of weight, audio and genre injected far more *differential* variance than
the nominally-dominant embedding. The 0.50 embedding weight was largely
fictional, and `minScoreThreshold` was a gate in these mongrel units.

The fix (industry consensus — Weaviate `relativeScoreFusion`, Qdrant DBSF,
Elastic linear retriever): **normalize each signal across the candidate set
before the weighted sum.** The non-obvious part is *which* candidate set.

## The decision

There are two candidate-set axes in this pipeline, pointing opposite ways:

- **`matchSong`** ranks playlists **per song** (a matrix **row**); the served
  snapshot rank is per song.
- **`rerankMatches`** regroups **per playlist** and reranks songs (a matrix
  **column**); the cross-encoder's top-N selection compares songs.

**We normalize each signal once across the whole batch matrix**
(all entitled songs × all target playlists, per refresh), not per row or per
column.

### Why batch-global, not per-song or per-playlist

1. **Per-song (row) would break the reranker.** If each song's signals are
   normalized within its own row, the per-playlist reranking stage sorts songs
   by scores that aren't comparable across rows — its top-N selection operates on
   garbage ordering.
2. **Small-set instability.** Users have few playlists (often 3–20). Min-max over
   a handful of candidates makes the best playlist trivially 1.0 and a no-match
   song's best still 1.0; z-score's σ is noisy on tiny samples. The full matrix
   is the largest available sample and statistically stable.
3. **Two-sided beats one-sided.** The speaker-verification literature is the same
   problem (T-norm = query/row side, Z-norm = gallery/column side, S-norm =
   symmetric); symmetric normalization consistently beats either one-sided
   variant. A single matrix-wide per-signal distribution is the cheap stand-in
   for two-sided: comparable along **both** axes at once. (We don't implement
   literal S-norm — that's impostor-calibration machinery for a goal we don't
   have; our goal is just inter-signal scale alignment so the hand weights mean
   what they say.)

The single-song `matchSong` path (onboarding walkthrough, matching-lab) has no
matrix, so it normalizes over just that song's profiles. Signals below
`normalization.minSamples` fall back to the legacy scaling instead: the
embedding keeps its old baseline stretch
(`normalization.fallbackSimilarityBaseline`, baseline→0, 1.0→1.0) and
audio/genre pass through raw, since they already span 0–1. Without the stretch
the fallback path would be *worse* than the pre-normalization code — the raw
~0.75–0.90 band has even less differential range than the old stretched
~0.5–0.8. Those paths don't rerank, so the small-set instability the guard
avoids is harmless there.

## Method

DBSF-style **z-score with 3σ clipping** mapped to [0,1] via `(z+3)/6`, default
over min-max:

- The 3σ clip bounds the narrow-band/outlier behavior of embedding cosines.
- Distribution-aware normalization generalizes to future songs better than
  min-max (each refresh's matrix differs).
- Degenerate sets (σ≈0, single sample) emit the neutral **0.5** — the same
  divide-by-zero convention DBSF uses.

Missing-signal pairs are **excluded** from each signal's stats; feeding a missing
signal's implicit 0 would re-introduce the mis-scaling. Adaptive weight
redistribution (`computeAdaptiveWeights`) is unchanged.

Raw factors are kept on `MatchResult.factors`; the normalized fusion inputs are
exposed as `MatchResult.normalizedFactors`. Learned fusion weights (post-prod)
want the normalized scores; raw keeps the snapshot reproducible.

## Threshold

`minScoreThreshold` moved to normalized-fused units and is now a permissive
placeholder (`0.35`, median ≈ 0.5). The fallback path's legacy stretch keeps
its scores roughly on the old raw scale (where the threshold was 0.3), so the
one permissive value serves both paths until tuning. It **must** be re-tuned
against the
`match_decision` log once the offline replay harness (roadmap #2) exists — that
sequencing ("normalize the fusion, then build the harness") is intentional. RRF
was rejected as the fusion method because it discards audio/genre's real
calibration; it remains the fallback only if normalization proves untrustworthy.

## Key sources

- Weaviate fusion algorithms (`relativeScoreFusion`, default since v1.24).
- Qdrant DBSF (z-score, 3σ clip, 0.5 on degenerate sets).
- Score normalization per-query instability / distribution-aware methods (IR
  data-fusion literature).
- Speaker-verification T-/Z-/S-norm (symmetric beats one-sided).
