# Replay Runner Variant Configs

Each JSON file describes one variant that can be passed to `--a` or `--b`.

## Reranker provider — prod vs dev

| Mode | How to activate | Reranker model |
|---|---|---|
| **Prod-faithful** | Set `DEEPINFRA_API_KEY` | DeepInfra `Qwen/Qwen3-Reranker-0.6B` (same as production) |
| **Local dev** | `ML_PROVIDER=local` | Local ONNX Qwen3-Reranker-0.6B sidecar |
| **Matching-only** | Neither of the above | No reranker (HuggingFace fallback has no reranker) |

```sh
# Prod-faithful (recommended for results that mirror production):
DEEPINFRA_API_KEY=<key> bun run scripts/matching-lab/replay/index.ts \
  --a configs/metadata-doc.json --b configs/analysis-doc.json

# Local dev (keyless, uses Python ONNX sidecar):
ML_PROVIDER=local bun run scripts/matching-lab/replay/index.ts \
  --a configs/metadata-doc.json --b configs/analysis-doc.json

# Matching-only (no API key, no local sidecar — harness still works):
bun run scripts/matching-lab/replay/index.ts \
  --a configs/metadata-doc.json --b configs/analysis-doc.json
```

The CLI prints which provider/model was selected at the start of each run,
and records `meta.rerankerProvider` + `meta.rerankerModel` in the result JSON.

## Configs

| File | Label | blendWeight | documentMode | Purpose |
|---|---|---|---|---|
| `prod.json` | `prod` | 0.3 | analysis | Current production behavior (analysis docs, 70/30 blend) |
| `legacy-prod.json` | `legacy-prod` | 0.3 | metadata | Pre-improvement baseline: metadata-only doc (the config the silent-outage era ran) |
| `full-rerank.json` | `full-rerank` | 1.0 | analysis | Full reranker signal, rich analysis document |
| `analysis-doc.json` | `analysis-doc` | 0.3 | analysis | Same blend as legacy-prod but with analysis text as document |
| `metadata-doc.json` | `metadata-doc` | 0.3 | metadata | Explicit metadata baseline (same behavior as legacy-prod) |

All variants implicitly share the canonical rerank instruction
(`DEFAULT_RERANK_INSTRUCTION` — the `RerankerConfig` schema default), so replay
runs are instruction-faithful to production unless a config overrides it.

## Experiment Pairings (Phase 3)

| Experiment | A | B | Tests |
|---|---|---|---|
| **E1: document** | `metadata-doc` | `analysis-doc` | Does rich analysis text improve reranker signal? |
| **E2: blend** | `analysis-doc` | `full-rerank` | Does blendWeight=1.0 beat 0.3 once docs are rich? |

Run both with:
```sh
ML_PROVIDER=local bun run scripts/matching-lab/replay/index.ts \
  --a configs/metadata-doc.json \
  --b configs/analysis-doc.json

ML_PROVIDER=local bun run scripts/matching-lab/replay/index.ts \
  --a configs/analysis-doc.json \
  --b configs/full-rerank.json
```

## Config shape

```json
{
  "label": "my-variant",
  "documentMode": "metadata" | "analysis",
  "reranker": {
    "enabled": true,
    "blendWeight": 0.3,
    "topN": 50,
    "minScoreThreshold": 0.2,
    "model": "Qwen/Qwen3-Reranker-0.6B",
    "instruction": "Given a playlist's mood and theme, judge if this song belongs in it."
  },
  "matching": {
    "minScoreThreshold": 0.35
  }
}
```

All fields except `label` are optional. Omitted fields fall back to service defaults
(including `instruction`, which defaults to the canonical `DEFAULT_RERANK_INSTRUCTION`).
Set `"reranker": { "enabled": false }` (or pass `--no-rerank-a`) to run matching-only.
