## Why

The current `src/lib` layout reflects implementation history (`capabilities`, `data`, `jobs`, `ml`, plus ad hoc root modules) instead of stable product boundaries. As Hearted grows into listener profiles, smart playlists, cross-platform imports, and narrative features, the existing layout makes it harder to place new code, reason about ownership, and reorganize modules without high-churn diffs.

## What Changes

- Define a canonical `src/lib` topology built around `domains/`, `workflows/`, `integrations/`, `platform/`, and `shared/`
- Re-home existing sync, enrichment, matching, profiling, data, jobs, and ML modules into bounded contexts that describe business ownership instead of historical implementation layers
- Separate orchestration entrypoints into explicit workflow folders such as `src/lib/workflows/spotify-sync` and `src/lib/workflows/enrichment-pipeline`
- Keep provider adapters under `src/lib/integrations/*` and cross-cutting infrastructure under `src/lib/platform/*`
- Reserve future bounded contexts such as `curation` and `narrative` as placement rules in the topology without requiring placeholder implementation files in this change
- **BREAKING (internal only)**: retire location contracts that point at `src/lib/capabilities`, `src/lib/data`, `src/lib/jobs`, and `src/lib/ml`, and update `@/lib/...` imports to the new topology
- Execute the migration as a move-first refactor using `git mv` and mechanical import rewrites so git history remains attributable and the reorganization does not get buried inside behavior changes

## Capabilities

### New Capabilities
- `lib-module-topology`: Canonical source layout and dependency boundaries for `src/lib`, including bounded contexts, workflows, integrations, platform infrastructure, and shared utilities

### Modified Capabilities
- `data-flow`: Move job lifecycle ownership from `src/lib/jobs` into `src/lib/platform/jobs` under the new topology
- `matching-pipeline`: Update module location requirements from `capabilities` and `ml` folders to bounded-context domains plus workflow and integration boundaries
- `migration-v2`: Update query-module and orchestration location requirements to the bounded-context topology

## Affected specs

- New: `lib-module-topology`
- Modified: `data-flow`, `matching-pipeline`, `migration-v2`

## Impact

- `src/lib/capabilities/**/*`, `src/lib/data/*.ts`, `src/lib/jobs/**/*`, `src/lib/ml/**/*`, and selected root `src/lib/*.ts` files will be moved in phased batches
- Internal imports across routes, server functions, scripts, tests, and UI loaders will change mechanically to the new `@/lib/...` paths
- Architecture docs and OpenSpec location contracts will be updated to match the new source topology
- No external API contract, database schema, or intended user-visible behavior changes are part of the initial reorganization
