# Implementation Tasks

Tasks are ordered by dependency. Core infrastructure first, then integration with existing services.

---

## 0. Prerequisites

- [ ] 0.1 Confirm API route naming pattern uses `src/routes/api.{name}.tsx` (see `openspec/project.md`)
- [ ] 0.2 Verify `data/jobs.ts` has all needed queries (getJobById, updateJobProgress)
- [ ] 0.3 Review existing job types in `data/jobs.ts` match SSE event needs

---

## 1. Core SSE Infrastructure

### 1.1 Job Progress Types

- [ ] 1.1.1 Create `src/lib/services/job-progress/types.ts`
  - Define `JobProgressEvent` type (progress update with counts)
  - Define `JobStatusEvent` type (terminal status)
  - Define `JobItemEvent` type (item status update)
  - Define `JobItemStatus` union (`queued | in_progress | succeeded | failed`)
  - Define `JobItemKind` union (`song | playlist | match`)
  - Define `JobEventType` union (`progress | status | item | error`)
  - Define `SSEMessage` wrapper with type discriminator
  - Export `serializeSSEEvent(event): string` for `data: {...}\n\n` format

### 1.2 Job Event Emitter

- [ ] 1.2.1 Create `src/lib/services/job-progress/emitter.ts`
  - Create in-memory `JobEventEmitter` class
  - Map of `jobId → Set<callback>` for subscribers
  - Implement `subscribe(jobId, callback): () => void`
  - Implement `emit(jobId, event): void`
  - Implement `unsubscribeAll(jobId): void` for cleanup
  - Export singleton `jobEventEmitter` instance

- [ ] 1.2.2 Add emitter lifecycle integration
  - Call `unsubscribeAll(jobId)` when job reaches terminal status
  - Prevent memory leaks from completed jobs

### 1.3 SSE API Endpoint

- [ ] 1.3.1 Create `src/routes/api.jobs.$id.progress.tsx`
  - Use `createAPIFileRoute` from `@tanstack/start/api`
  - Route path: `/api/jobs/$id/progress`
  - Validate `$id` parameter as UUID
  - Check session authentication
  - Verify user owns the job (`job.account_id === session.accountId`)
  - Return 404 if job not found or not owned

