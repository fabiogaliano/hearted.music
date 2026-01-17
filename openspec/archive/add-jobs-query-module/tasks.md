# Tasks: Add Jobs + Playlists Query Modules

## 1. Implementation

- [x] 1.1 Create `src/lib/data/playlists.ts` with type exports
- [x] 1.2 Implement `getPlaylistById(id: string)`
- [x] 1.3 Implement `getPlaylistBySpotifyId(accountId: string, spotifyId: string)`
- [x] 1.4 Implement `getPlaylists(accountId: string)`
- [x] 1.5 Implement `getDestinationPlaylists(accountId: string)` - where is_destination = true
- [x] 1.6 Implement `upsertPlaylists(playlists: UpsertPlaylistData[])`
- [x] 1.7 Implement `setPlaylistDestination(id: string, isDestination: boolean)`
- [x] 1.8 Implement `deletePlaylist(id: string)`
- [x] 1.9 Implement `getPlaylistSongs(playlistId: string)`
- [x] 1.10 Implement `upsertPlaylistSongs(playlistId: string, songs: UpsertPlaylistSongData[])`
- [x] 1.11 Implement `removePlaylistSongs(playlistId: string, songIds: string[])`
- [x] 1.12 Create `src/lib/data/jobs.ts` with type exports
- [x] 1.13 Define `JobType` union (from DB enum: `'sync_liked_songs' | 'sync_playlists'`)
- [x] 1.14 Define `JobStatus` union: `'pending' | 'running' | 'completed' | 'failed'`
- [x] 1.15 Define `JobProgress` type: `{ total: number; done: number; succeeded: number; failed: number; cursor?: string }`
- [x] 1.16 Implement `getJobById(id: string)`
- [x] 1.17 Implement `getActiveJob(accountId: string, type: JobType)` - latest non-terminal job
- [x] 1.18 Implement `getLatestJob(accountId: string, type: JobType)` - for checkpoint retrieval
- [x] 1.19 Implement `createJob(accountId: string, type: JobType)`
- [x] 1.20 Implement `updateJobProgress(id: string, progress: JobProgress)`
- [x] 1.21 Implement `markJobRunning(id: string)`
- [x] 1.22 Implement `markJobCompleted(id: string)`
- [x] 1.23 Implement `markJobFailed(id: string)`

## 2. Verification

- [x] 2.1 Run `bunx tsc --noEmit` - no errors
- [x] 2.2 Verify destination playlist filtering works (migration applied)
- [x] 2.3 JSONB progress - N/A (standard JSON serialization)

## Notes

### Migration Added

- `20260117030516_add_playlist_is_destination.sql` - Adds `is_destination` boolean column with partial index

### Additional Functions Implemented

- `getJobs(accountId: string, type?: JobType)` - Get all jobs with optional type filter
