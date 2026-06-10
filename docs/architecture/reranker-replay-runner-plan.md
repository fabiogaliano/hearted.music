# Implementation Plan: Offline Replay Runner + Reranker Fixes

Date: 2026-06-10 · Status: planned · Estimated effort: ~2 days total (runner ~1d, reranker fixes ~1d, much of it shared)

## Context

Two roadmap items, planned together because the reranker A/B (item b) needs the replay runner (item a) to be measurable:

- **(a) Slim offline replay runner over `match_decision`** — re-run the *real* pipeline (fusion + normalization + threshold + reranker, not raw cosine) under a candidate config, and diff config A vs B by where `added`/`dismissed` songs land.
- **(b) Reranker fixes** — feed analysis text as the document (today it's a `name + artists + genres` one-liner while the rich `song_analysis` text sits unused), verify yes/no-logit scoring on DeepInfra, and A/B full-rerank vs the current 70/30 blend.

### Research findings that shape this plan

1. **The DeepInfra request/response contract is likely wrong — and failing silently.**
   `src/lib/integrations/deepinfra/service.ts:280-308` sends `{query, documents, return_documents, top_n}` (Cohere/Jina shape) and parses `results[].relevance_score`. DeepInfra's documented contract for `Qwen/Qwen3-Reranker-0.6B` at `POST /v1/inference/Qwen/Qwen3-Reranker-0.6B` is:
   - request: `{queries: string[], documents: string[]}` (parallel arrays — N queries × N documents, *pairwise*, not 1-query-vs-N-docs)
   - response: `{scores: number[], input_tokens, inference_status}`
   On a shape mismatch, `RerankApiResponseSchema.safeParse` fails → `Result.err` → `rerankMatches` hits `continue` (reranking.ts:76) and **silently skips reranking**. The 70/30 blend may never have been live. Verifying this is Task 0.

2. **Scoring mechanism (Qwen3-Reranker):** decoder-only LM; score = softmax P("yes") vs P("no") at the last token under a fixed chat template (`<Instruct>/<Query>/<Document>` + forced empty `<think>` block). DeepInfra applies the template server-side and returns the final probability — raw logprobs are *not* exposed, so "verify yes/no-logit scoring" means black-box sanity checks, not reading logits.

3. **Model choice: we already use the matched-family model.** `RERANKER_MODEL = Qwen/Qwen3-Reranker-0.6B` pairs with our `Qwen3-Embedding-0.6B` retriever — exactly what the Qwen3 paper prescribes. No model change needed. Benchmarks (arXiv 2506.05176, Table 4, nDCG@10 over top-100 from Qwen3-Embedding-0.6B):
   - Qwen3-Reranker-0.6B: 65.80 MTEB-R — beats BGE-reranker-v2-m3 (57.03) at the same size.
   - Qwen3-Reranker-4B: 69.76 (+3.96) and *much* better instruction-following (FollowIR 14.84 vs 5.41) at $0.025/1M vs $0.010/1M.
   - Verdict: keep 0.6B as default; expose the model id in `RerankerConfig` so 4B becomes a one-line replay experiment. At our volume (≤50 docs × ~300 tokens per playlist refresh) even 4B is fractions of a cent per snapshot.

4. **Blend vs full rerank:** literature (arXiv 2510.13329) finds pure reranking (α=1.0) usually beats blends when the reranker is strong; blending mainly hedges weak retrieval. So the A/B should test `blendWeight ∈ {0.3, 0.7, 1.0}`, expecting 1.0 to win *once the document is rich text*. With the current sparse doc string, the reranker has almost no signal and the blend question is moot — fix the document first.

5. **Documents:** rich descriptive text of ~200–400 tokens substantially outperforms sparse metadata strings. 32K context; truncate document content only (never query), reserving ~100 tokens of template overhead.

6. **Metrics for small n (implicit feedback):** pairwise win rate (added ranked above dismissed), rank-of-added (mean/median), MRR, nDCG@10. Pairwise win rate + binomial test is the most robust at current data volume; treat everything as directional below ~200 judged pairs. Position-bias caveat: added/dismissed labels were collected under the served ranking; results favor configs that resemble the served config. Acceptable for directional reads; note it in output.

### Replay fidelity constraint (accepted approximation)

`match_result` stores only the post-threshold top-K, not the full candidate set, and normalization stats (z-score) are computed over the whole batch matrix. Exact reconstruction of the served run is therefore impossible. The runner instead replays over the account's *current* entitled song set and *current* playlist profiles. That's fine for the actual goal — config A vs B compete under identical inputs — but A-vs-served comparisons are only indicative. `served_rank` on `match_decision` is still useful as a third reference column.

---

## Tasks

### Phase 0 — Verify the DeepInfra reranker contract (~2h) — DO FIRST

**Task 0.1 — Live contract probe script.** `scripts/matching-lab/verify-reranker.ts` (bun, hits real DeepInfra with `DEEPINFRA_API_KEY`):
- Send the *current* code's body shape and log the raw JSON response.
- Send the *documented* shape (`{queries: [...], documents: [...]}`) and log it.
- Report which one succeeds and what the response schema actually is.

**Task 0.2 — Black-box yes/no-probability sanity checks** (same script, against whichever shape works):
- *Inversion check:* document containing the query text verbatim → score > 0.9; unrelated document → score < 0.2.
- *Monotonicity:* 3 docs of strictly decreasing relevance → strictly decreasing scores.
- *Distribution:* ~50 mixed pairs (sample real playlist queries + song docs from local DB) → scores spread roughly 0.05–0.95; clustering at ~0.5 indicates template misapplication server-side.
- *Pairwise semantics check:* confirm whether the endpoint scores `queries[i]` against `documents[i]` (pairwise) or one query against all documents. This determines how Task 0.3 builds requests (repeat the query N times vs send once).

**Task 0.3 — Fix the integration to the verified contract.** Update `rerank()` in `deepinfra/service.ts` (request body, `RerankApiResponseSchema`, score extraction — `scores[i]` is positional, no `index` field) and its types/tests. If pairwise: send `queries: Array(docs.length).fill(query)`.

**Exit criteria:** sanity checks pass; reranker demonstrably returns calibrated 0–1 relevance probabilities; `rerankMatches` integration test updated to the real shape.

### Phase 1 — Slim offline replay runner (~1 day)

All under `scripts/matching-lab/replay/`, reusing the matching-lab pattern (real `MatchingService`/`RerankerService` against local Supabase, like `server.ts` does).

**Task 1.1 — Decision dataset loader** (`load-decisions.ts`):
- Query `match_decision` joined to `match_snapshot` (for `config_hash`/`algorithm_version` provenance) grouped by `account_id`.
- Emit per account: `{songId, playlistId, decision, servedRank, snapshotId}` rows. Reuse the join pattern from `eval-embedding-sanity.ts:26-103`.
- Filters: `--account`, `--since`, optional `--require-snapshot`.

**Task 1.2 — Pipeline replay engine** (`run-config.ts`):
- Load current inputs once per account: entitled enriched song ids, songs + audio features, song embeddings, playlist profiles — same loads as `orchestrator.ts`, *without* the exclusion set (we must score the decided pairs, which the production exclusion set excludes by definition).
- Run `createMatchingService(partialConfig).matchBatch(...)` → `rankAndFilter` → `rerankMatches(...)` with a `RerankerService` built from the candidate `Partial<RerankerConfig>`.
- Config input: a small JSON/TS literal per variant: `{matching?: Partial<MatchingConfig>, reranker?: Partial<RerankerConfig> & {enabled?: boolean}, documentMode?: "metadata" | "analysis"}`.
- Output per variant: full ranked lists per (song → playlist) plus a lookup of rank for every decided pair (rank = position in that playlist's ranked list; `null` if below threshold/top-K — track "fell out" explicitly, it's signal).
- One subtlety: replay must use a *fixed* candidate threshold context — both variants score the same pairs, then apply their own threshold/top-K, so threshold changes are also A/B-able.

**Task 1.3 — Metrics + diff** (`metrics.ts`):
- Per variant: pairwise win rate over (added, dismissed) pairs within the same playlist (+ binomial p-value), mean/median rank-of-added, mean rank-of-dismissed, MRR over added, nDCG@10 (added=1, dismissed=0), % of added pairs that fell below threshold.
- A vs B diff: per-decided-pair rank delta table (songId, playlistId, decision, servedRank, rankA, rankB, Δ), plus the metric summary side by side. Biggest movers printed first.
- Output: console table + `claudedocs/replay-results/<timestamp>-<labelA>-vs-<labelB>.json` for later inspection. (Use a CLI-provided run label/timestamp arg.)

**Task 1.4 — CLI entrypoint** (`scripts/matching-lab/replay/index.ts`):
- `bun run scripts/matching-lab/replay/index.ts --a configs/prod.json --b configs/full-rerank.json [--account ...] [--no-rerank-a]`
- Ship 3 checked-in variant configs: `prod.json` (current defaults), `full-rerank.json` (`blendWeight: 1.0`), `analysis-doc.json` (`documentMode: "analysis"`).

**Task 1.5 — Unit tests** for metrics + diff logic (pure functions, vitest, `scripts/matching-lab/replay/__tests__/`). The engine itself is exercised manually against local Supabase like the rest of matching-lab; don't mock the world.

**Exit criteria:** `bun run .../replay --a prod --b full-rerank` prints a rank-diff table and metric summary from real local `match_decision` data.

### Phase 2 — Reranker document fix: analysis text (~half day)

**Task 2.1 — Analysis text loader.** Batch-fetch `song_analysis.analysis` for matched song ids and flatten to prose. Reuse the flattening logic in `EmbeddingService.buildEmbeddingText()` (`src/lib/domains/enrichment/embeddings/service.ts:426-503`) — extract it into a shared pure function (e.g. `src/lib/domains/enrichment/embeddings/analysis-text.ts`) rather than duplicating, since reranker docs and embedding docs *should* be the same text (that's also what makes the retriever and reranker see consistent evidence).

**Task 2.2 — Thread analysis text into `rerankMatches`.** Pass a `Map<songId, string>` (analysisText) as a new parameter; document becomes:
`{name} by {artists}. Genres: {genres}.\n\n{analysisText}` with fallback to the current metadata string when analysis is missing. Truncate the analysis tail to keep docs ≤ ~400 tokens (~1600 chars) — query + template overhead untouched.
- Call sites: `orchestrator.ts` (snapshot refresh) and the rematch path — both already load songs; add the `song_analysis` batch fetch alongside.

**Task 2.3 — Task-specific instruction.** Check (in Task 0.1's probe) whether DeepInfra's endpoint accepts an `instruction` field; if not, prepend it to the query text: `"Given a playlist's mood and theme, judge if this song belongs in it. Playlist: {name} — {description}"`. Make the instruction a `RerankerConfig` field so it's replayable.

**Task 2.4 — Update tests** (`reranking.test.ts`: document construction with/without analysis, truncation, fallback) and the `rerankerConfigHash` input in `cache.ts` so doc-mode/instruction changes produce new `snapshot_hash`es.

**Exit criteria:** snapshot refresh sends rich documents; config hash reflects it; tests green.

### Phase 3 — A/B experiments via the runner (~2h, after Phases 0–2)

Run and record (directional only at current n — say so in the report):

| Experiment | A | B | Expectation from research |
|---|---|---|---|
| E1: blend | `blendWeight: 0.3` | `blendWeight: 1.0` | full rerank wins once docs are rich |
| E2: document | `documentMode: metadata` | `documentMode: analysis` | analysis wins clearly |
| E3: blend mid | winner of E1 | `blendWeight: 0.7` | tie-break |
| E4 (optional): model | `Qwen3-Reranker-0.6B` | `Qwen3-Reranker-4B` | 4B better, decide if worth 2.5× cost |

Primary metric: pairwise win rate; secondary: rank-of-added, nDCG@10. Promote a config to `DEFAULT_RERANKER_CONFIG` only on a consistent directional win across accounts; re-run when n grows.

### Phase 4 — Model decision (research outcome, no code unless E4 runs)

Already resolved by research: **keep `Qwen3-Reranker-0.6B`** — it *is* the matched companion to our Qwen3-Embedding-0.6B retriever and the strongest model at its size (65.80 MTEB-R vs BGE-v2-m3's 57.03). The only candidate change is *up* to 4B (+3.96 nDCG, 3× better instruction-following, $0.025 vs $0.010 per 1M tokens — negligible at our volume). Make `model` a `RerankerConfig` field in Task 0.3 so E4 is runnable; decide on data, not vibes.

---

## Sequencing & risks

```
Task 0.1–0.3 (contract)  ──►  Phase 2 (docs)  ──►  Phase 3 (A/B)
            └──────────►  Phase 1 (runner, parallelizable with Phase 2)
```

- **Risk: reranker was silently dead in prod.** If Task 0.1 confirms the shape mismatch, every existing snapshot's `score` equals `fused_score` — fine, but it means E1/E2 baselines are effectively "no reranker"; frame results accordingly.
- **Risk: tiny n.** All Phase 3 reads are directional; report pair counts and p-values, don't over-claim.
- **Risk: replay drift.** Profiles/embeddings have changed since decisions were made; both variants drift identically, so A/B is fair, but absolute metrics aren't comparable to served behavior.
- **Cost:** worst case (analysis docs, 4B, 50 candidates × ~400 tokens × per playlist) ≈ $0.0005 per playlist rerank. Not a constraint.

## Key references

- Qwen3-Reranker scoring + template: huggingface.co/Qwen/Qwen3-Reranker-0.6B · arXiv 2506.05176 (Table 4 benchmarks)
- DeepInfra contract + pricing: deepinfra.com/Qwen/Qwen3-Reranker-0.6B/api ($0.010/1M, 32K ctx; 4B $0.025/1M)
- Blend vs pure rerank: arXiv 2510.13329 (pure rerank usually wins with strong rerankers)
- Wrong-serving-stack pitfall (inverted scores): vllm-project/vllm#35412
- Offline metrics with implicit feedback at small n: pairwise win rate + binomial test; fin.ai reranker research blog
