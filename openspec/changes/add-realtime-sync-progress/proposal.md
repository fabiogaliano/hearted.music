# Change: Add Real-Time Sync Progress with Phase Counts

**Status**: ✅ IMPLEMENTED

## Why

During onboarding sync, users see only a percentage and cannot track progress per phase (liked songs, playlists, playlist tracks). This creates uncertainty about what's happening. By emitting real-time counts during each phase and forwarding final stats to the completion screen, we provide meaningful feedback and display accurate totals in the "Ready" step instead of hardcoded placeholders.

## What Changes

- **Job Progress Schema**: Add optional `count` field to `JobItemEvent` to track per-phase item counts
- **Pagination Callbacks**: Add `onProgress` and `onTotalDiscovered` callbacks to pagination helpers for real-time fetch counts
- **Orchestrator**: Thread progress callbacks through sync methods to emit counts during fetch and final state
- **UI Progress Smoothing**: Add weighted phase interpolation (0-40%, 40-70%, 70-100%) plus lerp-based animation for smooth visual progress
- **Navigation**: Extend `HistoryState` to forward `syncStats` (real song/playlist counts) through onboarding steps
- **Connecting Step**: Reduced artificial delay from 1500ms to 200ms for snappier UX

## Implementation Details

### Progress Calculation Strategy
Instead of adding more backend phases (which would require architectural changes), we implemented **UI-side interpolation**:

1. **Weighted phases**: liked_songs (0-40%), playlists (40-70%), playlist_tracks (70-100%)
2. **Sub-phase interpolation**: Within each phase, progress is calculated as `phase_start + (items_fetched / total_discovered) * phase_range`
3. **Lerp animation**: `useAnimatedNumber` hook smoothly follows the target using linear interpolation at ~60fps

### Key Functions Added
- `getSmoothProgressPercent(state)` - Calculates weighted progress from phase data
- `useAnimatedNumber(target, speed)` - Lerp-based animation hook for smooth number transitions

## Impact

- **Affected specs**:
  - `job-progress` (ADDED: count field in item events)
  - `onboarding` (MODIFIED: Sync Progress Display + Ready Step stats)
- **Affected code**:
  - `src/lib/jobs/progress/types.ts` - count field already existed
  - `src/lib/hooks/useJobProgress.ts` - added itemTotals tracking, getSmoothProgressPercent
  - `src/lib/integrations/spotify/pagination.ts`, `service.ts` - progress callbacks
  - `src/lib/capabilities/sync/orchestrator.ts` - threaded callbacks, emit counts
  - `src/lib/capabilities/sync/playlist-sync.ts` - progress callbacks, fixed image_url
  - `src/features/onboarding/components/SyncingStep.tsx` - animated progress, real counts display
  - `src/features/onboarding/components/ConnectingStep.tsx` - reduced delay
- **No breaking changes**: All new fields optional, existing APIs unchanged
- **Bonus fix**: Playlist images now sync correctly (was missing `image_url` in upsert)
