# Matching System — Deep Analysis & Roadmap (2026-06-09)

Companion to `docs/architecture/matching-system-improvements.md` (2026-06-06). This pass
re-verified that doc against the actual codebase, ran fresh web research (fusion practice,
embedding/reranker landscape mid-2026, genre conditioning, cold-start elicitation), and adds
the genre-pills design. Verdict on the original doc: directionally right, but it misses the
two highest-impact code-level problems and one of its five priorities is already done.

---

## 1. Verdict on the existing doc

| Doc claim | Verdict | Notes |
|---|---|---|
| #1 E5 prefix wrong on both sides | **Confirmed in code** | Songs/HyDE embed with `passage:` (`embeddings/service.ts`, `intent-expansion.ts:174`), intent with `query:` (`playlist-profiling/service.ts:229`). Instruct variant wants `Instruct: …\nQuery: …` on queries and **no prefix** on documents. `isInstructionTuned` flag exists (`model-bundle.ts:113`) but nothing branches on it. |
| #2 Replay harness is the prerequisite | **Agree, strongest item** | `scripts/matching-lab/` exists but is a visual lab, not a metric harness over `match_decision`. |
| #3 Qwen3-Embedding-0.6B swap | **Agree** | Still current as of mid-2026 (~64.3 vs ~62 MTEB multilingual). MRL→512 valid on Qwen3; **not** valid on E5 (no MRL training). Same DeepInfra vendor. |
| #4 Learned fusion weights | **Agree, but post-prod** | Pairwise logistic regression needs ~200–500 accept/reject pairs to beat hand weights. Gate on data volume. |
| #5 "Plan Spotify audio-features replacement" | **Already done — doc is stale** | Code already uses **ReccoBeats** (`integrations/reccobeats/service.ts`), not Spotify. The real risk is ReccoBeats durability (free, no SLA, undisclosed rate limits), not Spotify deprecation. |
| "Do not build" list | **Agree** | Multi-centroid evidence does exist (PinnerSage medoids, ComiRec +2–8% recall) but only for genuinely multi-modal profiles — keep it gated behind the harness. |

### What the doc missed (both bigger than the prefix fix)

**A. Score fusion is mis-scaled — the 0.50 embedding weight is largely fictional.**
E5-family cosine scores cluster in a ~0.75–0.90 band (anisotropy / low-temperature InfoNCE).
The code stretches with `(sim − 0.5) / 0.5` (`song-matching/service.ts:247-259`,
`similarityBaseline: 0.5`), which still leaves an effective range of roughly 0.5–0.8 while
audio and genre scores span 0–1. The nominally-0.50 embedding signal has far less
*differential* influence than its weight implies. Industry consensus (Elastic linear
retriever, Weaviate relativeScoreFusion — default since v1.24, Qdrant DBSF): **normalize each
signal per candidate set (min-max or z-score) before the weighted sum**. This is a ~30-line
change and likely worth more than any model swap.

**B. The reranker is starved.**
The cross-encoder document is just `"${name} by ${artists}. Genres: ${genres}."`
(`enrichment-pipeline/reranking.ts:60-68`). All the Gemini analysis (lens, take, arc, lines,
texture) sits in the DB unused at rerank time. The reranker can't outperform the retrieval
stage when it sees less information than the embedding did. Feed it the analysis text
(truncated). Also verify the DeepInfra Qwen3-Reranker integration: it's a generative
yes/no-logit reranker (tokens 9693/2152 → softmax), not a plain cross-encoder — confirm the
endpoint actually returns calibrated scores; `tomaarsen/Qwen3-Reranker-0.6B-seq-cls` is the
simpler-integration conversion. Standard practice is **full reranking** of the top-N, not a
70/30 blend, unless reranker scores are demonstrably uncalibrated.

### Other code-level findings (from the codebase sweep)

- `vetoThreshold: 0.2` configured (`config.ts:48`) but never branched on — dead.
- `MatchingPlaylistProfile.method`, `ProfileKind.context_v1` — dead.
- `emotion_distribution` always persisted as `{}` — dead column.
- Genre scoring uses bidirectional **substring** matching (`service.ts:264-301`): "rock"
  matches "post-rock"/"hard rock" (over-broad) while "electro" ≠ "electronic" (under-broad).
  Replace with canonical exact match + a genre-similarity expansion table.
- Genre distribution is raw counts, never normalized — fine for the ratio computed today,
  but a footgun for any future use.
- Matching is brute-force O(songs × playlists) in TypeScript; the HNSW indexes on
  `song_embedding`/`playlist_profile` are never queried. Fine now, a scaling cliff later.
- `match_decision` stores only (account, song, playlist, decision, timestamp) — not the
  rank/score/snapshot at decision time. Joinable via `match_result` but fragile; log them
  directly going forward so the harness and learned weights have clean features.

---

## 2. Genre pills — verdict: build it, as a soft signal

The research strongly supports the idea, with a specific shape:

**Why it works (evidence):**
- Spotify production ablation: removing onboarding-declared genre/artist signals costs
  **13.8%** on cold-start clusters (Spotify Research, Sept 2025).
- Attribute elicitation (genres) beats item-rating elicitation below ~13 interactions —
  exactly the empty-playlist regime where our HyDE guess currently carries everything.
- TTMR++: appending genre/metadata text to the embedded query is **additive** with keeping a
  separate structured genre score (+105% R@10 from enrichment layers, gains complementary).

