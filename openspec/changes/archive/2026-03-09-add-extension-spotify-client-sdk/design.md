## Context

The extension already performs reverse-engineered Spotify reads through Pathfinder (`fetchLibraryTracks`, `libraryV3`, `fetchPlaylistContents`) and token/hash interception in content scripts. This behavior is currently implemented as ad-hoc functions in `extension/src/background/service-worker.ts`, with only low-level shared helpers in `extension/src/shared/pathfinder.ts`, `extension/src/shared/hash-registry.ts`, and mapping logic in `extension/src/shared/mappers.ts`.

The next step is to replace remaining official SDK/app-auth assumptions with extension-executed internal API calls (`addToPlaylist`, `removeFromPlaylist`, Playlist v2 create/update/delete, and artist overview lookup for images) documented in `extension/PATHFINDER-MUTATIONS.md`. To keep this maintainable, we need a stable SDK-like boundary and message protocol instead of adding more direct service-worker branches.

A key constraint is execution context: `chrome.runtime.sendMessage` and extension APIs are browser-only. Existing write entry points like `src/lib/server/liked-songs.functions.ts` are server functions and cannot directly invoke extension commands. The write path must therefore be split into (a) browser command execution via extension and (b) server-side DB acknowledgement/update after command result.

## Goals / Non-Goals

**Goals:**
- Create a typed extension-local Spotify client module that consolidates Pathfinder + Playlist v2 reads and writes.
- Keep Spotify token usage and internal API calls confined to extension runtime contexts.
- Define an explicit app↔extension command contract so web app code can call Spotify operations through a stable interface.
- Standardize error/result envelopes and retry behavior so orchestration code can make deterministic decisions.
- Define an explicit write outcome persistence flow so successful extension mutations are reflected in Supabase state.
- Route artist-image retrieval through extension-executed internal APIs rather than server app-auth endpoints.
- Document full request/response object shapes for supported operations before DTO mapping.
- Add an on-demand live contract test strategy for parser/type drift detection.

**Non-Goals:**
- Moving Spotify internal API execution to backend services.
- Rewriting existing sync ingestion architecture (`/api/extension/sync`) beyond what is needed for command routing.
- Introducing new third-party dependencies for RPC, queueing, or transport.
- Expanding artist enrichment beyond v1 requirements (for example, non-primary artist image selection rules).

## Decisions

1. **Decision: Build an extension-local `SpotifyClient` abstraction and keep it in `extension/src/shared/spotify-client/*`.**  
   - Rationale: isolates internal API details (operation names, hashes, payload shapes, region-specific Playlist v2 endpoints) from service-worker routing code.  
   - Alternative considered: keep adding functions directly in `service-worker.ts`; rejected because mutation/read logic and retries become fragmented and difficult to test.

2. **Decision: Service worker remains execution boundary and exposes command handlers through `chrome.runtime.onMessageExternal`.**  
   - Rationale: token interception, CORS posture, and Spotify session assumptions are already handled in extension runtime. `src/lib/extension/detect.ts` already uses this path for `PING`, `CONNECT`, and `TRIGGER_SYNC`.  
   - Alternative considered: backend-initiated control plane; rejected because backend cannot directly address extension runtime.

3. **Decision: Add browser-only app-side proxy methods (SDK-like ergonomics) that serialize commands, not direct Spotify HTTP calls.**  
   - Rationale: preserves a clean call-site API while enforcing extension execution for all user-scoped writes from valid browser context.  
   - Alternative considered: invoking extension commands from server functions; rejected because server runtime has no `chrome.runtime`.

4. **Decision: Split write flow into command execution and DB acknowledgement.**  
   - Rationale: extension can execute Spotify writes, but canonical app state still lives in DB. After command result, the app performs a separate server mutation to persist status/result metadata.  
   - Alternative considered: rely only on next full sync to reconcile writes; rejected because UX and downstream status become stale and ambiguous.

5. **Decision: Normalize command responses to a typed envelope (`ok`, `data`, `errorCode`, `message`, `retryable`, `commandId`).**  
   - Rationale: deterministic caller behavior across sync/orchestration/UI code, and better error analytics.  
   - Alternative considered: free-form message payloads per command; rejected due to brittle coupling.

6. **Decision: Reuse existing retry primitives in `pathfinder.ts` for Pathfinder calls and add equivalent guarded retry strategy for Playlist v2 calls with centralized `spclient` host resolution.**  
   - Rationale: preserves existing 429 behavior while avoiding inconsistent mutation reliability across endpoints, and keeps region/domain host selection in one resolver with deterministic fallback behavior.  
   - Alternative considered: hardcode a single Playlist v2 host per environment; rejected due to observed region routing variability and fragility during host-specific failures.

