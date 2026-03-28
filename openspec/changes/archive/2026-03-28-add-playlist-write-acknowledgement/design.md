## Context

The current codebase already has the browser-side half of playlist-level Spotify writes:

- `src/lib/extension/spotify-client.ts` exposes `createPlaylist(...)`, `updatePlaylist(...)`, and `deletePlaylist(...)`.
- `shared/spotify-command-protocol.ts` defines the typed command envelopes used to reach the extension.
- `extension/src/background/command-handler.ts` routes those commands to Playlist v2 execution in `extension/src/shared/spotify-client/playlist-v2.ts`.

The app-side persistence half is still missing for playlist rows. The inspected playlist data model already exists in `src/lib/domains/library/playlists/queries.ts`, and extension sync already populates it through `src/routes/api/extension/sync.tsx` and `src/lib/workflows/spotify-sync/playlist-sync.ts`. But there is no inspected route-facing server boundary that takes a confirmed playlist-level extension write result and immediately updates the `playlist` table.

That leaves an avoidable gap for a future real `/playlists` route:

- a playlist can be created in Spotify but not appear in app state until later sync
- a playlist can be renamed/edited in Spotify but app reads may still show stale metadata until later sync
- a playlist can be deleted in Spotify but remain visible in app state until later sync

This is a good fit for a small foundational change because the existing architecture already points toward a two-step write model. The archived extension-client change documents the same split: browser command execution first, server acknowledgement second. The current top-level spec in `openspec/specs/extension-data-pipeline/spec.md` also already expects write outcomes to be persisted through a server acknowledgement step.

## Goals / Non-Goals

**Goals:**
- Add a clean playlist-level acknowledgement flow for extension-executed writes.
- Cover playlist create, playlist metadata update (`name`, `description`), and playlist delete.
- Keep Spotify writes in the browser extension; the server acknowledgement layer only persists confirmed outcomes into canonical app DB state.
- Reuse existing playlist-domain primitives in `src/lib/domains/library/playlists/queries.ts` where possible.
- Give future `/playlists` UI work an immediate, query-backed source of truth instead of requiring a later sync to make playlist-level writes visible.
- Keep extension sync as reconciliation/repair after the fact.

**Non-Goals:**
- Acknowledging playlist-item writes (`addToPlaylist`, `removeFromPlaylist`) into `playlist_song` in this change.
- Designing or implementing delayed/coalesced target-refresh scheduling.
- Implementing the `/playlists` route itself.
- Moving Spotify execution to the backend.
- Introducing new worker, queue, or migration infrastructure unless implementation proves it is absolutely required.

## Decisions

### Decision: Create a dedicated playlist acknowledgement server module

Add a dedicated server boundary in `src/lib/server/playlists.functions.ts` rather than overloading `src/lib/server/onboarding.functions.ts` or `src/lib/server/matching.functions.ts`.

This new module should own the authenticated acknowledgement handlers for:

- playlist create outcome acknowledgement
- playlist metadata update acknowledgement
- playlist delete outcome acknowledgement

Rationale:
- `src/lib/server/onboarding.functions.ts` is onboarding-scoped and already mixes playlist target selection with onboarding progression.
- `src/lib/server/matching.functions.ts` is for matching-session read/write behavior and is the wrong domain boundary for playlist row persistence.
- a dedicated playlist server module cleanly matches the domain in `src/lib/domains/library/playlists/queries.ts`

Alternative considered: putting acknowledgement handlers in a generic extension or sync module. Rejected because the state being mutated is the app's playlist domain, not the extension transport itself.

### Decision: Keep the write split exactly two-step: extension executes, server acknowledges

The browser remains responsible for calling `src/lib/extension/spotify-client.ts` and receiving a typed success/failure result from the extension. Only after a successful command does the app call the server acknowledgement boundary.

Rationale:
- matches the current execution-context reality: `chrome.runtime.sendMessage` is browser-only
- preserves the extension as the only Spotify write executor
- keeps the server authoritative only for app DB state

Alternative considered: server-side Spotify writes. Rejected because that contradicts the inspected extension architecture.

### Decision: Reuse existing playlist upsert/delete primitives and add one focused metadata update helper

The existing playlist data module already gives us most of what this change needs:

- `getPlaylistBySpotifyId(accountId, spotifyId)`
- `upsertPlaylists(accountId, playlists)`
- `deletePlaylist(id)`