**Design (fits the existing architecture):**
1. **Never a hard filter.** Filtered-HNSW/recall literature: hard genre gates collapse recall
   for narrow genres. Pills = soft boost.
2. **Feed pills into three existing channels:**
   - Append to intent text before embedding: `"{name} — {description}. Genres: indie rock, dream pop"`.
   - Seed `genre_distribution` with pseudo-counts (decaying as real members accumulate,
     mirroring `computeIntentWeight`'s decay) — makes the 0.20 genre signal live from song #0
     and replaces guessing in the HyDE path (`expected_genres` becomes user-declared).
   - Optionally bump genre weight to ~0.30 when pills are explicitly set (user-declared >
     inferred), with embedding/audio renormalized.
3. **Match pills exactly (canonical), expand softly.** Build a one-off genre-similarity table
   over the ~430-entry whitelist (embed genre names with the existing embedding model, or use
   the frozen everynoise snapshot); boost adjacent genres at a discount (~0.5–0.6×).
4. **UX:** 469 genres is unbrowsable. Typeahead (≤8–10 suggestions, 200–300ms debounce) +
   8–12 contextual quick-pick pills + removable chips, cap ~5 selections, always optional.
   Surfaces: `OnboardingDescriptionDialog` and the playlist edit panel next to
   `PlaylistDescription`. Display-only `GenrePills` components already exist to crib styling from.
5. Pills are app-local data (Spotify has no genre field on playlists) — new column/table on
   playlist, included in the profile content hash so profiles rebuild on change.

---

## 3. Prioritized roadmap

### Pre-prod (before real users — cheap, compounding)

| # | Item | Cost | Why this order |
|---|---|---|---|
| 1 | **Per-candidate-set score normalization before fusion** (min-max or z-score per signal; drop the 0.5-baseline stretch) | ~½ day | Biggest mis-scaling in the system; pure code; makes weights mean what they say. Re-tune `minScoreThreshold` (it's in fused-score units). |
| 2 | **Offline replay harness** over `match_decision` (recall@k, MRR; temporal split; segment by playlist size) | 1–2 days | Turns every later change from "plausible" into "measured". Extend `scripts/matching-lab/`. |
| 3 | **One combined re-embed:** correct instruct format (`Instruct:`/no-prefix) + swap to Qwen3-Embedding-0.6B, eval 1024 vs 512 MRL via #2 | 1 day + re-embed | Prefix fix alone forces a full re-embed; never re-embed twice. Branch on `isInstructionTuned` properly. |
| 4 | **Reranker fixes:** feed analysis text as document; verify yes/no-logit scoring on DeepInfra; A/B full-rerank vs 70/30 via #2 | ~1 day | The 30% blend currently rides on a name+genre string. |
| 5 | **Genre pills** (per §2) | 2–4 days | Strongest cold-start evidence; product-visible; independent of #1–4. |
| 6 | **Decision-log enrichment:** store rank, factor scores, snapshot id at decision time; optionally ~5% rank jitter for future debiasing | hours | Free now, impossible to backfill later. |
| 7 | **Hygiene:** delete or implement `vetoThreshold`; fix genre substring matching (canonical + similarity table from #5.3); remove dead fields | hours | Bundle with adjacent work. |

### Post-prod (gated on real usage data)

1. **Learned fusion weights** — pairwise logistic regression on normalized factor scores once
   ~300–500 accept/reject pairs exist; LambdaMART only past ~1–5k. Needs #6's logged features.
2. **Eval discipline** — segment metrics by popularity tier and playlist size (Simpson's
   paradox); treat offline metrics as a filter, not a predictor.
3. **ReccoBeats contingency** — it's free with no SLA. Watch failure rates; fallback ladder:
   adaptive weight redistribution (already works) → Essentia self-hosted if preview audio is
   available → fold audio character into the Gemini prompt.
4. **Multi-centroid profiles** — only if the harness shows multi-mood playlists underperform
   (check intra-playlist embedding variance first). 2–3 medoids + max-sim is the cheap version.
5. **pgvector ANN path** — when O(S×P) in-process scoring hurts; indexes already exist.
6. **Reranker shootout** — zerank-1-small ($0.025/MTok) / voyage-rerank-2.5-lite vs Qwen3, via #2.

### Still "do not build" (unchanged)

IPS-weighted BPR, contrastive fine-tuning, audio embeddings, semantic IDs — all remain
post-harness, post-evidence. The original doc's refuted list stands.

---

## 4. Key sources

- Fusion/normalization: Elastic linear retriever, Weaviate fusion algorithms (relativeScoreFusion), Qdrant DBSF, OpenSearch RRF.
- E5 anisotropy: intfloat/multilingual-e5-large-instruct model card; practitioner write-ups on narrow-band cosine.
- Qwen3-Embedding/Reranker: arXiv 2506.05176; HF model cards; vLLM yes/no-logit docs; tomaarsen seq-cls conversion.
- Genre conditioning: TTMR++ (arXiv 2410.03264), TalkPlay (2502.13713), filtered-HNSW recall (Elastic Labs), Qdrant formula rescoring.
- Cold-start elicitation: Spotify Research "Generalized User Representations" (Sept 2025, 13.8% ablation); arXiv 2510.27342.
- UX: Baymard filter/autocomplete guidelines.
- Learned weights / eval: BPR (1205.2618), Eugene Yan position bias, offline-vs-online correlation (2011.07931), Simpson's paradox (2104.08912).
