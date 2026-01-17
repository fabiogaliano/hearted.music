# Tasks: Add Songs Query Module

## 1. Implementation

- [x] 1.1 Create `src/lib/data/songs.ts` with type exports
- [x] 1.2 Implement `getSongById(id: string)`
- [x] 1.3 Implement `getSongBySpotifyId(spotifyId: string)`
- [x] 1.4 Implement `getSongsBySpotifyIds(spotifyIds: string[])`
- [x] 1.5 Implement `upsertSongs(songs: UpsertSongData[])`
- [x] 1.6 Implement `getLikedSongs(accountId: string)`
- [x] 1.7 Implement `upsertLikedSongs(accountId: string, likedSongs: UpsertLikedSongData[])`
- [x] 1.8 Implement `softDeleteLikedSong(accountId: string, songId: string)`
- [x] 1.9 Implement `getPendingLikedSongs(accountId: string)` - songs with status NULL
- [x] 1.10 Implement `updateLikedSongStatus(accountId: string, songId: string, status: string)`

## 2. Verification

- [x] 2.1 Run `bun tsc --noEmit` - no errors
- [x] 2.2 Verify Result wrappers work correctly with array returns
- [x] 2.3 Smoke test passes: `bun scripts/smoke-tests/songs-data.ts`
