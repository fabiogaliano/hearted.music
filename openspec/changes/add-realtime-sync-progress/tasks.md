# Implementation Tasks

**Status**: ✅ COMPLETE

## 1. Job Progress Schema & Helpers

- [x] 1.1 Add `count?: number` field to `JobItemEventSchema` in `src/lib/jobs/progress/types.ts` *(already existed)*
- [x] 1.2 Update `emitItem()` helper to accept & pass `count` parameter in `src/lib/jobs/progress/helpers.ts` *(already supported)*
- [x] 1.3 Verify no existing callers break (count is optional)

## 2. Spotify Service: Add Progress Callbacks

- [x] 2.1 Add `onProgress?: (fetched: number) => void` to pagination in `src/lib/integrations/spotify/pagination.ts`
- [x] 2.2 Add `onTotalDiscovered?: (total: number) => void` callback for discovered totals
- [x] 2.3 Thread callbacks to `getLikedTracks()` in `src/lib/integrations/spotify/service.ts`
- [x] 2.4 Thread callbacks to `getPlaylists()` in `src/lib/integrations/spotify/service.ts`

## 3. Sync Orchestrator: Thread Callbacks

- [x] 3.1 Add `onProgress` and `onTotalDiscovered` options to `syncLikedSongs()` in `orchestrator.ts`
- [x] 3.2 Pass callbacks to `this.spotify.getLikedTracks()`
- [x] 3.3 Add callbacks to `syncPlaylists()` and thread to `playlistSync.syncPlaylists()`
- [x] 3.4 In `fullSync()`, inject callbacks using closure pattern to emit `emitItem(jobId, { count, ... })`
- [x] 3.5 Update final `emitItem()` calls to include final count values
- [x] 3.6 Support external `jobId` parameter for onboarding flow integration

## 4. Onboarding Types & Navigation

- [x] 4.1 Add `SyncStats` interface to `src/features/onboarding/types.ts`
- [x] 4.2 Extend `HistoryState` with `syncStats?: SyncStats`
- [x] 4.3 Update `goToFlagPlaylists()` to accept & forward `syncStats`
- [x] 4.4 Update `goToReady()` to accept & forward `syncStats`

## 5. useJobProgress Hook Enhancements

- [x] 5.1 Add `itemTotals: Map<string, number>` to track discovered totals per phase
- [x] 5.2 Track max count as "discovered total" for smooth progress calculation
- [x] 5.3 Add `getSmoothProgressPercent()` utility with weighted phase interpolation
- [x] 5.4 Clean up debug console.log statements

## 6. SyncingStep Component

- [x] 6.1 Create `useAnimatedNumber` hook for lerp-based smooth animation
- [x] 6.2 Display animated progress percentage using `getSmoothProgressPercent()`
- [x] 6.3 Show real-time counts: "X liked songs found", "Y playlists found"
- [x] 6.4 Extract final counts and forward to `goToFlagPlaylists({ syncStats })`
- [x] 6.5 Add error state handling with "Start Over" recovery

## 7. ConnectingStep Component

- [x] 7.1 Reduce artificial delay from 1500ms to 200ms for snappier UX

## 8. Playlist Sync Bug Fix (Bonus)

- [x] 8.1 Add missing `image_url` field to playlist upsert in `playlist-sync.ts`

## 9. Validation

- [x] 9.1 Type check passes: `bun run typecheck`
- [x] 9.2 Manual test: SSE events show real-time counts
- [x] 9.3 Progress bar animates smoothly without jumps
- [x] 9.4 Playlist images display correctly after sync

## Deferred / Not Implemented

- [ ] ReadyStep stats display (deferred to separate change)
- [ ] FlagPlaylistsStep stats forwarding (deferred to separate change)
- [ ] Spec delta files (specs already captured requirements)
