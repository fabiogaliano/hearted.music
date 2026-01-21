# Change: Refactor SemanticMatcher to use EmbeddingService

## Why
SemanticMatcher currently guards on EmbeddingService presence but embeds via the provider directly. This creates ambiguous behavior and bypasses EmbeddingService’s model/dimension validation. Centralizing embeddings through EmbeddingService keeps provider abstraction consistent and future-proof.

## What Changes
- Add a raw-text embedding method to EmbeddingService (no DB writes).
- Update SemanticMatcher to call EmbeddingService for embeddings and remove direct provider access.
- Update instantiation sites to pass EmbeddingService (or explicitly disable semantic matching).
- Adjust any tests or smoke checks if present.

## Impact
- Affected specs: matching-pipeline
- Affected code: src/lib/ml/embedding/service.ts, src/lib/capabilities/matching/semantic.ts, any SemanticMatcher call sites