- [ ] 1.3.2 Implement SSE stream in endpoint
  - Create `ReadableStream` with controller
  - Set SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`
  - Subscribe to `jobEventEmitter` for job ID
  - Encode events with `serializeSSEEvent`
  - Handle `request.signal.abort` for cleanup

- [ ] 1.3.3 Add keep-alive ping
  - Send `: ping\n\n` every 30 seconds (comment format, ignored by EventSource)
  - Clear interval on abort/close
  - Prevents proxy/CDN timeout disconnects

- [ ] 1.3.4 Add initial state push
  - On connection, immediately send current job state
  - Prevents UI showing stale data before first real event
  - Read current progress from `data/jobs.ts`

- [ ] 1.3.5 Handle terminal states
  - When job status is `completed` or `failed`, send final event
  - Close the stream after terminal event
  - Call `unsubscribeAll(jobId)` to cleanup

---

## 2. Client Hook

### 2.1 useJobProgress Hook

- [ ] 2.1.1 Create `src/lib/hooks/useJobProgress.ts`
  - Accept `jobId: string | null` parameter
  - Return `{ progress, status, items, currentItem, error, isConnected }`
  - Handle null jobId gracefully (no connection)

- [ ] 2.1.2 Implement EventSource connection
  - Create EventSource to `/api/jobs/${jobId}/progress`
  - Handle `onmessage` → parse JSON, update state
  - Track `item` events in local state (Map of itemId → status)
  - Update `currentItem` on `item` events with `in_progress`
  - Handle `onerror` → set error state, log
  - Handle `onopen` → set connected state
  - Cleanup on unmount with `eventSource.close()`

- [ ] 2.1.3 Integrate with TanStack Query
  - Use `useQueryClient()` for cache updates
  - On progress event, update `['job', jobId]` query data
  - Keep item status state in hook (no DB writes)
  - Invalidate related queries on completion (e.g., songs list)

- [ ] 2.1.4 Add reconnection state tracking
  - Track connection attempts for UI feedback
  - EventSource auto-reconnects, but UI should show state
  - Exponential backoff awareness (browser handles this)

---

## 3. Service Integration

### 3.1 Helper Functions

- [ ] 3.1.1 Create `src/lib/services/job-progress/helpers.ts`
  - `emitProgress(jobId, progress: JobProgress): void`
  - `emitStatus(jobId, status: JobStatus): void`
  - `emitItem(jobId, item: JobItemEvent): void`
  - `emitError(jobId, error: string): void`
  - Wraps `jobEventEmitter.emit()` with proper typing

### 3.2 Sync Orchestrator Integration

- [ ] 3.2.1 Update `src/lib/services/sync/orchestrator.ts`
  - Import `emitProgress`, `emitStatus` helpers
  - Emit progress after each batch processed
  - Emit item status for each playlist/track processed (`in_progress` → `succeeded/failed`)
  - Emit status on job start/complete/fail
  - Ensure emissions happen after DB updates (consistency)

### 3.3 Analysis Pipeline Integration

- [ ] 3.3.1 Update `src/lib/services/analysis/pipeline.ts`
  - Import SSE helpers
  - Emit progress after each song analyzed
  - Emit status on pipeline start/complete/fail
  - Emit per-item status for each song (queued, in_progress, succeeded, failed)

### 3.4 Matching Service Integration (depends on Phase 4e)

- [ ] 3.4.1 Update `src/lib/services/matching/service.ts` (when created)
  - Import SSE helpers
  - Emit progress during batch matching
  - Emit per-item status for each song match (`itemKind: "match"`)
  - Emit status on matching job completion

---

## 4. Testing

- [ ] 4.1 Add unit tests for SSE event serialization
  - Test `serializeSSEEvent` produces valid SSE format
  - Test event type discrimination
  - Test item event serialization

- [ ] 4.2 Add unit tests for JobEventEmitter
  - Test subscribe/unsubscribe lifecycle
  - Test emit broadcasts to all subscribers
  - Test cleanup removes all callbacks

- [ ] 4.3 Add integration test for SSE endpoint
  - Test auth/ownership check (returns 404)
  - Test initial state push
  - Test keep-alive pings
  - Test stream closes on terminal status
  - Test item events are forwarded

- [ ] 4.4 Run typecheck and lint
  - `bun run typecheck`
  - `bun run lint`

---

## 5. Documentation

- [ ] 5.1 Update ROADMAP.md to mark Phase 5 as complete
- [ ] 5.2 Add JSDoc comments to SSE service and hook

---

## Dependencies Graph

```
Types (1.1)
    ↓
Event Emitter (1.2)
    ↓
SSE Endpoint (1.3) ──────────────────┐
    ↓                                │
Client Hook (2.1)                    │
    ↓                                │
┌───┴───┐                            │
│ Helper Functions (3.1) ◄───────────┘
│       │
│   Sync Orchestrator (3.2)
│       │
│   Analysis Pipeline (3.3)
│       │
│   Matching Service (3.4) [Phase 4e dependency]
└───────┘
```

---

## Notes

### Edge Runtime Considerations

The SSE endpoint must work on Cloudflare Workers:
- Use `ReadableStream` (Web Streams API)
- No Node.js `http` module or `EventEmitter` from `events`
- In-memory emitter resets on cold start (acceptable for short-lived jobs)

### Memory Management

The in-memory emitter stores callbacks per job:
- Cleanup on job completion prevents memory leaks
- Worker restarts clear all subscriptions (clients reconnect automatically)
- Keep subscriber count reasonable (typically 1 per job)

### Ordering Guarantees

SSE guarantees ordered delivery within a connection:
- Events emitted in order will arrive in order
- Reconnection may miss events (use initial state push)
- For critical state, always read from DB, use SSE for updates
