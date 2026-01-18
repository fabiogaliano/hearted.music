## Context

Phase 4 ports the v0 service layer into the v1 architecture. Query modules are already complete, so services now focus on orchestration and external APIs. The migration should be a fresh port (not refactor) to avoid carrying over repository patterns or factory indirection.

## Goals / Non-Goals

- **Goals**
  - Provide orchestration services for sync and analysis
  - Replace factory modules with direct imports
  - Integrate DeepInfra for embeddings and reranking
  - Keep service boundaries aligned with `docs/migration_v2/02-SERVICES.md`
- **Non-Goals**
  - SSE implementation (Phase 5)
  - UI integration (Phase 7)
  - Changing matching algorithms or LLM prompt content

## Decisions

- **Fresh port**: recreate services in `src/lib/services/` using query modules as the data layer
- **Direct imports**: delete factory files; instantiate services where needed (routes/server fns)
- **Split sync**: `PlaylistSyncService` handles Spotify API sync; `SyncOrchestrator` coordinates jobs
- **DeepInfra gateway**: a single `DeepInfraService` provides embeddings + reranking calls

## Risks / Trade-offs

- Schema alignment decisions may change data module signatures during Phase 4
- Removing factories requires careful import updates across services/routes

## Migration Plan

1. Remove factories + update imports
2. Implement analysis pipeline and update analysis services
3. Implement playlist sync services and update orchestrator
4. Integrate DeepInfra service and remove local vectorization calls
5. Update docs and verify typecheck

## Open Questions

- Confirm final schema alignment before wiring analysis + matching metadata fields
