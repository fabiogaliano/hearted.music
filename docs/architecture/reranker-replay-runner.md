# Reranker + Offline Replay Runner

Status: implemented 2026-06-10 · Scope: matching-system-roadmap #2 (offline replay harness) + #b (reranker A/B) · Companion: [`reranker-replay-runner-plan.md`](./reranker-replay-runner-plan.md)

## Why this exists

Song→playlist matching is two stages: **retrieval** (fast embedding/cosine similarity narrows to ~50 candidates) then **reranking** (a cross-encoder re-scores those candidates against the playlist). This work did two linked things:

1. **Fixed the reranker**, which was silently broken in production.
2. **Built an offline replay runner** so reranker/matching config changes can be evaluated against real user decisions (`added`/`dismissed`) *before* shipping — no live A/B required.

## What shipped

| Area | Change | Key files |
|---|---|---|
| **DeepInfra contract (prod)** | `rerank()` sent the wrong (Cohere/Jina) request shape → response failed validation → reranking **silently skipped on every call**. Fixed to DeepInfra's real contract; reranking now actually runs in prod. | `src/lib/integrations/deepinfra/service.ts` |
| **Reranker config** | Exposed `model` + `instruction` as replayable `RerankerConfig`/`RerankOptions` fields. | `src/lib/integrations/reranker/service.ts`, `providers/types.ts` |
| **Reranker document** | Document switched from the sparse `"{name} by {artists}. Genres: …"` one-liner to flattened `song_analysis` prose (shared with the embedding text). | `src/lib/workflows/enrichment-pipeline/reranking.ts`, `src/lib/domains/enrichment/embeddings/analysis-text.ts`, `match-snapshot-refresh/orchestrator.ts` |
| **Local dev reranker** | `LocalProvider` now runs the prod-family **Qwen3-Reranker-0.6B via ONNX** (transformers.js, yes/no-logit scoring). **Dev-only** (`ML_PROVIDER=local`); prod stays on DeepInfra. | `src/lib/integrations/providers/adapters/local.ts`, `scripts/matching-lab/verify-local-reranker.ts` |
| **Replay runner** | Decision loader + provider-agnostic replay engine + CLI + IR metrics. | `scripts/matching-lab/replay/` |

## Key decisions

- **DeepInfra reranker contract** is parallel arrays, pairwise: request `{queries: string[], documents: string[]}`, response `{scores: number[]}` (positional, `scores[i]`↔`documents[i]`). To rank one query over N docs, send `queries: Array(N).fill(query)`. Verified against the official API page. No `top_n`/`return_documents`. The old shape (`{query, documents, return_documents}` → `results[].relevance_score`) was wrong — the root cause of the silent outage.
- **One canonical instruction everywhere.** `DEFAULT_RERANK_INSTRUCTION` lives in `providers/types.ts` (the one module both adapters and the reranker service can import without a cycle) and is the `RerankerConfig` schema default — so prod, replay variants, and direct provider calls all score with the same `<Instruct>` text. DeepInfra always receives the `instruction` field; rerank still **degrades gracefully** (original order) if rejected, but degradation is now logged, never silent. The DeepInfra-accepts-`instruction` case is the one thing unverifiable without a key.
- **Local reranker** loads `zhiqing/Qwen3-Reranker-0.6B-ONNX` as a causal LM, applies Qwen's chat template + forced empty `<think>` block, and softmaxes the last-token logits for the yes/no tokens (ids 9693/`yes`, 2152/`no`) → P(yes). fp32, ~1.2GB, ~1s/doc CPU. Metadata model id kept canonical (`Qwen/Qwen3-Reranker-0.6B`) so hashes match prod.
- **Document mode is data-driven**: `rerankMatches` takes an optional `Map<songId, analysisText>`. Empty/omitted ⇒ metadata mode; populated ⇒ analysis mode. Analysis tail truncated to ~1600 chars at a word boundary; falls back to the metadata one-liner when a song has no analysis.
- **Snapshot hash includes `instruction` + `documentMode`** so changing either invalidates stale snapshots. The hash records the document mode *actually used*: if the analysis fetch fails, the orchestrator logs an error, degrades to metadata docs, and the snapshot hash says `metadata` — it never claims a richer document than was sent.
- **Replay engine** loads liked ∪ decided songs (so every decided pair is scoreable), **omits the production exclusion set**, and uses stored playlist profiles (no re-profiling). A decided pair's rank = the song's position in its playlist's score-sorted list; `null` = "fell out" (below threshold/top-K). The engine is **provider-agnostic** — DeepInfra when `DEEPINFRA_API_KEY` is set, local ONNX when `ML_PROVIDER=local`.

