# Implementation Tasks

## 0. Prerequisites
- [x] 0.1 Add `ML_PROVIDER` and `HF_TOKEN` to `src/env.ts` (both optional).
- [x] 0.2 Confirm local adapter is dev-only and gated by `ML_PROVIDER=local`.

## 1. Provider Port and Errors
- [x] 1.1 Create `src/lib/ml/provider/ports.ts` with the `MLProvider` interface.
- [x] 1.2 Create `src/lib/ml/provider/types.ts` for provider-agnostic results and options (`EmbeddingResult`, `RerankResult`, `EmbedOptions`, `RerankOptions`).
- [x] 1.3 Add `src/lib/shared/errors/domain/ml.ts` for provider-agnostic ML errors.

## 2. Provider Adapters
- [x] 2.1 Create `src/lib/ml/adapters/deepinfra.ts` that wraps `integrations/deepinfra/service.ts` and maps errors to ML domain errors.
- [x] 2.2 Create `src/lib/ml/adapters/huggingface.ts` using `@huggingface/inference` for embeddings and reranking.
- [x] 2.3 Create `src/lib/ml/adapters/local.ts` using `@huggingface/transformers` with dynamic import and a dev-only guard.

## 3. Provider Selection
- [x] 3.1 Create `src/lib/ml/provider/factory.ts` to select provider (explicit `ML_PROVIDER` override, otherwise DeepInfra if key, else HuggingFace).
- [x] 3.2 Add a lazy singleton helper (`getMlProvider`) so consumers share one instance.

## 4. Consumer Updates
- [x] 4.1 Update `src/lib/ml/embedding/service.ts` to call the provider instead of `integrations/deepinfra` and update error unions.
- [x] 4.2 Update `src/lib/ml/reranker/service.ts` to call the provider reranker and handle unavailable providers gracefully.
- [x] 4.3 Update `src/lib/capabilities/matching/semantic.ts` to embed via the provider instead of direct DeepInfra.
- [x] 4.4 Update `src/lib/ml/embedding/model-bundle.ts` to include provider/model metadata in the bundle hash.

## 5. Tests and Scripts
- [x] 5.1 Add `scripts/smoke-tests/ml-providers.ts` to validate availability and basic embed/rerank flows.
- [x] 5.2 Add minimal unit tests for provider selection logic (if test harness exists).

## 6. Dependencies
- [x] 6.1 `bun add @huggingface/inference @huggingface/transformers` (local adapter only).
