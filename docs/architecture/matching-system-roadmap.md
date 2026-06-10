# Matching System — Consolidated Research & Roadmap

**Date:** 2026-06-10 (consolidates research passes from 2026-06-06 and 2026-06-09; priorities revised same day after a data audit)
**Status:** Research findings + prioritized plan. **Pre-prod #1 (fusion normalization) and #3 (Qwen3 re-embed + instruct-format fix) implemented 2026-06-10** — see the findings below; the rest is unimplemented. **Priorities revised 2026-06-10:** a data audit found `match_decision` holds **10 decisions on 1 playlist from 1 account** — far below what recall@k/MRR/temporal-split can use. So #6 (decision-log enrichment, the time-sensitive item) moves to the front, #2 is slimmed to a config-diff replay runner, and the full metrics harness is deferred to post-prod, gated on decision volume (see finding #6).
**Scope:** Cheap, modern (2025–2026) improvements to the song→playlist matching pipeline, plus the genre-pills feature. Hard constraint: no self-hosted GPU infra, no expensive per-request LLM calls.

This document supersedes `matching-system-improvements.md` (2026-06-06) and
`matching-deep-analysis-2026-06.md` (2026-06-09). The first was a fan-out web-research pass
with 3-vote adversarial verification (115 claims extracted, most refuted — the kill list is
preserved below). The second re-verified it against the actual code, added fresh research
(fusion practice, embedding/reranker landscape, genre conditioning, cold-start elicitation),
and corrected one stale priority. Where the two disagreed, the code-verified finding wins.

---

## The pipeline today (for reference)

1. **LLM analysis** — Gemini 2.5 Flash (Vertex) → structured JSON "read" of each song
   (lyrical schema v17: image/lens/tension/take/arc/lines/texture; instrumental v3).
2. **Genre enrichment** — Last.fm tags → ~430-genre whitelist, top 3, canonicalized
   (`integrations/lastfm/whitelist.ts`).
3. **Embedding** — analysis fields concatenated → `Qwen/Qwen3-Embedding-0.6B` (DeepInfra),
   MRL-truncated to **512-dim** (client-side slice + L2-renormalize), stored in pgvector with
   HNSW index. Instruct format: queries get `Instruct: …\nQuery: …`, documents go in bare.
   **As of 2026-06-10** — see #2/#3 findings. (was `intfloat/multilingual-e5-large-instruct`
   at 1024-dim with the wrong non-instruct prefixes.)
4. **Playlist profiling** — single **mean centroid** of member embeddings, blended with a
   name+description ("intent") embedding whose weight decays with song count
   (`computeIntentWeight`: base 0.35, ×1.5 with description, floor 0.3/0.15); plus an averaged
   audio-feature centroid + genre distribution (raw counts).
