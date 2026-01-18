# Change: Port Phase 4 Service Layer (Fresh Port)

## Why

Phase 3 query modules are complete, but the v2 service layer still needs a fresh port from v0 to unlock sync, analysis, and DeepInfra integrations. Phase 4 delivers the core orchestration services without factory indirection so that SSE and UI integration can follow.

## What Changes

- Delete factory modules and update imports to use direct service modules
- Add merged analysis pipeline orchestrator (`analysis/pipeline.ts`) using query modules
- Split playlist sync responsibilities into `PlaylistSyncService` and `SyncOrchestrator`
- Add `DeepInfraService` and route embedding/reranking calls through it

## Impact

- **Affected specs**: `migration-v2`
- **Affected code**: `src/lib/services/**`, server functions, and service imports
- **Dependencies**: Phase 3 query modules, schema alignment decisions
