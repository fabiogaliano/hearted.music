## Why

Suggestion publishing is currently split across sync-time rematch checks, a lightweight playlist enrichment job, and the liked-song enrichment pipeline. That split ownership makes the latest `match_context` hard to trust because duplicate refreshes, partial chunk snapshots, and stale naming all make correctness and maintenance harder.

## What Changes

- Introduce a dedicated `target_playlist_match_refresh` workflow and job as the only owner of target-playlist-side refreshes and `match_context` / `match_result` publishing.
- Add an atomic `writeMatchSnapshot` publish path that writes either a full current snapshot or an explicit empty snapshot when no target playlists remain.
- Keep the liked-song enrichment pipeline focused on candidate enrichment and item-status tracking, and have it request a target-playlist refresh only after the queue drains.
- Replace `checkAndRematch`, top-level lightweight-enrichment job orchestration, and old `rematch` / `playlist_lightweight_enrichment` job types with one target-playlist refresh flow.
- Rename destination/rematch terminology in database fields, job helpers, and workflow entry points to target-playlist terminology.
- Update sync and onboarding planning so liked-song-side changes and target-playlist-side changes trigger the correct follow-on work.

## Capabilities

### New Capabilities
- `target-playlist-match-refresh`: Rebuild and publish the full current suggestion snapshot for the active target playlist set, including lightweight target-playlist-song enrichment when needed and explicit empty snapshots when the target set becomes empty.

### Modified Capabilities
- `background-enrichment-worker`: Enrichment jobs stop publishing snapshots, request target-playlist refresh after drain, and add worker handling for the dedicated refresh job type.
- `extension-data-pipeline`: Sync classifies liked-song-side vs target-playlist-side changes and queues enrichment and refresh work separately.
- `matching-pipeline`: Snapshot publication becomes atomic and refresh-owned instead of chunk-owned, while reused matching helpers stay available for the refresh workflow.
- `onboarding`: Saving target playlists triggers the new refresh workflow for first-time target selection without blocking onboarding progression.
- `re-matching`: Existing rematch behavior and terminology are retired in favor of the target-playlist refresh ownership model.

## Affected specs

- New spec: `target-playlist-match-refresh`
- Modified spec: `background-enrichment-worker`
- Modified spec: `extension-data-pipeline`
- Modified spec: `matching-pipeline`
- Modified spec: `onboarding`
- Modified spec: `re-matching`

## Impact

- Affected code: `src/lib/workflows/enrichment-pipeline/*`, `src/lib/workflows/playlist-sync/*`, `src/lib/workflows/target-playlist-match-refresh/*`, `src/routes/api/extension/sync.tsx`, `src/lib/server/onboarding.functions.ts`, `src/lib/data/jobs.ts`, `src/lib/domains/library/accounts/preferences-queries.ts`, `src/worker/*`
- Affected data model: `playlist.is_destination` rename to `playlist.is_target`, `user_preferences.rematch_job_id` rename to `user_preferences.target_playlist_match_refresh_job_id`, new `target_playlist_match_refresh` job enum and helper functions, retired old enum values
- Affected systems: sync planning, onboarding playlist selection, background enrichment worker, target-playlist profile refresh, atomic match snapshot publication
