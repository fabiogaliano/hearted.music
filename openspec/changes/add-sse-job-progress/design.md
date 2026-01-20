# Design Document: SSE Job Progress

## Context

This document captures technical decisions for implementing Server-Sent Events (SSE) to replace WebSocket-based job progress updates. The migration is driven by Cloudflare Workers compatibility requirements.

**Stakeholders**: Developer (solo project)
**Constraints**:
- Must run on Cloudflare Workers (no WebSocket server support)
- Must integrate with TanStack Start API routes
- Must work with existing `data/jobs.ts` and `job-lifecycle.ts`

## Goals / Non-Goals

### Goals
- Real-time job progress updates in the browser
- Item-level status events for currently processed items (tracks/playlists)
- Edge-compatible implementation (Cloudflare Workers)
- Integration with TanStack Query cache
- Automatic reconnection on disconnect
- Clean API matching v1 patterns

### Non-Goals
- Bidirectional communication (not needed for progress)
- Cross-tab synchronization (out of scope)
- Persistent event history (not needed for progress)
- Supabase Realtime integration (deferred per Decision #035)

## Decisions

### 1. SSE over WebSocket

**Decision**: Use Server-Sent Events instead of WebSocket.

**Rationale**:
- Cloudflare Workers don't support WebSocket for server-initiated messages
- Progress updates are unidirectional (server → client)
- SSE is simpler: just HTTP with chunked transfer encoding
- `EventSource` API handles reconnection automatically

**Trade-off**: Can't send messages from client to server. Not needed for this use case.

### 2. Per-Job SSE Endpoints

**Decision**: One SSE endpoint per job at `/api/jobs/$id/progress`.

**Rationale**:
- Clean REST-like URL structure
- Easy authorization (check job ownership)
- Isolation: one job's events don't affect another
- Natural lifecycle: stream ends when job completes

**Alternative Considered**: Single multiplexed endpoint for all jobs. Rejected because:
- More complex message routing
- Authorization becomes harder
- Connection lifecycle unclear
- No benefit for single-user app

### 3. In-Memory Event Emitter

**Decision**: Use in-memory pub/sub for SSE events, not database polling.

**Rationale**:
- Minimal latency (no DB round-trips for events)
- Simple implementation
- Matches Cloudflare Workers stateless model
- Worker restarts are rare during active jobs

**Implementation**:
```typescript
class JobEventEmitter {
  private subscribers = new Map<string, Set<(event: JobEvent) => void>>()

  subscribe(jobId: string, callback: (event: JobEvent) => void): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set())
    }
    this.subscribers.get(jobId)!.add(callback)
    return () => this.subscribers.get(jobId)?.delete(callback)
  }

  emit(jobId: string, event: JobEvent): void {
    this.subscribers.get(jobId)?.forEach(cb => cb(event))
  }
}

export const jobEventEmitter = new JobEventEmitter()
```

**Trade-off**: Events lost on worker restart. Acceptable because:
- Jobs are short-lived (minutes, not hours)
- Client reconnects and gets initial state push
- DB is source of truth for job progress

### 4. Initial State Push on Connect

**Decision**: Send current job state immediately on SSE connection.

**Rationale**:
- Prevents UI showing stale data before first real event
- Handles reconnection gracefully (missed events while disconnected)
- Client always has latest state after connect

**Implementation**:
```typescript
// In SSE endpoint
const job = await getJobById(jobId)
if (job) {
  const initialEvent = { type: 'progress', ...job.progress }
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`))
}
```

### 5. Keep-Alive Pings

**Decision**: Send SSE comment (`: ping\n\n`) every 30 seconds.

**Rationale**:
- Prevents intermediate proxies from timing out
- Cloudflare has 100-second idle timeout by default
- SSE comments are ignored by `EventSource` but keep connection alive

**Implementation**:
```typescript
const ping = setInterval(() => {
  controller.enqueue(encoder.encode(': ping\n\n'))
}, 30_000)

