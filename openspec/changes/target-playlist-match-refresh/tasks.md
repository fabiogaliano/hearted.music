## 1. Database and job plumbing

- [x] 1.1 Add Supabase migrations in `supabase/migrations/*.sql` for the atomic snapshot publish function, `playlist.is_target`, `user_preferences.target_playlist_match_refresh_job_id`, the `target_playlist_match_refresh` job type, the unique active-job index for that type, the new claim/sweep/dead-letter helpers, and the retire-old-enum strategy for `rematch` / `playlist_lightweight_enrichment`.
- [x] 1.2 Update generated database and query surfaces in `src/lib/data/database.types.ts`, `src/lib/domains/library/playlists/queries.ts`, and `src/lib/domains/library/accounts/preferences-queries.ts` to use target-playlist naming.
- [x] 1.3 Add target-playlist refresh job creation, claim, sweep, dead-letter, and rerun-coalescing helpers in `src/lib/data/jobs.ts`.

## 2. Target-playlist refresh workflow

- [x] 2.1 Create `src/lib/workflows/target-playlist-match-refresh/types.ts`, `src/lib/workflows/target-playlist-match-refresh/trigger.ts`, and `src/lib/workflows/target-playlist-match-refresh/planner.ts` for the new plan and request flow.
- [x] 2.2 Create `src/lib/workflows/target-playlist-match-refresh/orchestrator.ts` and `src/lib/workflows/target-playlist-match-refresh/profiles.ts` to execute refreshes against current DB state and cached playlist profiles.
- [x] 2.3 Implement `src/lib/workflows/target-playlist-match-refresh/write-match-snapshot.ts` and extract any shared read/build helpers needed from `src/lib/workflows/enrichment-pipeline/stages/matching.ts` and `src/lib/workflows/enrichment-pipeline/rematch.ts`.

## 3. Candidate-side pipeline refactor

- [x] 3.1 Refactor `src/lib/workflows/playlist-sync/lightweight-enrichment.ts` into target-playlist-song helpers, including the `deleted_at` -> `unliked_at` selector fix and the renamed `selectTargetPlaylistOnlySongs` / `enrichTargetPlaylistSongs` flow.
- [x] 3.2 Remove snapshot publication responsibilities from `src/lib/workflows/enrichment-pipeline/stages/matching.ts` and `src/lib/workflows/enrichment-pipeline/orchestrator.ts` while keeping candidate-side item-status updates intact.
- [x] 3.3 Update `src/lib/workflows/enrichment-pipeline/orchestrator.ts` and `src/lib/workflows/enrichment-pipeline/trigger.ts` so enrichment requests `requestTargetPlaylistMatchRefresh()` only after queue drain when current target playlists need refresh coverage, and no longer exposes `checkAndRematch()`.

## 4. Trigger and worker cutover

- [x] 4.1 Extend `src/lib/workflows/spotify-sync/playlist-sync.ts` and related sync helpers in `src/lib/workflows/spotify-sync/sync-helpers.ts` to report target-playlist-aware create/update/remove facts before destructive writes.
- [x] 4.2 Replace the end-of-sync rematch/lightweight flow in `src/routes/api/extension/sync.tsx` with classified `requestEnrichment()` and `requestTargetPlaylistMatchRefresh()` triggers, including immediate refresh for liked-song removals / target-side changes and enrichment-drain-owned refresh for liked-song additions.
- [x] 4.3 Update `src/lib/server/onboarding.functions.ts` and `src/lib/domains/library/playlists/queries.ts` to save `is_target` state and queue the new refresh/enrichment follow-on work.
- [x] 4.4 Replace rematch/lightweight execution paths in `src/worker/execute.ts`, `src/worker/poll.ts`, and `src/worker/index.ts` with `executeTargetPlaylistMatchRefreshJob()`, drain-triggered rerun behavior, and the new worker priority order.

## 5. Cleanup and verification

- [x] 5.1 Remove obsolete rematch/lightweight modules such as `src/lib/workflows/enrichment-pipeline/rematch.ts` and `src/lib/workflows/playlist-sync/trigger-lightweight-enrichment.ts` after the new workflow is wired end to end.
- [x] 5.2 Add or update tests in `src/lib/workflows/enrichment-pipeline/__tests__/queue-integration.test.ts`, `src/lib/workflows/target-playlist-match-refresh/__tests__/*.test.ts`, and any sync/onboarding test files needed to cover first target selection, liked-song additions refreshing only after drain, liked-song removals, metadata-only target changes, target removal with remaining targets, all-target removal empty snapshots, selector exclusion of currently liked songs, coalesced reruns, single-publisher behavior, and unchanged-`contextHash` no-op refreshes.
- [x] 5.3 Run `bun run test` and verify the new migrations plus worker flow behave correctly for refresh no-op, empty-snapshot, target-removal, metadata-only, and enrichment-drain scenarios.
