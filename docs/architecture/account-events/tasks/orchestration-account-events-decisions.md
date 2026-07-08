# Account Events Orchestration Decisions

## Task 08 - Client Hook
- **Hook Location**: Placed the `useAccountEvents` hook alongside existing hooks in `src/lib/hooks/useAccountEvents.ts`.
- **Stream Parsing**: Used `TextDecoder` and string accumulation (`buffer.indexOf("\n\n")`) in the fetch-based loop to safely handle chunks that might split in the middle of a frame.
- **Connection States**: Exported a `ConnectionState` type (`"connecting" | "connected" | "disconnected" | "error" | "forbidden"`) to make connection status typed and easy to consume for polling fallbacks.
- **Cursor Extraction**: Updated the SSE parser loop to extract the standard `id:` field into an integer and use it to advance `lastSeenPublishIdRef.current` and dedupe frames, fully aligning with SSE standards.
- **Token Reminting**: Hook now correctly passes `forceRemint` argument as `{ data: { forceRemint } }` to the server function to ensure cache-busting during a forced re-auth.
- **Match Snapshot Invalidation**: Implemented "retry the bounded deck read" behavior on `match_snapshot_published` by invalidating `["active-jobs", accountId]` alongside the `deckRoot`, triggering a refresh of `firstVisibleMatchReady`.

## Task 06 - SSE Gateway
- **Token Version Check**: The `ver` claim is hardcoded to `1` in the token generation, so the gateway checks for `claims.ver !== 1` directly rather than querying the database for a non-existent session version column.
- **Wake Listener Granularity**: The `account_event_wake` NOTIFY channel does not currently include the `account_id` in its payload, so the gateway conservatively wakes and checks all connected clients when an event is inserted.
- **Direct Mode Fallback**: Bun's `ReadableStream` direct mode (`type: "direct"`) is used in production for zero-buffering, but since Vitest runs in Node.js which lacks this API, the gateway conditionally checks `process.versions.bun` and gracefully degrades to standard queueing streams for tests while enforcing equivalent backpressure via `desiredSize`.
- **Overflow & Backpressure**: Implemented strict backpressure: if a client's socket is full (`write()` returns `0` or `desiredSize <= 0`), the connection is aggressively closed to force a fresh reconnect and state snapshot instead of unbounded memory growth on the server.
- **503 Draining**: Exported a `setAccountEventsGatewayDraining()` flag so that `src/worker/index.ts` can immediately flip the gateway into returning `503 Service Unavailable` for new connections during graceful shutdown.

## Task 09 - Producers: Enrichment Events
- **Transaction Boundary**: Created a dedicated `src/lib/workflows/library-processing/settlement.ts` for enrichment job settlements. This uses a new `postgres.js` transaction (worker-only) to update the `job` row and write the `account_event` durable row atomically, avoiding any mixing with the `repository.ts` Supabase client.
- **Event Reason Mapping**: Mapped `error` and `blocked` enrichment chunk outcomes to the `failed` reason for `enrichment_stopped`, as enrichment jobs currently have no equivalent of a user cancellation or superseding.
