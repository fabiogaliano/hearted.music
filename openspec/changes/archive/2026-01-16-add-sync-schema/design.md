## Context
Migration v2 schema is documented but not yet codified in OpenSpec as actionable requirements for core Spotify entities and sync checkpoints.

## Goals / Non-Goals
- Goals:
  - Formalize core Spotify tables and constraints in OpenSpec.
  - Define how sync checkpoints are stored in `job.progress` for incremental sync (liked songs + playlists).
- Non-Goals:
  - Implement Result-based services or data modules.
  - Define matching or analysis pipelines.

## Decisions
- Decision: Core Spotify entities are modeled as `song`, `playlist`, `liked_song`, `playlist_song` per migration v2 naming.
- Decision: Sync checkpoints are stored in `job.progress` per account + sync type to resume incremental sync.

## Risks / Trade-offs
- Coupling checkpoints to job rows -> Mitigate by keeping the latest sync job per account + type.

## Migration Plan
1. Add migrations for core tables.
2. Add sync checkpoint storage strategy.
3. Regenerate types.

## Open Questions
- Do we need separate checkpoints for playlists vs liked songs beyond `job.type`?
