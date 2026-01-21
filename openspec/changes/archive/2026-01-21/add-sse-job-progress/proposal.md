# Change: Add SSE Job Progress (Phase 5)

## Why

The app needs real-time job progress updates for sync, analysis, and matching operations. The current `old_app` uses WebSockets for this, but **Cloudflare Workers don't support WebSockets for server-initiated messages**. Server-Sent Events (SSE) is the right solution:

1. **Edge Compatible**: SSE works on Cloudflare Workers (just HTTP with chunked transfer)
2. **Simpler**: One-way communication is sufficient for progress updates
3. **Auto-Reconnect**: Browser `EventSource` API handles reconnection automatically
4. **TanStack Query Integration**: Progress updates can update the query cache directly

This migration replaces ~600 lines of WebSocket infrastructure with ~200 lines of SSE implementation.

## What Changes

### Source Files to Replace (old_app)

| Source File                                     | Lines | Purpose                   | Replacement             |
| ----------------------------------------------- | ----- | ------------------------- | ----------------------- |
| `lib/services/JobSubscriptionManager.ts`        | 172   | WebSocket message routing | SSE endpoint            |
| `lib/services/JobPersistenceService.ts`         | 307   | Job state recovery        | `data/jobs.ts` (exists) |
| `lib/types/websocket.types.ts`                  | 127   | Message type definitions  | SSE event types         |
| `features/.../hooks/useJobSubscription.ts`      | 42    | React subscription hook   | `useJobProgress` hook   |
| `features/.../hooks/useAnalysisSubscription.ts` | 196   | Analysis job subscription | `useJobProgress` hook   |

### New Files to Create

| Target Location                        | Purpose                                        |
| -------------------------------------- | ---------------------------------------------- |
| `src/routes/api.jobs.$id.progress.tsx` | SSE API endpoint                               |
| `src/lib/jobs/progress/emitter.ts`     | In-memory event emitter for SSE                |
| `src/lib/jobs/progress/types.ts`       | SSE event types (including item status events) |
| `src/lib/hooks/useJobProgress.ts`      | React hook using EventSource                   |

### Already Implemented (No Changes Needed)

| File                        | Purpose                    |
| --------------------------- | -------------------------- |
| `src/lib/data/jobs.ts`      | Job CRUD with Result types |
| `src/lib/jobs/lifecycle.ts` | Job state transitions      |

## Impact

### Affected Specs
- `data-flow` - Adding detailed SSE requirements

### Affected Code
- `src/routes/api/` - New API route for SSE endpoint
- `src/lib/jobs/` - Job progress emitter + lifecycle helpers
- `src/lib/hooks/` - New client hook
- Services that update job progress will emit SSE events:
  - `src/lib/capabilities/sync/orchestrator.ts`
  - `src/lib/capabilities/analysis/pipeline.ts`
  - `src/lib/capabilities/matching/service.ts` (Phase 4e)

### Database
- No schema changes required
- Uses existing `job` table columns

### Dependencies
- **No new npm packages required**
- Uses native `EventSource` API (browser) and `ReadableStream` (server)

## Acceptance Criteria

1. **SSE Connection**: Client can connect to `/api/jobs/$id/progress` endpoint
2. **Progress Events**: Events sent when job progress updates
3. **Item Status Events**: Events sent when an item starts/finishes processing
4. **Auth Check**: Only job owner can connect to their job's SSE stream
5. **Auto-Close**: Stream closes when job reaches terminal state (completed/failed)
6. **Keep-Alive**: Ping events sent every 30 seconds to prevent timeout
7. **Reconnection**: Client auto-reconnects on disconnect (EventSource default)
8. **TanStack Query**: Progress updates populate the query cache
9. **Edge Compatible**: Works on Cloudflare Workers

## Migration Notes

### Key Differences from WebSocket

| Aspect         | WebSocket (old)      | SSE (new)               |
| -------------- | -------------------- | ----------------------- |
| Direction      | Bidirectional        | Server → Client only    |
| Connection     | Single global socket | Per-job connection      |
| Message format | JSON with type field | SSE `data:` lines       |
| Reconnection   | Manual               | Automatic (EventSource) |
| Edge support   | Not on CF Workers    | Full support            |

### Event Format

```typescript
// Server sends:
data: {"type":"progress","done":5,"total":10,"succeeded":5,"failed":0}

data: {"type":"item","itemId":"...","itemKind":"song","status":"in_progress","label":"Artist – Title"}

data: {"type":"status","status":"completed"}

// Keep-alive (comment, ignored by EventSource):
: ping
```

### Backward Compatibility

This is a clean migration with no backward compatibility needed:
- Old WebSocket code is in `old_app/` (not used by v1)
- v1 routes/UI don't exist yet (Phase 7)
- Services emit events through the new emitter only

## References

- [ROADMAP.md Phase 5](/docs/migration_v2/ROADMAP.md#phase-5-sse-migration)
- [data-flow spec](/openspec/specs/data-flow/spec.md)
- [02-SERVICES.md SSE section](/docs/migration_v2/02-SERVICES.md#sse-api-route)
- [03-IMPLEMENTATION.md Phase 5](/docs/migration_v2/03-IMPLEMENTATION.md#phase-5-sse-migration)
- [Decision #035](/docs/migration_v2/00-DECISIONS.md) — SSE over WebSocket
