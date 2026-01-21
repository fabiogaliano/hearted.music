# Change: Refactor lib structure documentation

## Why

The service layer was reorganized into `capabilities/`, `integrations/`, `ml/`, `jobs/`, and `shared/`, but the specs and migration docs still reference `src/lib/services`. This makes guidance inaccurate and risks new work being added to the wrong locations.

## What Changes

- Update OpenSpec specs to reflect the new module locations (access-spotify-api, matching-pipeline, data-flow).
- Update `openspec/project.md` directory structure and service layer guidance.
- Update migration docs and active change proposals to the new paths.
- Mark the change complete and archive it for history.

## Impact

- **Specs**: `access-spotify-api`, `matching-pipeline`, `data-flow`
- **Docs**: `docs/migration_v2/02-SERVICES.md`, `03-IMPLEMENTATION.md`, `ROADMAP.md`
- **Project context**: `openspec/project.md`
- **Active changes**: `add-matching-pipeline-services`, `add-sse-job-progress`
