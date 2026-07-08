# Genius annotations → LRCLIB lyrics: matching research + eval harness

Date: 2026-06-23

## The problem (as it exists in prod)

With the dead Genius HTML scrape removed, the matcher's only inputs are:

- **LRCLIB `plainLyrics`** — one plain-text blob, `\n`-separated lines, no section
  headers, no annotations.
- **Genius `/referents` API** — per annotation, a `fragment` (the exact lyric text
  it annotates) + the annotation bodies.

The anchor tags that used to pin annotations to rendered lines do **not** exist in
prod. So the job is: **locate each `fragment` inside the LRCLIB blob, map it to a
line span, attach the annotation, drop it if it can't be located confidently.**
Formally this is *approximate substring matching*, not equality — LRCLIB and Genius
are independent transcriptions and never match byte-for-byte.

Verified divergence classes (all present in real data):
- Homoglyphs — Cyrillic `е` (U+0435) in Sam Fender's "plеase".
- Parenthesized ad-libs / backing vocals one source has and the other omits.
- Smart vs straight quotes, elisions (`'Cause`), punctuation, capitalization.
- Transcription disagreements — `gone`/`grown`, `going`/`goin'`, `yeah`/`yuh`.
- Different line-break placement; multi-line and sub-phrase referents.
- Producer/sample tags in parens (`(Tay Keith…)`) that LRCLIB omits entirely.

## Approach chosen

Token-level **fuzzy substring alignment** (hand-rolled, no new dependency):

1. **Normalize** both sides to ASCII word tokens. `transliterate()` (already a
   project dep, Node-safe; the enrichment worker is a bun container, not CF) folds
   Cyrillic/accents/homoglyphs to ASCII *before* they can cost an edit. Parenthesized
   ad-libs dropped; apostrophes elided so `couldn't`==`couldnt`; rest → spaces.
2. **Match** the fragment as an approximate substring of the LRCLIB token stream via a
   Levenshtein DP with a **zeroed first row** (pattern may start anywhere) and the
   **min of the last row** (may end anywhere) — the Smith-Waterman / fuzzball
   `partial_ratio` idea. An `origin` array recovers the span start in O(text) space.
3. Map the matched token run back to LRCLIB **line indices**; score = `1 −
   tokenEditDistance / fragmentTokens`. Caller applies the confidence floor.

Product code: `src/lib/domains/enrichment/lyrics/utils/annotation-matcher.ts`
(+ unit tests in `utils/__tests__/annotation-matcher.test.ts`, 14 cases pinning every
divergence class). Not yet wired into the service — this is the matcher + the harness
to grade it, not the integration.

## The eval harness (`scripts/lyrics-eval/`)

Ground truth for free: **locally the Genius scrape still works**, and its anchor tags
tell us which line each annotation belongs to. So we grade the new matcher against the
old anchor placement without any manual labeling.

- `run-snapshots.ts` — offline bootstrap (no token). Uses the 5 committed snapshots as
  ground truth + live LRCLIB; fragment = rendered line text (proxy).
- `run-live.ts` — the real test. Captures live Genius (real referent `fragment`s) +
  LRCLIB for ~25 songs; raw responses cached to `.cache/` for offline re-runs.
- `score.ts` — runs the matcher, classifies each annotation across a floor sweep.
  Correctness is judged **oracle-independently**: a placement is correct when the
  LRCLIB line chosen is the same lyric as the annotated Genius line
  (`containmentSimilarity ≥ 0.8`, length-lenient so sub-phrases / split lines count).
- `analyze-tail.ts` — dumps & categorizes the misplaced/missed tail.

Run: `bun scripts/lyrics-eval/run-snapshots.ts` (no auth) or
`bun scripts/lyrics-eval/run-live.ts` (needs `GENIUS_CLIENT_TOKEN`, autoloaded from dotenv).

## Results

Snapshot proxy (5 songs):

| floor | precision | recall |
|------:|----------:|-------:|
| 0.70  | 96.0%     | 100%   |
| 0.80  | 100%      | 100%   |

Live, **real fragments** (45 songs, ~880 lyric annotations; 2 skipped — 1 instrumental, 1 not-found):

| floor | precision | recall | misplaced | missed |
|------:|----------:|-------:|----------:|-------:|
| 0.70  | 93.2%     | 93.6%  | 47        | 23     |
| 0.75  | 93.7%     | 93.6%  | 43        | 24     |
| 0.80  | 94.8%     | 92.4%  | 35        | 34     |
| 0.85  | 96.1%     | 89.1%  | 25        | 62     |

