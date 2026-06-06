# Matching System — Improvement Research

**Date:** 2026-06-06
**Status:** Research findings + recommendation. Nothing implemented yet.
**Scope:** Cheap, modern (2025–2026) improvements to the song→playlist matching pipeline. Hard constraint: no self-hosted GPU infra, no expensive per-request LLM calls.

This document captures a deep-research pass (multi-source web search + 3-vote adversarial
verification: 115 claims extracted, 25 verified, 8 confirmed, most refuted) layered with a
read of the current code. The verification kill-rate is the useful part — several
exciting-sounding 2025 papers did **not** survive scrutiny and are listed under "Do not build"
so we don't chase them.

---

## The pipeline today (for reference)

1. **LLM analysis** — Gemini 2.5 Flash (Vertex) → structured JSON "read" of each song.
2. **Genre enrichment** — Last.fm tags → 469-genre whitelist, top 3.
3. **Embedding** — analysis fields concatenated → `intfloat/multilingual-e5-large-instruct`
   (DeepInfra, 1024-dim).
4. **Playlist profiling** — single **mean centroid** of member embeddings, blended with a
   name+description embedding; plus an averaged audio-feature centroid + genre distribution.
5. **Fusion** — linear weighted: embedding cosine `0.50` + audio similarity `0.30` +
   genre overlap `0.20`. Min threshold `0.3`, top-K `10`.
   (`src/lib/domains/taste/song-matching/config.ts`)
6. **Caching** — content hash.
7. **Reranking** — top-50 reranked by `Qwen/Qwen3-Reranker-0.6B` (DeepInfra), blended 70/30.

**Cold-start:** empty playlists use a HyDE-style imagined prototype song.
**Underused data:** per-`(song, playlist)` `added`/`dismissed` decisions (`match_decision`);
Genius annotations with vote counts.

---

## TL;DR — what I'd do, ranked, given a tight budget

1. **Fix the E5 prefix format.** Free. Confirmed bug on *both* sides. Improves everything downstream today.
2. **Build an offline replay harness** over `match_decision`. Cheap compute on data we already have. It is the prerequisite that turns every other idea from "plausible" into "verified +X%."
3. **Swap to `Qwen3-Embedding-0.6B` at 512-dim Matryoshka** (same DeepInfra vendor). Re-embed once, measure against #2, keep the cheaper/better config.
4. **Learn the fusion weights** via pairwise logistic regression on the decision log — the safe personalization win.
5. **Plan the Spotify audio-features replacement** before deprecation forces it.
6. **Deferred / do not build speculatively:** multi-centroid profiles, audio embeddings, IPS debiasing — all failed verification. Revisit only if #2 can prove they help.

The throughline: **#1 and #2 unlock everything else.** One is a free bug fix; the other turns
our unused decision log into a measurement instrument. Spend there before spending on models.

---

## Confirmed findings (survived verification)

### 1. The E5 instruct prefix is wrong on both sides — free fix (vote 3-0)

We run the **instruct** variant (`multilingual-e5-large-instruct`) but prefix with the
**non-instruct** convention. The model card is explicit:

> "Yes, this is how the model is trained, otherwise you will see a performance degradation.
> On the other hand, there is no need to add instructions to the document side."

So there are **two** errors:
- **Queries** must be `Instruct: {task_description}\nQuery: {text}` — not `query:`.
- **Documents** (songs, playlist centroids) must have **no prefix at all** — not `passage:`.

Every embedding in the system — songs, playlist centroids, the name/description blend — has
been computed in a format the model wasn't trained for.

**Where it lives in code:**
- `src/lib/integrations/deepinfra/service.ts:67` — `EmbedPrefixSchema` only allows `query:`/`passage:`.
- `src/lib/integrations/deepinfra/service.ts:170` — passage default applied to all texts.
- `src/lib/domains/enrichment/embeddings/service.ts:152,277` — songs + playlist profiles forced to `passage:`.
- `src/lib/domains/enrichment/embeddings/model-bundle.ts:33` — an `isInstructionTuned` flag already exists ("affects query prefixing") but the DeepInfra path never branches on it.

**Cost:** zero (string/format change + branch on the existing flag).
**Source:** <https://huggingface.co/intfloat/multilingual-e5-large-instruct>

### 2. `Qwen3-Embedding-0.6B` is a real drop-in upgrade (vote 3-0)

Same parameter size as our E5, modestly better on MTEB Multilingual (~64.3 vs ~63.2 mean —
"meaningful but not dramatic," ~1.1 points), and it supports **Matryoshka Representation
Learning** (dims 32–1024) so we can truncate to **512 dims** and roughly halve vector storage
+ ANN cost with little quality loss.

Practical kicker: **it's the same vendor we already use.** DeepInfra hosts the Qwen3-Embedding
family — we already call DeepInfra for the Qwen3-*Reranker*. Same API, same billing; swap the
model string (confirm current per-token price). Uses the same instruct convention as the fix in
#1 (`Instruct:…\nQuery:…` on queries, no prefix on documents).

**Honesty caveat:** the exact benchmark delta had a contradictory verifier vote, and there is
**no music-domain embedding benchmark** for either model. On our actual input (analysis JSON),
the real gain is unknown until measured — see the eval gap below.

