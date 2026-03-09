## 1. Topology scaffold and move map

- [ ] 1.1 Create the target folder scaffold needed for moved code under `src/lib/domains/`, `src/lib/workflows/`, `src/lib/integrations/`, and `src/lib/platform/`, and document the old→new path mapping in the change or PR description
- [ ] 1.2 Identify every file currently under `src/lib/capabilities/`, `src/lib/data/`, `src/lib/jobs/`, and `src/lib/ml/` that will move in this change, grouped by bounded context and workflow

## 2. Platform and integration relocation

- [ ] 2.1 Move `src/lib/jobs/**/*` to `src/lib/platform/jobs/**/*` using `git mv`, preserving file contents during the move commit
- [ ] 2.2 Move auth modules such as `src/lib/auth-client.ts`, `src/lib/auth.server.ts`, `src/lib/auth-schema.ts`, and `src/lib/auth.ts` into `src/lib/platform/auth/**/*` using `git mv`
- [ ] 2.3 Consolidate provider-facing modules from `src/lib/integrations/*` and `src/lib/ml/{llm,provider,reranker}` into the target `src/lib/integrations/<provider>/*` layout with move-only commits first

## 3. Domain query-module relocation

- [ ] 3.1 Move library query modules from `src/lib/data/{song.ts,liked-song.ts,playlists.ts,accounts.ts,preferences.ts,newness.ts}` into `src/lib/domains/library/**/*` using `git mv`
- [ ] 3.2 Move enrichment query modules from `src/lib/data/{song-analysis.ts,playlist-analysis.ts,song-audio-feature.ts,vectors.ts}` into `src/lib/domains/enrichment/**/*` and `src/lib/domains/taste/**/*` according to the design mapping
- [ ] 3.3 Move matching query access from `src/lib/data/matching.ts` into `src/lib/domains/taste/song-matching/queries.ts` using `git mv`

## 4. Domain and workflow service relocation

- [ ] 4.1 Move `src/lib/capabilities/lyrics/**/*`, `src/lib/capabilities/analysis/**/*`, and `src/lib/capabilities/genre/**/*` into `src/lib/domains/enrichment/**/*` with no behavior changes in the move commit
- [ ] 4.2 Move `src/lib/capabilities/profiling/**/*` and `src/lib/capabilities/matching/**/*` into `src/lib/domains/taste/**/*` with no behavior changes in the move commit
- [ ] 4.3 Move `src/lib/capabilities/sync/**/*` into `src/lib/workflows/spotify-sync/**/*` and `src/lib/capabilities/pipeline/**/*` into `src/lib/workflows/enrichment-pipeline/**/*` using `git mv`

## 5. Import rewrites and legacy folder removal

- [ ] 5.1 Rewrite `@/lib/...` imports across `src/lib`, `src/routes`, `src/features`, `scripts`, and tests to the new paths after move commits land
- [ ] 5.2 Remove emptied legacy folders `src/lib/capabilities`, `src/lib/data`, `src/lib/jobs`, and `src/lib/ml` only after all moved files resolve correctly from their new locations

## 6. Verification and git-history preservation

- [ ] 6.1 Verify the reorganized tree against the OpenSpec topology: bounded contexts under `src/lib/domains`, orchestration under `src/lib/workflows`, providers under `src/lib/integrations`, and infrastructure under `src/lib/platform`
- [ ] 6.2 Verify rename preservation with git tooling (for example `git diff --summary --find-renames`) and split any overly noisy move batch into smaller commits before merge
- [ ] 6.3 Run project validation for the reorganization branch (`bun run typecheck`, `bun run lint`, and targeted tests if imports moved in tested areas) after all import rewrites are complete
