## REMOVED Requirements

### Requirement: Re-match Operation
**Reason**: The change replaces split rematch ownership with the dedicated `target-playlist-match-refresh` capability as the only profile-side refresh workflow and snapshot publisher.
**Migration**: Use `target-playlist-match-refresh` for full-snapshot publication, empty-snapshot behavior, and refresh triggering semantics.

### Requirement: Re-match is Separate from Pipeline
**Reason**: The old rematch abstraction is retired in favor of a refresh workflow that owns target-playlist-side enrichment, profiling, and publishing under one job type.
**Migration**: Move profile-side follow-on work to `target_playlist_match_refresh` and keep liked-song enrichment focused on candidate-side processing only.

### Requirement: Playlist Change Detection
**Reason**: Playlist-side refresh planning now happens through target-playlist-aware sync and onboarding planners instead of `checkAndRematch` plus latest-context comparison alone.
**Migration**: Use sync/onboarding change classification with execution-time DB reads and `TargetPlaylistRefreshPlan` hints to decide refresh work.

### Requirement: Re-match Trigger Integration
**Reason**: `rematch` background jobs are being removed and replaced by `target_playlist_match_refresh` jobs with coalescing via `rerunRequested`.
**Migration**: Queue `requestTargetPlaylistMatchRefresh()` from sync, onboarding, liked-song-removal flows, and enrichment drain instead of creating rematch jobs.