5. **Fusion** — linear weighted: embedding cosine `0.50` + audio similarity `0.30` +
   genre overlap `0.20`. ~~Cosine stretched via `(sim − 0.5) / 0.5`.~~ **As of 2026-06-10**
   each signal is z-score-normalized (3σ-clipped, DBSF-style) across the whole batch matrix
   *before* the weighted sum — the 0.5 stretch is gone, raw cosine is forwarded, missing
   signals are excluded from each signal's stats. Top-K `10`. `minScoreThreshold` is now in
   normalized-fused units (`0.35`, provisional — see #2). Missing signals still redistribute
   weight adaptively. (`song-matching/{normalization,service,config}.ts`)
6. **Caching** — content hash on embeddings, profiles, and match snapshots.
7. **Reranking** — top-50 reranked by `Qwen/Qwen3-Reranker-0.6B` (DeepInfra), blended 70/30
   with the original score. Reranker document is only `"{name} by {artists}. Genres: {g}."`.

**Audio features:** sourced from **ReccoBeats** (free Spotify-parity API), *not* Spotify —
the deprecation migration already happened. Adaptive weights degrade gracefully when missing.
**Cold-start:** empty playlists use a HyDE-style imagined prototype song (Gemini), including
`expected_genres` and a synthetic audio profile.
**Underused data:** per-`(song, playlist)` `added`/`dismissed` decisions (`match_decision`) —
currently only used for exclusion, never for evaluation or learning; Genius annotations with
vote counts.
**Scoring path:** brute-force O(songs × playlists) in TypeScript; the pgvector HNSW indexes
exist but are never queried by matching.

---

## TL;DR — prioritized plan

### Pre-prod (before real users — cheap, compounding)

Rows are in priority order (revised 2026-06-10); the `#` is a stable identifier, kept so
older references and the completed-work notes still resolve.

| # | Item | Cost | Why this order |
|---|---|---|---|
| 1 | ✅ **Batch-matrix score normalization before fusion** (z-score per signal, 3σ-clipped; dropped the 0.5-baseline stretch) — **done 2026-06-10** | ~½ day | Biggest mis-scaling in the system; pure code; makes the weights mean what they say. `minScoreThreshold` now in normalized units (`0.35`) — re-tune via #2. |
| 3 | ✅ **One combined re-embed:** correct instruct format (`Instruct: …\nQuery: …` queries, no prefix documents) + swap to `Qwen3-Embedding-0.6B` at **512-dim** — **done 2026-06-10** | 1 day + re-embed | Prefix fix + model swap done in one pass. Shipped 512 outright (preprod — dropped 1024, no bakeoff) since #2 doesn't exist yet to measure it; 512 stays a free re-decision later via re-truncation. |
| 6 | **Decision-log enrichment:** store rank, factor scores, snapshot id at decision time; optionally ~5% rank jitter for future debiasing | hours | **Pulled ahead of #2 (2026-06-10).** The harness is blocked on data volume; this is what makes the accruing data good. Every decision logged without rank/factor features is permanently degraded eval + training data — impossible to backfill later. |
| 2 | **Slim offline replay runner** over `match_decision`: run the *real* pipeline (fusion + normalization + threshold + reranker, not raw cosine) under a candidate config, diff config A vs B by ranks of added/dismissed | ~½ day | The data-volume-independent core of the harness: a config *regression* tool, not a measurement tool. Re-tunes `minScoreThreshold`, A/Bs #4. Explicitly excludes recall@k/MRR/temporal split/segmentation — at n=10 those produce numbers that look like measurements but aren't (deferred to post-prod #1). Extend `scripts/matching-lab/` from `eval-embedding-sanity.ts`. |
| 4 | **Reranker fixes:** feed analysis text as the document; verify yes/no-logit scoring on DeepInfra; A/B full-rerank vs 70/30 blend via #2 (directional only at current n) | ~1 day | The 30% blend currently rides on a name+genre string while the rich analysis sits unused. |
| 5 | **Genre pills** (design below) | 2–4 days | Strongest cold-start evidence; product-visible; independent of #1–4. |
| 7 | **Hygiene:** ~~delete or implement `vetoThreshold`~~ (deleted 2026-06-10 with #1); fix genre substring matching (canonical exact match + similarity expansion); remove dead fields | hours | Bundle with adjacent work. |

### Post-prod (gated on real usage data)

1. **Full replay-harness metrics** — the deferred remainder of pre-prod #2: headline
   recall@k / MRR, temporal train/test split, segmentation by playlist size (and popularity
   tier). **Gate: ~300–500 decision pairs across multiple playlists/accounts** — below that
   the numbers are noise dressed as measurement (today: 10 decisions, 1 playlist). This is an
   incremental extension of the slim runner, not a rewrite; it's also what finally settles
   the 1024-vs-512 question and the reranker A/Bs properly.
2. **Learned fusion weights** — pairwise logistic regression on normalized factor scores once
   ~300–500 accept/reject pairs exist; LambdaMART only past ~1–5k pairs. Needs #6's logged
   features. (Dismissed tracks as hard negatives is structurally sound — vote 2-1 — but the
   quantified 9–74% HR@1 lift claim was refuted; contrastive fine-tuning only if logistic
   regression plateaus, gated behind the harness.)
3. **Eval discipline** — segment metrics by popularity tier and playlist size (Simpson's
   paradox); treat offline metrics as a filter, not a predictor of online behavior.
4. **ReccoBeats contingency** — free, no SLA, undisclosed rate limits. Watch failure rates;
   fallback ladder: adaptive weight redistribution (already works) → Essentia self-hosted if
   preview audio is available → fold audio character into the Gemini prompt.
   (AcousticBrainz is dead — frozen July 2022, no post-2022 tracks.)
5. **Multi-centroid profiles** — only if the harness shows multi-mood playlists underperform
   (check intra-playlist embedding variance first). 2–3 medoids + max-sim is the cheap
   version (PinnerSage pattern; ComiRec shows +2–8% recall, but only for genuinely
   multi-modal profiles).
6. **pgvector ANN path** — when O(S×P) in-process scoring hurts; the indexes already exist.
7. **Reranker shootout** — zerank-1-small ($0.025/MTok) / voyage-rerank-2.5-lite vs Qwen3,
   measured via the full harness (post-prod #1).

The throughline (revised 2026-06-10): **make the data good before building the measurement.**
Fusion is normalized; next is logging decision-time features (#6) so every decision from here
on is usable, then the slim replay runner (#2) as a config regression tool. The full metrics
harness waits for decision volume — building it today would produce fake measurements, not
real ones.

---

## Confirmed findings

### 1. Score fusion was mis-scaled — the 0.50 embedding weight was largely fictional ✅ FIXED 2026-06-10

E5-family cosine scores cluster in a ~0.75–0.90 band (anisotropy from low-temperature
InfoNCE training). The code stretched with `(sim − 0.5) / 0.5`
(`song-matching/service.ts`, `similarityBaseline: 0.5`), which still left an effective
range of roughly 0.5–0.8 while audio and genre scores spanned the full 0–1. The
nominally-dominant embedding signal had far less *differential* influence than its weight
implied — audio and genre were quietly steering rankings.

Industry consensus (Elastic linear retriever, Weaviate `relativeScoreFusion` — default since
v1.24, Qdrant DBSF): **z-score-normalize each signal across the whole batch matrix (not
per-song — that corrupts the per-playlist reranker), 3σ-clipped, before the weighted sum**.
RRF is the rank-only fallback if normalization can't be trusted, but it discards the
calibration in audio features.

**What shipped:**

- **Dropped the stretch.** `similarityBaseline` deleted; raw cosine forwarded.
- **z-score, 3σ-clipped (DBSF-style)** over min-max — min-max is brittle on the narrow-band
  embedding. Degenerate sets (σ≈0) emit neutral `0.5`. `method` configurable.
- **Normalized across the full song×playlist matrix**, not per-song. Per-song would break
  `rerankMatches` (it regroups by playlist, so row-normalized scores aren't comparable there)
  and is statistically unstable on a user's handful of playlists. Stats recomputed per batch.
- **Missing signals excluded** from each signal's stats; weights still redistribute adaptively.
- **Single-song `matchSong`** (walkthrough/lab) falls back to the legacy stretch below
  `minSamples` — no batch matrix, doesn't rerank.
- **`minScoreThreshold` now in normalized units** (`0.35`, permissive placeholder — re-tune
  via #2).
- **`MatchResult`** keeps raw `factors` + new `normalizedFactors` (the fusion inputs).

`song-matching/{normalization,service,config,types}.ts`; 73 tests pass, `tsgo` clean. Full
rationale + sources in `docs/architecture/score-normalization-direction.md`.

### 2. The E5 instruct prefix is wrong on both sides — fold into the re-embed (vote 3-0) ✅ FIXED 2026-06-10

**What shipped:** the `["query:","passage:"]` prefix enum was replaced with a role enum
`["query","passage"]`; a shared helper (`integrations/embedding/format.ts`) applies the
correct format per role, branching on instruction-tuned: queries →
`Instruct: {task}\nQuery: {text}`, documents → bare text. Wired through both providers
(DeepInfra + local) and every call site. The `isInstructionTuned` flag is now honored, not
just declared. Done together with #3 (one re-embed). Original analysis below.

We run the **instruct** variant but prefix with the **non-instruct** convention. The model
card is explicit: queries must be `Instruct: {task_description}\nQuery: {text}` (not
`query:`), and documents must have **no prefix at all** (not `passage:`). Every embedding in
the system has been computed in a format the model wasn't trained for.

**Where it lives in code (verified):**
- `src/lib/integrations/deepinfra/service.ts:67` — `EmbedPrefixSchema` only allows `query:`/`passage:`.
- `src/lib/integrations/deepinfra/service.ts:170` — passage default applied to all texts.
- `src/lib/domains/enrichment/embeddings/service.ts:152,277` — songs + playlist profiles forced to `passage:`.
- `src/lib/domains/taste/playlist-profiling/intent-expansion.ts:174` — HyDE text uses `passage:`; intent text uses `query:` (`playlist-profiling/service.ts:229`).
- `src/lib/domains/enrichment/embeddings/model-bundle.ts` — `isInstructionTuned` flag exists ("affects query prefixing") but nothing branches on it.

**Source:** <https://huggingface.co/intfloat/multilingual-e5-large-instruct>

### 3. `Qwen3-Embedding-0.6B` is a real drop-in upgrade (vote 3-0) ✅ SHIPPED 2026-06-10

**What shipped:** swapped to `Qwen/Qwen3-Embedding-0.6B`, MRL-truncated to **512-dim**
client-side (slice first 512 + L2-renormalize — deterministic, provider-independent, and
cost-identical since embeddings are priced per *input* token). Migration drops the old e5
vectors and narrows `song_embedding`/`playlist_profile` to `vector(512)`; cache auto-invalidates
via the model-bundle hash (model + dims changed). Production embeds via DeepInfra; the local
dev provider runs the `onnx-community/Qwen3-Embedding-0.6B-ONNX` export with **last-token
pooling** (E5 used mean — a silent correctness trap). Re-embedded 79 songs + reprofiled the
cold-start playlist locally; `tsgo` + 1595 tests green.

**Dimension decision:** shipped 512 outright rather than A/B 1024-vs-512, because (a) #2
doesn't exist to measure it, (b) we're preprod with no quality data, and (c) at 79 songs /
brute-force matching the storage/ANN savings are nil — 512's only live effect now is risk, and
re-deciding later is a free re-truncation, not another re-embed. The directional sanity replay
(`scripts/matching-lab/eval-embedding-sanity.ts`) over the 10 decisions on 1 cold-start
playlist was inconclusive (separation ≈ −0.02 — noise at n=10 against a HyDE-only profile), as
expected; a real verdict still needs the full harness metrics (post-prod #1) + decision
volume. Original analysis below.

Same parameter size as our E5, modestly better on MTEB Multilingual (~64.3 vs ~62–63 —
"meaningful but not dramatic"), and it supports **Matryoshka Representation Learning**
(dims 32–1024) so we can truncate to **512 dims** and roughly halve vector storage + ANN cost
with little quality loss. **MRL truncation is NOT valid on the current E5 model** — its 1024
dims are not nested.

Same vendor we already use (DeepInfra hosts the Qwen3-Embedding family; we already call it
for the reranker). Same API, same billing; swap the model string (confirm per-token price).
Uses the same instruct convention as finding #2.

**Caveats:** the exact benchmark delta had a contradictory verifier vote, and there is no
music-domain embedding benchmark for either model — the real gain on our analysis text is
unknown until measured by the harness. Running Qwen3 without a task instruction degrades
quality (~1–5%).

**Sources:** <https://huggingface.co/Qwen/Qwen3-Embedding-0.6B> · <https://arxiv.org/html/2506.05176v1>

### 4. The reranker is starved

The cross-encoder document is just `"{song.name} by {artists}. Genres: {genres}."`
(`enrichment-pipeline/reranking.ts:60-68`). All the Gemini analysis (lens, take, arc, lines,
texture) sits in the DB unused at rerank time — the reranker can't outperform retrieval when
it sees less information than the embedding did. Feed it the analysis text (truncated).

Also: Qwen3-Reranker is a **generative yes/no-logit reranker** (extract logits for "yes"
token 9693 / "no" token 2152 at the final position, softmax → P(yes)), not a plain
cross-encoder. Verify the DeepInfra integration actually returns calibrated scores;
`tomaarsen/Qwen3-Reranker-0.6B-seq-cls` is a pre-converted sequence-classification version
with simpler integration. Standard practice is **full reranking** of the top-N, not a 70/30
blend, unless reranker scores are demonstrably uncalibrated — A/B both via the harness.

### 5. Audio: already migrated to ReccoBeats; audio *embeddings* remain a dead end (vote 2-1)

The 2026-06-06 doc flagged "plan the Spotify audio-features replacement" — that migration is
**already done**: the code sources features from ReccoBeats
(`src/lib/integrations/reccobeats/service.ts`, free, full Spotify schema parity). The live
risk is ReccoBeats durability (no SLA), handled post-prod (see roadmap).

On audio *embeddings*: across nine pretrained audio models (MusicFM, MERT, MuQ, Jukebox,
MusiCNN, MULE, EncodecMAE, Music2Vec, MuQ-MuLan), **none beat a basic collaborative-filtering
baseline** on recommendation, and MIR benchmark rank does not predict recommendation rank.
Not cheap, not reliably better — table this axis.

**Sources:** <https://arxiv.org/abs/2604.23077> · <https://arxiv.org/abs/2409.08987>

### 6. The single highest-leverage gap: we can't measure any of this — ⚠ REVISED 2026-06-10

Every recommendation here is a guess until scored offline against the `match_decision` log.
We're sitting on labeled data (`added` = positive, `dismissed` = negative per song/playlist)
and using it only for exclusion. An **offline replay harness** — replay logged decisions,
compute recall@k / MRR under a candidate config, temporal split — is cheap and converts every
other idea from "plausible" to "verified +X%". `scripts/matching-lab/` is a visual lab today,
not a metric harness; extend it.

**Revision (2026-06-10 data audit):** the gap is real but the original remedy was premature.
`match_decision` holds **10 decisions (7 added / 3 dismissed) on 1 playlist from 1 account**
(2026-04-29 → 2026-05-20), against 79 embedded songs and 1 profile. At that volume a temporal
split yields ~5 train / 5 test, playlist-size segmentation has one segment, and recall@k/MRR
is noise — the sanity replay's inconclusive −0.02 separation already demonstrated this. A
full harness built now would produce numbers that *look* like measurements but aren't, which
is worse than knowing you're unmeasured. So the remedy splits in three:

1. **Decision-log enrichment first (pre-prod #6)** — the only time-sensitive piece. The
   harness gains nothing from existing today, but every decision logged without rank/factor
   features is permanently degraded data.
2. **Slim replay runner (pre-prod #2, ~½ day)** — the data-volume-independent core: run the
   real pipeline (fusion + normalization + threshold + reranker) over the decision log under
   config A vs config B and diff the ranks of added/dismissed songs.
   `eval-embedding-sanity.ts` only replays raw cosine; the runner replays what users actually
   see. Its job at current volume is *config regression testing* ("does change X reorder the
   few labels we have in the wrong direction"), not measurement — every output carries an
   explicit n warning, as the sanity script already does.
3. **Full metrics (post-prod #1)** — recall@k, MRR, temporal split, segmentation. Gated on
   ~300–500 pairs across multiple playlists; an incremental extension of the runner when the
   data exists.

---

## Genre pills — verdict: build it, as a soft signal

User-selected genres at playlist creation/edit time, conditioning matching directly alongside
the free-text description.

**Why it works (evidence):**
- Spotify production ablation: removing onboarding-declared genre/artist signals costs
  **13.8%** on cold-start clusters (Spotify Research, Sept 2025).
- Attribute elicitation (genres) beats item-rating elicitation below ~13 interactions —
  exactly the empty-playlist regime where the HyDE guess currently carries everything.
- TTMR++: appending genre/metadata text to the embedded query is **additive** with keeping a
  separate structured genre score (+105% R@10 from enrichment layers, gains complementary —
  double-counting risk is small).

**Design (fits the existing architecture):**

1. **Never a hard filter.** Filtered-HNSW/recall literature: hard genre gates collapse recall
   for narrow genres (genre boundaries are fuzzy). Pills = soft boost.
2. **Feed pills into three existing channels:**
   - Append to intent text before embedding: `"{name} — {description}. Genres: indie rock, dream pop"`.
   - Seed `genre_distribution` with pseudo-counts (decaying as real members accumulate,
     mirroring `computeIntentWeight`'s decay) — makes the genre signal live from song #0 and
     replaces guessing in the HyDE path (`expected_genres` becomes user-declared).
   - Optionally bump genre weight from 0.20 to ~0.30 when pills are explicitly set
     (user-declared > inferred), with embedding/audio renormalized.
3. **Match pills exactly (canonical), expand softly.** Build a one-off genre-similarity table
   over the ~430-entry whitelist (embed genre names with the existing embedding model, or use
   the frozen Dec-2023 everynoise snapshot); boost adjacent genres at a discount (~0.5–0.6×).
   This also replaces the buggy substring matching (see code findings).
4. **UX:** the whitelist is unbrowsable as a flat list. Typeahead (≤8–10 suggestions,
   200–300ms debounce) + 8–12 contextual quick-pick pills + removable chips, cap ~5
   selections, always optional (Baymard filter/autocomplete guidelines). Surfaces:
   `OnboardingDescriptionDialog` and the playlist edit panel next to `PlaylistDescription`.
   Display-only `GenrePills` components already exist to crib styling from.
5. **Storage:** pills are app-local data (Spotify has no genre field on playlists) — new
   column/table on playlist, included in the profile content hash so profiles rebuild on change.

---

## Code-level findings (from the codebase sweep)

- ~~`vetoThreshold: 0.2` configured (`song-matching/config.ts`) but never branched on — dead.~~
  Removed 2026-06-10 alongside the normalization change.
- `MatchingPlaylistProfile.method`, `ProfileKind.context_v1` — declared, never written/read.
- `emotion_distribution` always persisted as `{}` — dead column (`emotionEnabled: false`).
- Genre scoring uses bidirectional **substring** matching (`song-matching/service.ts`):
  "rock" matches "post-rock"/"hard rock" (over-broad) while "electro" ≠ "electronic"
  (under-broad). Replace with canonical exact match + the genre-similarity expansion table.
- Genre distribution is raw counts, never normalized — fine for the ratio computed today,
  a footgun for any future use.
- Matching is brute-force O(songs × playlists) in TypeScript; HNSW indexes on
  `song_embedding`/`playlist_profile` are never queried. Fine now, a scaling cliff later.
- `match_decision` stores only (account, song, playlist, decision, timestamp) — not the
  rank/score/snapshot at decision time. Joinable via `match_result` but fragile; log them
  directly going forward so the harness and learned weights have clean features. This is
  pre-prod #6 — now first in line (see finding #6's revision).

---

## Do not build (refuted under 3-vote adversarial verification)

Preserved from the 2026-06-06 pass so we don't chase these speculatively. The 2026-06-09
pass found nothing that rehabilitates them.

| Claim | Vote | Note |
|---|---|---|
| Learned/multi-vector pooling beats mean-pooling by 22–33% NDCG | 0-3 | The headline case for multi-centroid / late-interaction playlist profiles did not hold. Might still help multi-mood playlists, but unproven — gate behind the harness (see post-prod #5). |
| IPS-weighted BPR debiasing improves generalization | 0-3 | Fancy unbiased-LTR machinery not validated enough to build. Cheap alternative: log rank + a little jitter now (pre-prod #6). |
| ColBERT token-pooling storage savings (50%/66% w/ ~no loss) | 1-2 / 0-3 | — |
| HTCL contrastive audio fine-tuning, ~3.7× lift | 0-3 | — |
| CLAP beats hand-crafted audio features | 0-3 | — |
| Skip-negative quantified lift (9–74% HR@1) | 1-2 | The structural point (dismissals as hard negatives) survived; the magnitude did not. |
| Semantic IDs / generative retrieval (Spotify Research 2025) | — | Real but requires training a generative model; not deployable at this budget. |

---

## Open questions

1. ⏳ Quality of `Qwen3-Embedding-0.6B` at reduced Matryoshka dims (256/512) **on
   music-analysis text specifically** — **still open.** We shipped 512 unmeasured (see #3);
   the sanity replay was noise at current data volume. Needs the full harness metrics
   (post-prod #1) + real decisions to settle, and to test whether 256 is also safe. The slim
   runner can't answer this — it catches regressions, not 2% quality deltas.
2. ⏳ DeepInfra per-token price for `Qwen3-Embedding-0.6B` vs E5 — **confirm before prod.**
   Swap is live in code; verify cost-neutral/cheaper on the DeepInfra dashboard (reranker-0.6B
   is $0.010/MTok; embedding price not on the public page).
3. Minimum viable `(song, playlist, decision)` volume before learned weights beat static
   fusion — practitioner guideline ~300–500 pairs for pairwise logistic regression, but
   measure via the harness.
4. ReccoBeats production durability — rate limits and terms are undisclosed; verify before
   scale, keep the fallback ladder ready.
5. Whether the 70/30 reranker blend ever beats full reranking once the reranker sees the
   analysis text — directional check via the slim runner now; real verdict via the full
   harness (post-prod #1).

---

## Key sources

- **Fusion/normalization:** Elastic linear retriever (min-max before weighted fusion), Weaviate fusion algorithms (`relativeScoreFusion`), Qdrant DBSF, OpenSearch RRF.
- **E5 anisotropy / prefix:** intfloat/multilingual-e5-large-instruct model card; practitioner write-ups on narrow-band cosine.
- **Qwen3-Embedding/Reranker:** arXiv 2506.05176; HF model cards; vLLM yes/no-logit docs; tomaarsen seq-cls conversion.
- **Genre conditioning:** TTMR++ (arXiv 2410.03264), TalkPlay (arXiv 2502.13713), filtered-HNSW recall (Elastic Labs / TDS), Qdrant formula rescoring, multilingual genre embeddings (arXiv 2009.07755).
- **Cold-start elicitation:** Spotify Research "Generalized User Representations" (Sept 2025, 13.8% ablation); attribute-aware preference elicitation (arXiv 2510.27342).
- **UX:** Baymard filter/autocomplete guidelines.
- **Learned weights / eval:** BPR (arXiv 1205.2618), Eugene Yan on position bias, offline-vs-online correlation (arXiv 2011.07931), Simpson's paradox in offline eval (arXiv 2104.08912), skip-negatives (arXiv 2409.07367).
- **Audio:** audio-embedding recommendation benchmark (arXiv 2604.23077, 2409.08987), ReccoBeats docs, Essentia docs, AcousticBrainz freeze notice.

---

## Method note

The 2026-06-06 findings came from a fan-out research harness (multi-angle web search → source
fetch → falsifiable-claim extraction → 3-vote adversarial verification requiring 2/3 to
refute → synthesis). Votes (e.g. "3-0", "2-1") are that verification outcome. The 2026-06-09
pass added a full codebase sweep (file:line verification of every code claim) and three fresh
research tracks (fusion practice, model landscape, genre conditioning/UX). Treat all
model-benchmark numbers as directional until validated by our own offline replay — there is
no music-domain benchmark for our specific inputs.
