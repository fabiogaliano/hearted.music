# Change: Add ML Provider Abstraction

## Why

Embedding, reranking, and semantic similarity are hard-coded to DeepInfra, which blocks local development without keys and limits experimentation. A provider abstraction lets us switch between DeepInfra (prod), HuggingFace API (dev), and local models while keeping the matching pipeline stable and cache-safe.

## What Changes

- Introduce an ML provider port and adapters under `src/lib/ml` (deepinfra, huggingface, local).
- Add provider selection via env (`ML_PROVIDER`, `HF_TOKEN`) with explicit override behavior.
- Update embedding, reranker, and semantic matcher to call the provider instead of direct DeepInfra.
- Include provider metadata in model bundle hashing to prevent cache collisions across models.
- Add a smoke test script for provider availability and basic embedding/rerank flows.

## Impact

- Affected specs: `matching-pipeline`
- Affected code:
  - `src/lib/ml/*`
  - `src/lib/capabilities/matching/semantic.ts`
  - `src/lib/integrations/deepinfra/service.ts` (adapter wrapper)
  - `src/env.ts`
- Dependencies: `@huggingface/inference`, `@huggingface/transformers` (local adapter only)