Implementation should therefore:
- reuse `upsertPlaylists(...)` for create acknowledgement
- reuse `getPlaylistBySpotifyId(...)` plus `deletePlaylist(...)` for delete acknowledgement
- add one focused helper in `src/lib/domains/library/playlists/queries.ts` for updating playlist metadata without overwriting unrelated fields

Rationale:
- smallest change that fits the existing domain shape
- avoids inventing a second write path for playlist rows
- preserves one playlist data home

Alternative considered: building all acknowledgement persistence inline in server functions. Rejected because it would duplicate playlist-domain persistence logic.

### Decision: Create acknowledgement writes a provisional but canonical playlist row

The current extension create result returns only `{ uri, revision }`, while the create request itself provides the playlist `name`. It does not return full metadata like image URL or track count.

So create acknowledgement should persist a provisional-but-canonical row using only fields known at acknowledgement time:

- derive `spotify_id` from the returned `spotify:playlist:<id>` URI
- `name` from the create request
- `description` as `null`
- `song_count` as `0`
- `image_url` as `null`
- `is_target` as `false`
- keep other optional metadata aligned with current domain conventions unless a later implementation proves a better default is required

Later extension sync can enrich non-essential fields without duplicating the row because `upsertPlaylists(...)` already keys on `(account_id, spotify_id)`.

Rationale:
- makes the new playlist visible immediately
- avoids waiting for sync just to surface creation
- stays honest about which fields are actually known at create-confirmation time

Alternative considered: forcing a sync after create before showing the playlist. Rejected because it preserves the stale-state UX problem this change is meant to solve.

### Decision: Delete acknowledgement is idempotent at the app-state layer

Delete acknowledgement should remove the playlist row immediately if present. If the row is already gone, the server acknowledgement should treat that as a no-op success for app-state persistence.

Rationale:
- safer under retries and race conditions with later sync
- reduces edge-case failure noise for a state that is already reconciled correctly

Alternative considered: treating missing-row delete acknowledgement as an error. Rejected because absence is already the desired final state.

### Decision: Keep playlist-item write acknowledgement out of scope

This change should not cover `addToPlaylist(...)` or `removeFromPlaylist(...)` acknowledgement into `playlist_song`.

Rationale:
- playlist-item writes involve membership rows, ordering, and item-removal identifiers (`uids`), which are a separate complexity level from playlist-row create/update/delete
- keeping this change playlist-level only makes it easier to ship and gives `/playlists` the row-consistency foundation it needs first

Alternative considered: generic acknowledgement for all playlist-related writes now. Rejected because it would mix playlist-row persistence with playlist membership synchronization and make the foundational change much larger.

## Risks / Trade-offs

- [Create acknowledgement only knows partial playlist metadata] → Persist a provisional row immediately and rely on later extension sync to enrich non-essential fields like image URL.
- [Returned create/delete identifiers need parsing from Spotify URI form] → Keep URI parsing small and local to the playlist acknowledgement boundary, with strict validation before DB writes.
- [Future `/playlists` UI may want a single browser helper rather than raw two-step calls] → Allow implementation to add a small browser-side orchestration helper near `src/lib/extension/spotify-client.ts`, but keep the capability centered on the server acknowledgement boundary.
- [Delete acknowledgement can race with sync] → Make delete acknowledgement idempotent and continue using sync as reconciliation.
- [Scope creep into playlist-item writes] → Keep `addToPlaylist` / `removeFromPlaylist` explicitly out of this change.

## Migration Plan

1. Add the focused playlist metadata update helper in `src/lib/domains/library/playlists/queries.ts` and reuse existing playlist upsert/delete helpers for create/delete acknowledgement.
2. Add authenticated acknowledgement functions in `src/lib/server/playlists.functions.ts` with Zod-validated payloads for create, update, and delete outcomes.
3. If implementation benefits from it, add a thin browser-side orchestration helper near `src/lib/extension/spotify-client.ts` that performs command execution first and acknowledgement second.
4. Add tests for server acknowledgement behavior covering create visibility, metadata updates, delete idempotency, and account scoping.
5. Validate that later sync remains reconciliation only and does not create duplicate playlist rows after acknowledged creates.

Rollback is straightforward because this change is additive. If needed, callers can stop invoking the new acknowledgement handlers and fall back to sync-only reconciliation while leaving the extension write path intact.

## Open Questions

- No design-blocking open questions remain for the OpenSpec artifacts.
- Implementation can choose whether the browser-side two-step orchestration lives directly in future route code or in a small helper module, as long as the server acknowledgement boundary remains the source of canonical app-state persistence.