## How to run the evaluation

```bash
# Local dev model (no key, no cost):
ML_PROVIDER=local bun run scripts/matching-lab/replay/index.ts \
  --a configs/<A>.json --b configs/<B>.json [--account <id>] [--no-rerank-a]

# Prod-faithful (set DEEPINFRA_API_KEY instead of ML_PROVIDER):
DEEPINFRA_API_KEY=… bun run scripts/matching-lab/replay/index.ts --a … --b …
```

Variant configs live in `scripts/matching-lab/replay/configs/` (`prod` = current production behavior, `legacy-prod` = the pre-fix metadata-doc baseline, `metadata-doc`, `analysis-doc`, `full-rerank`, `blend-0.7`). Each run prints a rank-diff table + metric summary (with a directional-only warning baked into the console output below 200 trials) and writes a JSON to `claudedocs/replay-results/` (scratch). Metrics: pairwise win rate (+ binomial p), nDCG@10, MRR, mean/median rank-of-added, added-fell-out %.

## ⚠️ When to re-run the evaluation (the two gating conditions)

The Phase 3 results below are **directional only** and **must not** drive a config change yet. Re-run — and only then promote a config — once **both** hold:

1. **~200+ judged decisions across multiple playlists.** Current data is **16 decisions on a single playlist**; every result is a coin-flip you'd be over-reading (all binomial p-values were 0.44–1.0, non-significant).
2. **Playlists have real names/descriptions.** The reranker scores *document-against-query*, and the query is built from the playlist name/description. The test playlists are near-empty ("hello", "jj", null description), so a blank query can't be improved by a better document — which is exactly why the document experiment showed no effect. **This is the gating fix for the document A/B to even be testable.**

When both hold, the experiment is one command. The instrument is built and validated; only the data is missing.

## Phase 3 results (directional only — n=16, single playlist)

Local Qwen3-Reranker-0.6B. All variants: added/dismissed = 9/7.

| Config | Pairwise win rate | nDCG@10 | Read |
|---|---|---|---|
| blend 0.3 (metadata doc) | 49.2% | 0.000 | reranker effect washed out |
| blend 0.3 (analysis doc) | 49.2% | 0.000 | document change did nothing (empty query) |
| **blend 0.7** | **52.5%** | 0.333 | best win rate + one added song into top-10 |
| blend 1.0 (full rerank) | 44.3% | 0.333 | overcorrects — win rate collapses |

Pattern: the reranker's influence only appears at blend ≥ 0.7; 0.7 directionally dominates 1.0. **No config promoted to `DEFAULT_RERANKER_CONFIG`** — see gating conditions above.

## Before this ships to prod

1. **Live DeepInfra smoke test** (needs a key, ~15 min): confirm a real `200` + `scores`, and specifically that DeepInfra accepts the `instruction` field — it is now **always sent** (canonical default). If DeepInfra rejects it, rerank degrades to original order, but no longer silently: the degradation is logged per call (`[reranker] provider rerank failed …`) and shows up as `0/M playlists` in the summary line. `scripts/matching-lab/verify-reranker.ts` is the ready-made probe.
2. ~~**Add a "reranker ran" log/metric.**~~ **Done 2026-06-11:** `rerankMatches` logs `[rerank] reranked N docs across M/T playlists (K skipped/degraded)` on every call, and `RerankerService` warns on each graceful-degradation path. The DeepInfra request/response shape is also pinned by unit tests (`deepinfra/__tests__/rerank.test.ts`) so a regression to the legacy body shape fails CI instead of dying silently.
3. **Blend/document tuning is deferred** to the re-run (above). Shipping the contract + document fix at the current blend 0.3 is the conservative turn-on (reranker contributes 30%).
