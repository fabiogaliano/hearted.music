# Lyrics language detection — benchmark findings

**Question:** which lightweight detector should the phase-1 enrichment pass use
to tag a song's language from its lyrics?

**Setup:** 45 songs with real stored lyrics, pulled from prod and stratified by
a fastText pre-pass to span 12 languages (en, es, de, hu, pt, fr, ja, ko, it,
fa, ru, ca, ar). Three pure-/near-pure-JS detectors, all bun-compatible:
`eld` (large n-gram db), `tinyld`, `fastText lid.176.ftz` via `fasttext.wasm.js`.
Gold = majority vote (2-of-3); all 4 disagreements were hand-reviewed and the
two majority-wrong ones corrected in `reviewed-labels.json`.

## Result

| tool      | accuracy | speed/song | ships | notes |
|-----------|----------|-----------|-------|-------|
| **eld**   | **97.8%** (44/45) | ~0.15–0.3 ms | nothing (pure JS) | best accuracy **and** fastest here |
| tinyld    | 95.6% (43/45) | ~0.7–1.1 ms | nothing (pure JS) | 3–5× slower, no accuracy upside |
| fastText  | 93.3% (42/45) | ~0.15–0.3 ms | 917 KB model + wasm init | script-confusion weakness (fa→ar) |

## What the numbers actually mean

- **At full-lyric length all three are near-ceiling.** 41/45 (91%) were
  unanimous. The accuracy spread is *2 songs wide* on n=45 — within noise, not
  statistically separable. Treat "all three are >93% on whole lyrics" as the
  real headline, not the exact ranking.
- **The signal is entirely in the 4 disagreements**, all genuinely hard:
  - **ROSALÍA – Divinize** → Catalan with English lines. *Only fastText got `ca`*;
    eld said `en`, tinyld said `fr`.
  - **Thievery Corporation – Depth Of My Soul** → English verses with
    parenthetical French translations (true bilingual). eld=`en` (matrix lang)
    is the better call; tinyld/fastText said `fr`.
  - **Hiatus – Empress** → Persian in Arabic script. fastText said `ar`
    (script confusion); eld/tinyld got `fa`.
  - **Vybz Kartel – Yuh Love** → Jamaican Patois (English-lexified). fastText
    said `it`; eld/tinyld got `en`.
- **Speed is a non-factor at this scale.** Even the slowest does ~1k songs/sec
  single-threaded; 45 songs detect in <50 ms total. Pick on fit, not speed.

## Recommendation: `eld`

The textbook prior favored fastText (best on *short* text, 176 langs), but that
edge doesn't materialize on whole lyrics — and it costs a 917 KB model asset +
wasm init, plus the shared-script weakness (fa→ar). For the phase-1 pass `eld`
is the pragmatic winner: top accuracy here, fastest tier, **zero deps and no
model file to ship in the worker image**, and it exposes `getScores()` +
`isReliable()` for the confidence threshold and primary/secondary handling.

Reach for fastText later only if we extend detection to **very short text**
(titles/artist only, where lyrics are missing) or need **broader language
coverage** than eld's ~60.

## Caveats

- n=45; gold is partly tool-derived (consensus songs are correct by
  construction). The ranking is directional, not significant. The disagreement
  review is the trustworthy part.
- Known hard classes confirmed: code-switching (Divinize, Depth Of My Soul),
  creoles (Patois), and shared-script languages (Persian/Arabic). These argue
  for storing **confidence + an optional secondary language**, not just a single
  label.

## Reproduce

```bash
# 1. refresh the pool (read-only prod)
bun run prod:sql -f scripts/language-lab/pull-lyrics.sql --json > scripts/language-lab/lyrics-pool.json
# 2. run benchmark (writes results.json, disagreements.csv, report.md)
bun scripts/language-lab/benchmark.ts
# 3. hand-label any 3-way splits in reviewed-labels.json, re-run step 2
```
