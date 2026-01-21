## Context

The matching pipeline currently calls DeepInfra directly for embeddings and reranking. After the services reorg, ML logic now lives under `src/lib/ml`, but it is still provider-specific. We want a provider abstraction that keeps the pipeline stable while supporting multiple ML backends.

## Goals / Non-Goals

**Goals**
- Support multiple ML providers (DeepInfra, HuggingFace API, local) behind a single interface.
- Make provider selection explicit and predictable via environment configuration.
- Keep caching safe by including provider/model metadata in model bundle hashes.
- Minimize call-site churn in embedding, reranking, and semantic matching.

**Non-Goals**
- Changing the matching algorithm or scoring weights.
- Migrating or rewriting existing embeddings or profiles.
- Introducing UI changes or new product features.

## Decisions

- Create an `MLProvider` port under `src/lib/ml` with `embed`, `embedBatch`, `rerank`, and `isAvailable` methods.
- Implement provider adapters in `src/lib/ml/adapters` for DeepInfra, HuggingFace API, and local models.
- Add `ML_PROVIDER` as an explicit override; when unset, default to DeepInfra if `DEEPINFRA_API_KEY` is present, otherwise HuggingFace API.
- Map provider-specific failures to a small set of ML domain errors so consumers do not depend on provider error types.
- Update model bundle hashing to include provider, model, and embedding dimensions.
- Local adapter is opt-in and loaded dynamically when `ML_PROVIDER=local` to avoid worker bundle impact.

## Risks / Trade-offs

- Different providers may produce different embeddings even with the same model name; we must treat provider changes as cache invalidating.
- HuggingFace API has stricter rate limits; the plan relies on optional `HF_TOKEN` for higher quotas.
- Local models are large; dynamic import is required to keep worker bundles small.

## Migration Plan

1. Add ML provider types, ports, and error mapping.
2. Implement adapters (deepinfra, huggingface, local).
3. Add provider factory and env config.
4. Update embedding, reranker, and semantic matcher to use the provider.
5. Update model bundle hashing to include provider metadata.
6. Add smoke tests for provider availability.

## Open Questions

- Should HuggingFace API be allowed without `HF_TOKEN`, or should we require it explicitly?
- Do we want to exclude the local adapter from production builds entirely, or just gate by env?
