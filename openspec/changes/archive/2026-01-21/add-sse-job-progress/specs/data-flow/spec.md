## MODIFIED Requirements

### Requirement: SSE for Real-Time Progress

The system SHALL use Server-Sent Events for job progress updates.

#### Scenario: Progress subscription
- **WHEN** job starts
- **THEN** client connects to SSE endpoint `/api/jobs/$id/progress`

#### Scenario: Progress display
- **WHEN** progress event received
- **THEN** update TanStack Query cache with new progress

#### Scenario: Connection handling
- **WHEN** SSE connection drops
- **THEN** automatically reconnect with EventSource

#### Scenario: Initial state push
- **WHEN** client connects to SSE endpoint
- **THEN** server immediately sends current job state
- **AND** client has accurate state even if events were missed

#### Scenario: Keep-alive pings
- **WHEN** SSE connection is idle for 30 seconds
- **THEN** server sends SSE comment (`: ping`) to maintain connection
- **AND** intermediate proxies do not timeout the connection

#### Scenario: Stream termination
- **WHEN** job reaches terminal state (completed or failed)
- **THEN** server sends final status event
- **AND** server closes the SSE stream
- **AND** client handles close gracefully

#### Scenario: Authorization check
- **WHEN** client attempts to connect to job progress endpoint
- **THEN** server verifies session authentication
- **AND** server verifies job belongs to authenticated user
- **AND** returns 404 for unauthorized or non-existent jobs

---

## ADDED Requirements

### Requirement: SSE Edge Compatibility

The SSE implementation SHALL work on Cloudflare Workers edge runtime.

#### Scenario: No WebSocket dependency
- **WHEN** implementing real-time job progress
- **THEN** use Server-Sent Events, NOT WebSocket
- **AND** no Node.js-specific APIs (EventEmitter, http module)

#### Scenario: ReadableStream usage
- **WHEN** creating SSE response
- **THEN** use Web Streams API (ReadableStream)
- **AND** encode events using TextEncoder

#### Scenario: Cold start handling
- **WHEN** worker restarts during active job
- **THEN** client reconnects automatically (EventSource default)
- **AND** initial state push provides current job state
- **AND** no events are permanently lost

---

### Requirement: SSE Event Format

The SSE events SHALL follow a consistent typed format.

#### Scenario: Progress event
- **WHEN** job progress updates
- **THEN** emit event with `type: "progress"`
- **AND** include `done`, `total`, `succeeded`, `failed` counts

#### Scenario: Status event
- **WHEN** job status changes
- **THEN** emit event with `type: "status"`
- **AND** include `status` field ("pending", "running", "completed", "failed")

#### Scenario: Item status event
- **WHEN** a job item starts or completes processing
- **THEN** emit event with `type: "item"`
- **AND** include `itemId`, `itemKind`, and `status`
- **AND** optionally include `label` and `index` for UI display

#### Scenario: Error event
- **WHEN** job encounters error
- **THEN** emit event with `type: "error"`
- **AND** include `message` field with error description

#### Scenario: Event serialization
- **WHEN** sending SSE event
- **THEN** format as `data: ${JSON.stringify(event)}\n\n`
- **AND** event is valid JSON
- **AND** EventSource `onmessage` receives parsed data

---

### Requirement: Job Progress Hook

The system SHALL provide a React hook for consuming job progress.

#### Scenario: Hook initialization
- **WHEN** component uses `useJobProgress(jobId)`
- **THEN** return `{ progress, status, items, currentItem, error, isConnected }`
- **AND** create EventSource connection if jobId provided

#### Scenario: Null job handling
- **WHEN** `useJobProgress(null)` is called
- **THEN** no EventSource connection is created
- **AND** return empty/initial state

#### Scenario: Cache integration
- **WHEN** progress event received
- **THEN** update TanStack Query cache for `['job', jobId]` key
- **AND** UI components subscribed to that key re-render

#### Scenario: Item event handling
- **WHEN** item status event received
- **THEN** update in-memory item state for `items`
- **AND** set `currentItem` when an item is `in_progress`

#### Scenario: Cleanup on unmount
- **WHEN** component using hook unmounts
- **THEN** EventSource connection is closed
- **AND** no memory leaks occur
