## Context

`src/lib/services` was split into domain-oriented folders: `capabilities` (business logic), `integrations` (external APIs), `ml` (model-specific logic), `jobs` (job lifecycle/progress), and `shared` (errors/utils). Specs and docs still point to the old structure.

## Goals / Non-Goals

**Goals**
- Align specs and migration docs with the current lib layout.
- Clarify where to place new modules going forward.
- Preserve historical context by archiving this change.

**Non-Goals**
- Move or rename code (already completed).
- Change runtime behavior or APIs.

## Decisions

- Update specs and docs to use the new module layout.
- Add explicit requirements for module locations where specs mention paths.
- Archive the change immediately after applying doc/spec updates.

## Mapping (old → new)

- `services/analysis` → `capabilities/analysis`
- `services/matching` → `capabilities/matching`
- `services/genre` → `capabilities/genre`
- `services/profiling` → `capabilities/profiling`
- `services/sync` → `capabilities/sync`
- `services/lyrics` → `capabilities/lyrics`
- `services/spotify` → `integrations/spotify`
- `services/deepinfra` → `integrations/deepinfra`
- `services/lastfm` → `integrations/lastfm`
- `services/reccobeats` → `integrations/reccobeats`
- `services/audio` → `integrations/audio`
- `services/embedding` → `ml/embedding`
- `services/reranker` → `ml/reranker`
- `services/llm` → `ml/llm`
- `services/job-lifecycle.ts` → `jobs/lifecycle.ts`
- `utils/*` → `shared/utils/*`
- `errors/*` → `shared/errors/*`
