## 1. Playlist domain persistence helpers

- [ ] 1.1 Add a focused playlist metadata update helper in `src/lib/domains/library/playlists/queries.ts` so acknowledged `name` / `description` writes can update an existing playlist row without overwriting unrelated fields.
- [ ] 1.2 Reuse the existing `upsertPlaylists(...)`, `getPlaylistBySpotifyId(...)`, and `deletePlaylist(...)` paths in `src/lib/domains/library/playlists/queries.ts` for playlist create/delete acknowledgement behavior, adding only the smallest extra helper logic needed.

## 2. Server acknowledgement boundary

- [ ] 2.1 Create `src/lib/server/playlists.functions.ts` with authenticated, Zod-validated server functions for acknowledged playlist create, metadata update, and delete outcomes.
- [ ] 2.2 Implement account-scoped URI/result validation in `src/lib/server/playlists.functions.ts`, including deriving `spotify_id` from create/delete playlist URIs and treating delete acknowledgement as idempotent when the row is already absent.
- [ ] 2.3 Add tests in `src/lib/server/__tests__/playlists.functions.test.ts` covering create visibility, metadata persistence, delete behavior, delete idempotency, and cross-account safety.

## 3. Browser-side orchestration helper

- [ ] 3.1 Add a browser-side helper such as `src/lib/extension/playlist-write-acknowledgement.ts` that composes `src/lib/extension/spotify-client.ts` command execution with the new server acknowledgement functions for create, update, and delete.
- [ ] 3.2 Add tests in `src/lib/extension/__tests__/playlist-write-acknowledgement.test.ts` covering success sequencing, failed-command short-circuiting, and acknowledgement failure handling.

## 4. Sync reconciliation confidence

- [ ] 4.1 Extend `src/lib/workflows/spotify-sync/__tests__/playlist-sync.test.ts` or equivalent coverage so acknowledged playlist rows remain stable under later sync reconciliation instead of being duplicated.
- [ ] 4.2 Verify that acknowledged playlist creates/updates/deletes remain aligned with the current sync upsert/delete behavior in `src/lib/workflows/spotify-sync/playlist-sync.ts` and `src/routes/api/extension/sync.tsx`.

## 5. Validation

- [ ] 5.1 Run `bun run test` and the smallest relevant targeted checks for `src/lib/server/playlists.functions.ts`, `src/lib/extension/playlist-write-acknowledgement.ts`, and playlist sync reconciliation before applying the change.
