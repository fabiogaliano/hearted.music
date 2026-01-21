## ADDED Requirements

### Requirement: Semantic similarity uses EmbeddingService
The system SHALL compute semantic similarity using embeddings produced by EmbeddingService to ensure provider-agnostic behavior and consistent dimensionality validation.

#### Scenario: Semantic similarity embedding path
- **WHEN** SemanticMatcher computes similarity for text pairs
- **THEN** it requests embeddings through EmbeddingService with the configured prefix and validates dimensions before computing cosine similarity