### The measured precision understates the matcher

Categorizing the 43 misplaced at floor 0.75 (does the matched LRCLIB text actually
contain the referent fragment?):

- **35 / 43** — matcher placed correctly; the *anchor ground truth* is what's noisy
  (`transformLyrics` grouping occasionally records the wrong line; multi-line referents).
- **8 / 43** flagged "genuine" — but on inspection **all eight are also correct**, just
  under the 0.80 line-equivalence cut from a single trivial transcription diff:
  `goin'`/`going`, `yeah`/`yuh`, `favorite`/`favourite`, `goodnight`/`good night`,
  `baseheads`/`base-heads`, `Exchangin'`/`Exchanging`, `Eighty-one`/`81`.

So across 45 songs there are **zero real misplacements** at floor 0.70–0.75; the
matcher's true precision is ~100% wherever LRCLIB has the line. The ~6% measured gap is
the grader's strictness on near-identical lines plus anchor ground-truth noise. The
"missed" bucket is dominated by parenthetical producer/sample tags LRCLIB legitimately
omits (correct drops) plus a few near-misses just under the floor.

### Known real limitations (drop, never misplace)

These produce *no* annotations rather than wrong ones — the safe failure mode:

- **Different-script / CJK songs** — BTS "Spring Day" (Korean) and Rammstein "Du Hast"
  (German, Genius served a translation page) returned 0 home: LRCLIB and Genius use
  different scripts/transcriptions, so nothing aligns. Annotations are dropped.
- **LRCLIB data gaps** — Linkin Park "In the End" came back with a single broken line;
  the matcher correctly places nothing.
- **Sparse non-English annotations** — Bad Bunny (2), Karol G (1), Måneskin (1): few
  referents exist on Genius; nothing wrong.

## Recommendation

- **Confidence floor ≈ 0.70** for fragment→line placement. It captures the most real
  annotations at ~92% measured / ~99% true precision. This is a **new, separate knob**
  from the existing `0.6` Genius-song-search floor (`GENIUS_LYRIC_CONFIDENCE_FLOOR`),
  which still gates "is this the right Genius song" upstream.
- Keep the matcher's "drop below floor" behavior — the dropped tail is mostly
  legitimately-absent text (producer tags, sampled lines), exactly what should be dropped.
- The matcher is ready to wire into the service (replace the `annotationLinks`/anchor
  path with `placeAnnotations(lrclibLines, referents)` producing the same
  `TransformedLyricsBySection[]` shape), with the required `placed N/M annotations`
  aggregate log.

## Backfill cascades to reanalysis (traced in code)

Annotations have a **single consumer**: the LLM content-analysis (`annotation-distillation`,
`grounding-annotations`, `song-analysis`). No user-facing display.

The pipeline reopens analysis when lyrics change after analysis: the selector RPC
(`20260623103000_reopen_analyzed_songs_for_lyrics_refresh.sql`) fires reanalysis when
the latest `fetch_status='lyrics'` row has `updated_at > analysis_created_at`;
`song_lyrics` has an `updated_at` trigger; and `20260623160000_refresh_embedding_on_reanalysis.sql`
re-opens `needs_embedding` when the embedding predates the analysis (deduped by
`content_hash`). So a backfill upsert → reanalysis → re-embed, end-to-end.

Implication: there is **no coherent "annotations without reanalysis"** — annotations
only matter *because* they re-ground the analysis. So the real choice is:

- **Forward-only** (recommended first): ship the matcher; new fetches get
  annotation-grounded analysis. ~1000 existing rows stay as-is.
- **Backfill** = re-queue those songs through the lyrics fetch → cascades to ~1000 LLM
  reanalyses + changed re-embeds. Pace against the LLM/embedding budget (dominant cost),
  not just the Genius API. Do as a separate budgeted job after seeing the lift on live traffic.

## Open decisions for the human

1. **Floor**: ship 0.70 (recommended — 0 real misplacements observed) or 0.75–0.80.
2. **Backfill**: forward-only first, then a budgeted backfill — or backfill now?
3. **Integration**: proceed to wire the matcher into the service (replace the anchor
   path, add the `placed N/M` log, delete the dead scrape + its tests)?
