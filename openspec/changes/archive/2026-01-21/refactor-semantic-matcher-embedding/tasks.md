# Implementation Tasks

## 0. Prep
- [x] 0.1 Identify all `createSemanticMatcher` call sites and decide whether `EmbeddingService` remains nullable.
- [x] 0.2 Confirm expected prefix for similarity embeddings (default: `"query:"`).

## 1. EmbeddingService extension
- [x] 1.1 Add `embedText(text, options?)` to `EmbeddingService` using the provider, prefix, and dimension validation.
- [x] 1.2 Ensure errors are returned via `Result` and documented alongside existing methods.

## 2. SemanticMatcher refactor
- [x] 2.1 Remove `getMlProvider` usage and call `embeddingService.embedText`.
- [x] 2.2 Update caching flow/comments and keep graceful degradation on provider failure.
- [x] 2.3 Update constructor/type signature if `EmbeddingService` becomes required.

## 3. Call sites and checks
- [x] 3.1 Update any instantiation to pass a real `EmbeddingService` (or explicitly null to disable).
- [x] 3.2 Add/adjust tests or smoke checks if available.