request.signal.addEventListener('abort', () => clearInterval(ping))
```

### 6. Stream Termination on Job Completion

**Decision**: Close SSE stream when job reaches terminal state.

**Rationale**:
- Clean resource cleanup
- Signals to client that no more events expected
- Prevents zombie connections

**Implementation**:
```typescript
if (event.type === 'status' && ['completed', 'failed'].includes(event.status)) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  controller.close()
}
```

### 7. TanStack Query Cache Integration

**Decision**: Update TanStack Query cache directly from SSE events.

**Rationale**:
- Immediate UI updates without refetch
- Consistent with data-flow spec pattern
- Optimistic-like experience for progress

**Implementation**:
```typescript
// In useJobProgress hook
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)

  if (data.type === 'progress') {
    queryClient.setQueryData(['job', jobId], (old) => ({ ...old, progress: data }))
  }

  if (data.type === 'item') {
    // Update local in-memory item status UI
  }
}
```

### 8. Authorization via Session

**Decision**: Verify job ownership using session auth.

**Rationale**:
- Consistent with other API routes
- Uses existing `requireSession` pattern
- Prevents users from subscribing to others' jobs

**Implementation**:
```typescript
const session = requireSession(request)
const job = await getJobById(jobId)

if (!job || job.account_id !== session.accountId) {
  return new Response('Not Found', { status: 404 })
}
```

### 9. Event Type Schema

**Decision**: Use discriminated union for SSE event types.

**Rationale**:
- Type-safe event handling
- Clear contract between server and client
- Self-documenting

**Types**:
```typescript
type JobProgressEvent = {
  type: 'progress'
  done: number
  total: number
  succeeded: number
  failed: number
}

type JobStatusEvent = {
  type: 'status'
  status: 'pending' | 'running' | 'completed' | 'failed'
}

type JobItemEvent = {
  type: 'item'
  itemId: string
  itemKind: 'song' | 'playlist' | 'match'
  status: 'queued' | 'in_progress' | 'succeeded' | 'failed'
  label?: string
  index?: number
}

type JobErrorEvent = {
  type: 'error'
  message: string
}

type JobEvent = JobProgressEvent | JobStatusEvent | JobItemEvent | JobErrorEvent
```

### 10. Item-Level Status Events (Bounded)

**Decision**: Emit per-item status events in addition to aggregate job progress.

**Rationale**:
- UI needs the currently processed item (e.g., current track) and status details
- Job-level counts alone are insufficient for “now processing” UI
- Item events stay ephemeral (not stored), which keeps DB simple

**Mitigations**:
- Emit only on status transitions (`queued → in_progress → succeeded/failed`)
- Keep payload minimal (IDs + short label only)
- Client keeps an in-memory map for display; no persistence required

## Risks / Trade-offs

### Risk: Events Lost on Worker Restart
**Impact**: Low
**Mitigation**: Initial state push on reconnect ensures client catches up.

### Risk: Connection Limits
**Impact**: Low (single-user app)
**Mitigation**: One connection per active job; jobs are short-lived.

### Risk: Proxy Timeout
**Impact**: Medium
**Mitigation**: 30-second keep-alive pings prevent idle timeout.

### Risk: Memory Leak from Orphaned Subscribers
**Impact**: Medium
**Mitigation**:
- Cleanup subscribers on job completion
- Cleanup on abort signal
- Workers have short lifespan anyway

## Implementation Notes

### SSE Header Requirements

```typescript
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Nginx: disable buffering
  }
})
```

### ReadableStream Pattern

```typescript
const stream = new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder()

    // Subscribe to events
    const unsubscribe = jobEventEmitter.subscribe(jobId, (event) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    })

    // Cleanup on disconnect
    request.signal.addEventListener('abort', () => {
      unsubscribe()
      controller.close()
    })
  }
})
```

### EventSource Client Pattern

```typescript
function useJobProgress(jobId: string | null) {
  const [state, setState] = useState({ progress: null, error: null })
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!jobId) return

    const es = new EventSource(`/api/jobs/${jobId}/progress`)

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      setState({ progress: data, error: null })
      queryClient.setQueryData(['job', jobId], data)
    }

    es.onerror = () => setState(s => ({ ...s, error: 'Connection lost' }))

    return () => es.close()
  }, [jobId, queryClient])

  return state
}
```