7. **Decision: Batch conservatively — use known native multi-item payloads, otherwise execute sequentially with pacing.**  
   - Rationale: undocumented APIs are higher-risk. We already know `addToPlaylist` supports `playlistItemUris[]`; for unsupported batch semantics, sequential commands with delay are safer.  
   - Alternative considered: generic custom batch command for all operations; rejected for v1 due to unclear Spotify-side guarantees.

8. **Decision: Resolve open protocol questions now for v1.**  
   - Rationale: reduce implementation ambiguity.  
   - Positions: include idempotency via `commandId`; generate `commandId` in app/browser proxy before dispatch; extension must echo the same value in responses; keep push/UI-triggered command model for v1; defer strict protocol-version enforcement while allowing optional `protocolVersion: 1` field.

9. **Decision: Add response-shape documentation as source-of-truth fixtures.**  
   - Rationale: internal API schemas can drift. Captured request/response objects in docs/fixtures make parser updates safer and auditable.  
   - Alternative considered: only documenting mapped DTOs; rejected because upstream drift could be hidden until runtime.

10. **Decision: Include `queryArtistOverview` (or documented internal equivalent) in v1 and migrate artist-image callers off app-auth endpoints.**  
   - Rationale: official app-auth artist-image path is being deprecated, so image retrieval must rely on extension-executed internal APIs in the same execution boundary as other user-scoped Spotify operations.  
   - Alternative considered: keep app-auth fallback; rejected because it will not remain reliable post-deprecation.

## Risks / Trade-offs

- **Hash rotation for Pathfinder mutations** → Mitigation: continue interceptor-driven hash discovery + storage-backed registry (`extension/src/shared/hash-registry.ts`) and avoid hardcoding single-source hashes.
- **Playlist v2 endpoint/domain variation by region** → Mitigation: encapsulate endpoint resolution in one playlist client module and keep fallback host handling centralized.
- **Service-worker lifecycle resets in MV3** → Mitigation: preserve token and command-critical state in `chrome.storage.local`, keep in-memory caches as optimization only.
- **Command protocol drift between app and extension versions** → Mitigation: centralize shared command types in `extension/src/shared/types.ts`, include `commandId`, and keep optional `protocolVersion` field for gradual enforcement.
- **Increased extension responsibility for writes** → Mitigation: keep extension thin (execution only), with business decisioning still in backend/app orchestration.
- **Undocumented batch behavior surprises** → Mitigation: limit native batching to operations with captured proof; default to sequential dispatch with fixed pacing and retry handling.
- **Parser breakage from upstream response drift** → Mitigation: maintain raw response-shape docs and add on-demand live contract tests.
- **Artist overview response variability or operation drift** → Mitigation: pin parser contracts to captured raw responses and validate via opt-in live contract tests.

## Migration Plan

1. Introduce `spotify-client` modules under extension shared code for reads and writes, preserving existing behavior for currently implemented reads.
2. Refactor `service-worker.ts` to call client methods instead of direct inline API logic.
3. Implement Playlist v2 `spclient` endpoint resolver in playlist client module (primary + deterministic fallback host strategy).
4. Add external command handlers for write operations and standardized response envelopes (including `commandId`).
5. Add app-side browser proxy functions that wrap `chrome.runtime.sendMessage` for new commands and generate caller `commandId` values.
6. Replace server-initiated write assumptions with browser command flow plus server DB acknowledgement mutation.
7. Implement and route artist-image lookup through extension command(s), then update current artist-image call sites away from server app-auth usage.
8. Add raw request/response object documentation for supported operations and keep it adjacent to extension API docs.
9. Add on-demand live contract test suite (manual command, skipped in default test runs) to validate parser/type compatibility with real API responses.
10. Keep current sync endpoints and flows operational during rollout; add command handlers incrementally and validate each operation independently.
11. Rollback strategy: disable new command handlers and fall back to sync-only mode while preserving existing read ingestion paths.

## Resolved Positions (v1)

- Idempotency: include `commandId` in every write command and response.
- Command ID source: app/browser proxy generates `commandId` (UUID) per command; extension echoes it unchanged.
- Command delivery: push model from UI/browser to extension (no extension polling in v1).
- Protocol versioning: optional `protocolVersion: 1` field now, strict enforcement deferred.
- Artist overview: included in v1 specifically to support artist-image retrieval migration from app-auth endpoints.
