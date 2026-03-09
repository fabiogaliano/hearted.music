## 1. Define command and client contracts

Execution/dependency note: groups 1 → 2 → 3 → 4 are the primary implementation sequence; task 2.5 (raw contract docs) can run in parallel with group 1 because it is documentation-first and based on existing `extension/PATHFINDER-MUTATIONS.md` artifacts.

- [x] 1.1 Extend shared extension message/response types in `extension/src/shared/types.ts` with typed Spotify command payloads, caller-generated `commandId` (UUID) semantics, optional `protocolVersion`, result envelopes, and stable error codes.
- [x] 1.2 Add or update shared Spotify client method types in `extension/src/shared/spotify-client/types.ts` (create if missing) for v1 reads/writes, including artist overview/image lookup, and typed unsupported-operation errors for truly out-of-scope commands.
- [x] 1.3 Add regression type checks by running TypeScript on extension sources to verify command and client contracts compile.

## 2. Implement extension Spotify client modules

- [x] 2.1 Extract existing Pathfinder read logic from `extension/src/background/service-worker.ts` into `extension/src/shared/spotify-client/reads.ts` using `extension/src/shared/pathfinder.ts`.
- [x] 2.2 Implement Pathfinder mutation methods (`addToPlaylist`, `removeFromPlaylist`) in `extension/src/shared/spotify-client/mutations.ts` with hash-registry-backed execution.
- [x] 2.3 Implement Playlist v2 operations (`createPlaylist`, `updatePlaylist`, `deletePlaylist`) in `extension/src/shared/spotify-client/playlist-v2.ts` with centralized `spclient` host resolver (primary + deterministic fallback) and retry handling.
- [x] 2.4 Compose exported client facade in `extension/src/shared/spotify-client/client.ts` and verify read/write methods return normalized typed results.
- [x] 2.5 Add raw request/response object contract documentation for each supported operation in `extension/PATHFINDER-MUTATIONS.md` (or linked fixture docs) before mapper/DTO transforms.
- [x] 2.6 Implement conservative batching behavior in client modules: use known native multi-item payloads, otherwise sequential execution with pacing.
- [x] 2.7 Implement `queryArtistOverview` (or documented internal equivalent) in extension read client modules and expose typed artist-image metadata results.

## 3. Refactor service worker into command executor

- [x] 3.1 Refactor `extension/src/background/service-worker.ts` to delegate Spotify API operations to the new client modules instead of inline request construction.
- [x] 3.2 Add external command handlers in `extension/src/background/service-worker.ts` for sync + Spotify write commands with token precondition checks.
- [x] 3.3 Ensure command responses from `extension/src/background/service-worker.ts` always use the normalized envelope (`ok`, `data` or typed error metadata) and echo `commandId`.
- [x] 3.4 Validate manual extension command flows from web app messaging (`PING`, `CONNECT`, sync trigger, write commands) against the refactored handler paths.

## 4. Add browser proxy SDK and write outcome persistence flow

- [x] 4.1 Create app-side extension Spotify proxy methods in `src/lib/extension/spotify-client.ts` (or equivalent under `src/lib/extension/`) that generate `commandId` and send typed commands to the extension.
- [x] 4.2 Update `src/lib/extension/detect.ts` (or adjacent messaging module) to expose typed command send helpers and normalize error mapping.
- [x] 4.3 Refactor write call sites to browser-initiated flow (`client -> extension`) and remove assumptions that server functions directly perform Spotify writes.
- [x] 4.4 Replace `addSongToPlaylist` direct-write semantics in `src/lib/server/liked-songs.functions.ts` with server acknowledgement/update handlers invoked after extension command results.
- [x] 4.5 Add tests for app-side command serialization, response handling, and DB acknowledgement triggering in relevant `src/lib/extension/__tests__/` and server-function tests.
- [x] 4.6 Migrate artist-image retrieval call sites (including `src/routes/api/artist-images-for-tracks.tsx` and consumers) from server app-auth Spotify API usage to browser→extension command flow using the new artist overview support.

## 5. Validation and operational hardening

- [x] 5.1 Add extension-side unit tests for command routing and Spotify client behavior in `extension/src/**/__tests__/*` with mocked `chrome.*` globals and mocked fetch.
- [x] 5.2 Add an on-demand live contract test suite (for example `extension/src/**/__tests__/live-contract*.test.ts`) that is skipped by default and runs only via explicit command.
- [x] 5.3 Add scripts/docs for opt-in live contract execution (for example dedicated bun script + required env/token prerequisites) and keep it out of default CI/local test runs.
- [x] 5.4 Validate that sync-only behavior remains intact by exercising existing sync entry points in `extension/src/background/service-worker.ts` and `/api/extension/sync` integration.
- [x] 5.5 Update extension technical docs (`extension/PATHFINDER-MUTATIONS.md` and/or extension architecture docs) with final command protocol, supported operation list (including artist overview/image lookup), and explicit out-of-scope operation notes.
- [x] 5.6 Run `openspec validate add-extension-spotify-client-sdk --strict --no-interactive` and resolve any schema/spec/task validation issues.