**Cost:** one-time re-embed of the corpus; per-request cost similar or lower (fewer dims).
**Sources:** <https://huggingface.co/Qwen/Qwen3-Embedding-0.6B> · <https://arxiv.org/html/2506.05176v1>

### 3. `added`/`dismissed` as hard negatives — structurally sound (vote 2-1)

Treating dismissed tracks as **hard negatives** is genuinely richer training signal than random
negatives — it's grounded in real user rejection. Directly applicable to the `match_decision`
log we already collect.

**Two caveats that bound the ambition:**
- The *quantified* lift (a 9–74% HR@1 claim) was **refuted** (1-2). Only the structural point survives.
- The cited method assumes *sequential session* data; our system is a **batch matcher**
  (liked songs → playlists), so the contrastive/InfoNCE framing needs adaptation.

**Recommendation — tier it:**
- **Cheap, safe first step:** pairwise logistic regression on the three fusion sub-scores
  (embedding, audio, genre) → learned weights replacing the hand-set `0.50/0.30/0.20`.
- **Only if that plateaus:** contrastive embedding fine-tuning with skip-negatives, gated behind
  the eval harness.

**Source:** <https://arxiv.org/abs/2409.07367>

### 4. Audio embeddings are not cheap and don't reliably help (vote 2-1)

Across **nine** pretrained audio models (MusicFM, MERT, MuQ, Jukebox, MusiCNN, MULE,
EncodecMAE, Music2Vec, MuQ-MuLan), **none beat a basic collaborative-filtering baseline** on
recommendation. The genuinely useful finding: **MIR benchmark rank does not predict
recommendation rank** — an *older supervised* model (MusiCNN) outperformed newer self-supervised
ones. So even ignoring cost, model selection is a guess, and inference isn't cheap at scale.

**Verdict:** table this axis. Not cheap, not reliably better.

**But note the looming risk it surfaced:** Spotify's audio-features API is being deprecated.
That signal feeds *both* the LLM analysis prompt *and* the `0.30` audio fusion signal. The live
question is not "how do we add audio" but **"what cheaply replaces the audio signal we already
depend on"** — genre-only fallback, a free archive (AcousticBrainz), or folding audio character
into the LLM prompt at no extra cost.

**Sources:** <https://arxiv.org/abs/2604.23077> · <https://arxiv.org/abs/2409.08987>

---

## The single highest-leverage gap: we can't measure any of this

Every recommendation above is a **guess until we can score it offline** against the
`match_decision` log. We're sitting on labeled data (`added` = positive, `dismissed` = negative
per song/playlist) and not using it for evaluation.

An **offline replay harness** — replay logged decisions, compute ranking metrics (recall@k, MRR)
under a candidate config — is cheap (pure compute over data we have) and converts every other
idea from "plausible" to "verified." It is the prerequisite for trusting the prefix fix, the
Qwen3 swap, and the learned weights. It also makes the in-flight voice-audit work measurable on
matching, not just on prose quality.

**Build this second, right after the free prefix fix.**

---

## Do not build (refuted under 3-vote adversarial verification)

These sounded promising but failed verification. Listed so we don't spend on them speculatively.

| Claim | Vote | Note |
|---|---|---|
| Learned/multi-vector pooling beats mean-pooling by 22–33% NDCG | 0-3 | The headline case for multi-centroid / late-interaction playlist profiles did not hold. Might still help our multi-mood playlists, but unproven — don't invest without our own test. |
| IPS-weighted BPR debiasing improves generalization | 0-3 | Fancy unbiased-LTR machinery not validated enough to build. |
| ColBERT token-pooling storage savings (50%/66% w/ ~no loss) | 1-2 / 0-3 | — |
| HTCL contrastive audio fine-tuning, ~3.7× lift | 0-3 | — |
| CLAP beats hand-crafted audio features | 0-3 | — |
| Skip-negative quantified lift (9–74% HR@1) | 1-2 | The *structural* point (finding #3) survived; the magnitude did not. |

---

## Open questions (worth resolving before/within implementation)

1. Quality of `Qwen3-Embedding-0.6B` at reduced Matryoshka dims (256/512) **on music-analysis
   text specifically** — is 512 enough to hold ranking quality while halving ANN cost?
2. DeepInfra per-request price for `Qwen3-Embedding-0.6B` vs current E5 — confirm the swap is
   cost-neutral or cheaper.
3. Minimum viable dataset size of `(song, playlist, decision)` triples before learned weights /
   contrastive fine-tuning beat static fusion — and whether offline replay alone can measure it
   without a live A/B.
4. Cheapest adequate replacement for the `0.30` audio signal ahead of Spotify deprecation:
   genre-only fallback, a free tagging archive, or absorbing audio character into the LLM prompt.

---

## Method note

Findings were produced by a fan-out research harness (multi-angle web search → source fetch →
falsifiable-claim extraction → 3-vote adversarial verification requiring 2/3 to refute →
synthesis), then reconciled against the codebase. Votes (e.g. "3-0", "2-1") are the verification
outcome; "high"/"medium" confidence and the refuted table reflect that. Treat all model-benchmark
numbers as directional until validated by our own offline replay (the eval gap above) — there is
no music-domain benchmark for our specific inputs.
