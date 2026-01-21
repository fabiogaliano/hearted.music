## ADDED Requirements

### Requirement: ML Provider Abstraction

The system SHALL route embedding and reranking through a provider-agnostic ML interface.

#### Scenario: Explicit provider override
- **WHEN** `ML_PROVIDER` is set
- **THEN** the ML provider SHALL use the specified backend regardless of other keys

#### Scenario: Default provider selection
- **WHEN** `ML_PROVIDER` is not set
- **THEN** the ML provider SHALL use DeepInfra if `DEEPINFRA_API_KEY` is present
- **AND** fall back to HuggingFace API otherwise

#### Scenario: Provider metadata exposure
- **WHEN** using an ML provider
- **THEN** the provider SHALL expose its name, model identifier, and embedding dimensions

---

### Requirement: Cache Safety Across Providers

The system SHALL include provider/model metadata in model bundle hashing to avoid cache collisions.

#### Scenario: Provider or model change
- **WHEN** the embedding provider or model changes
- **THEN** the model bundle hash SHALL change and previously cached embeddings/profiles SHALL be considered stale

---

### Requirement: Local Provider Safety

The system SHALL keep local ML providers opt-in and isolate them from production bundles.

#### Scenario: Local provider gated by env
- **WHEN** `ML_PROVIDER` is not `local`
- **THEN** local model code SHALL NOT be loaded or initialized
