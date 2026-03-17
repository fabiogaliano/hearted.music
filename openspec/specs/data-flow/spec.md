# Data Flow Patterns Specification

> Data fetching, caching, and state management patterns.

## Purpose
Define the canonical data-flow patterns for UI state, server state, and job progress in the v2 app.

**Detailed design**: `docs/DATA-FLOW-PATTERNS.md`

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│ UI Components (React)                                    │
├─────────────────────────────────────────────────────────┤
│ TanStack Query (server state) + Zustand (UI state)      │
├─────────────────────────────────────────────────────────┤
│ Server Functions (TanStack Start createServerFn)        │
├─────────────────────────────────────────────────────────┤
│ Query Modules (lib/data/*.ts)                           │
├─────────────────────────────────────────────────────────┤
│ Supabase (PostgreSQL + RLS)                             │
└─────────────────────────────────────────────────────────┘
```

---
## Requirements
### Requirement: TanStack Query for Server State

The system SHALL use TanStack Query for all server-derived data.

#### Scenario: Query hook pattern
- **WHEN** fetching data in a component
- **THEN** use `useQuery()` with typed query functions

#### Scenario: Mutation pattern
- **WHEN** modifying server data
- **THEN** use `useMutation()` with optimistic updates

#### Scenario: Cache invalidation
- **WHEN** mutation succeeds
- **THEN** invalidate relevant query keys

---

### Requirement: Zustand for UI State

The system SHALL use Zustand for ephemeral UI state only.

#### Scenario: Modal state
- **WHEN** opening/closing modals
- **THEN** use Zustand store (not query cache)

#### Scenario: Form state
- **WHEN** managing form inputs
- **THEN** use component state or Zustand for drafts

#### Scenario: Match queue position
- **WHEN** tracking current song in matching
- **THEN** use Zustand for queue index

---

### Requirement: Server Functions for Mutations

The system SHALL use TanStack Start server functions for data mutations.

#### Scenario: Server function definition
- **WHEN** creating a server mutation
- **THEN** use `createServerFn()` with Zod validation

#### Scenario: Type safety
- **WHEN** calling server functions
- **THEN** input and output types are inferred

#### Scenario: Error handling
- **WHEN** server function fails
- **THEN** error is typed and catchable

---

### Requirement: SSE for Real-Time Progress

The system SHALL use SSE for request-local job progress and database polling for cross-process background enrichment progress.

#### Scenario: Progress subscription for sync jobs
- **WHEN** a sync-phase job starts inside the web application request runtime
- **THEN** the client connects to SSE endpoint `/api/jobs/$id/progress`
- **AND** the server emits in-memory progress events for that job while the request-owned work is active

#### Scenario: Progress display for background enrichment jobs
- **WHEN** a queued `enrichment` job is running inside the VPS worker process
- **THEN** the client SHALL read progress by polling persisted `job` state
- **AND** it SHALL use `status`, `progress`, and `error` fields from the database as the source of truth

#### Scenario: Terminal background job handling
- **WHEN** a polled background enrichment job reaches `completed` or `failed`
- **THEN** the polling consumer SHALL stop polling that job identifier
- **AND** it MAY resolve the latest persisted active enrichment job pointer to continue with a chained successor chunk

---

### Requirement: Deferred Supabase Realtime

The system SHALL NOT use Supabase Realtime initially.

#### Scenario: Initial implementation
- **WHEN** building v1
- **THEN** use SSE for all real-time needs

#### Scenario: Future consideration
- **WHEN** realtime collaboration needed
- **THEN** evaluate Supabase Realtime for multi-user scenarios

---

### Requirement: Route-Level Data Loading

The system SHALL load data at the route level, not in components.

#### Scenario: Loader pattern
- **WHEN** navigating to a route
- **THEN** loader fetches required data before render

#### Scenario: Suspense boundary
- **WHEN** data is loading
- **THEN** route-level Suspense shows loading state

#### Scenario: Error boundary
- **WHEN** loader fails
- **THEN** route-level ErrorBoundary handles error

---

### Requirement: Optimistic Updates

The system SHALL provide optimistic updates for user actions.

#### Scenario: Add to playlist
- **WHEN** user adds song to playlist
- **THEN** immediately show song in playlist (before server confirms)

#### Scenario: Rollback on error
- **WHEN** mutation fails
- **THEN** revert optimistic update and show error toast

---

### Requirement: Job lifecycle module location

The system SHALL define job lifecycle helpers under the platform jobs module.

#### Scenario: Job lifecycle service location
- **WHEN** job lifecycle helpers are referenced
- **THEN** they reside in `src/lib/platform/jobs/lifecycle.ts`

#### Scenario: Job progress helper location
- **WHEN** job progress helpers are referenced
- **THEN** they reside under `src/lib/platform/jobs/progress/*`

### Requirement: Trigger-scoped enrichment follow-on work

The system SHALL route enrichment follow-on work through an account-scoped background enrichment chain while keeping request-trigger boundaries explicit.

#### Scenario: Sync follow-on scope
- **WHEN** `/api/extension/sync` finishes its sync phases successfully
- **THEN** it SHALL create or reuse the account's background `enrichment` chain
- **AND** it SHALL NOT execute enrichment stages inline before returning the sync response

#### Scenario: Destination-save follow-on scope
- **WHEN** destination playlists are saved successfully during onboarding and follow-on enrichment is needed
- **THEN** the save flow SHALL create or reuse the same account-scoped background `enrichment` chain
- **AND** it SHALL NOT start a second duplicate active chain for the same account

#### Scenario: Trigger response isolation
- **WHEN** a sync request or destination-save request succeeds
- **THEN** the initiating response SHALL be allowed to complete before background enrichment finishes
- **AND** background follow-on failures SHALL be isolated from that already-successful response

#### Scenario: Legacy full-pipeline entry point is no longer the primary trigger path
- **WHEN** internal callers still use a legacy full-pipeline wrapper for scripts, tests, or compatibility
- **THEN** that wrapper MAY remain available internally
- **AND** the primary product-triggered path SHALL still be the background enrichment queue

### Requirement: Retry utility module location

The system SHALL define Result retry utilities under shared utils.

#### Scenario: Retry helper location
- **WHEN** `withRetry` is referenced
- **THEN** it resides in `src/lib/shared/utils/result-wrappers/generic.ts`

### Requirement: Persisted active enrichment job pointer

The system SHALL persist the current active background enrichment job per account so the UI can recover progress across chained chunks.

#### Scenario: Trigger persists the active enrichment job pointer
- **WHEN** sync or onboarding creates or reuses an active `enrichment` background job for an account
- **THEN** the system SHALL persist that job identifier in account-scoped stored state
- **AND** later UI loads SHALL be able to recover the current background job identifier without relying on in-memory state

#### Scenario: Worker advances the pointer during chunk chaining
- **WHEN** the worker enqueues a successor chunk for an account
- **THEN** the persisted active enrichment job pointer SHALL be updated to the successor chunk job identifier
- **AND** subsequent progress lookups SHALL resolve to the newer chunk

#### Scenario: Pointer is cleared when the chain finishes
- **WHEN** an account has no remaining pending or running `enrichment` jobs
- **THEN** the persisted active enrichment job pointer SHALL be cleared
- **AND** future loads SHALL not report stale in-progress background work

## Query Key Patterns

```typescript
// Naming convention: [domain, action?, ...params]
queryKey: ['songs', 'liked', accountId]
queryKey: ['playlists', 'destinations', accountId]
queryKey: ['matches', accountId, contextHash]
queryKey: ['job', jobId]
queryKey: ['preferences', accountId]
```

---

## Server Function Pattern

```typescript
// lib/server/liked-songs.server.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { updateStatus } from '~/lib/data/liked-song'

export const addSongToPlaylist = createServerFn()
  .validator(z.object({
    songId: z.uuid(),
    spotifyTrackId: z.string().min(1),
    spotifyPlaylistId: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    // Matching status is derived from item_status records
    await updateStatus(session.accountId, data.songId, 'added_to_playlist')
    return { success: true }
  })
```

---

## State Ownership

| Data Type                 | Owner                | Why                    |
| ------------------------- | -------------------- | ---------------------- |
| Songs, playlists, matches | TanStack Query       | Server-derived, cached |
| Job progress              | TanStack Query + SSE | Real-time updates      |
| User preferences          | TanStack Query       | Server-persisted       |
| Current match index       | Zustand              | Ephemeral UI state     |
| Modal open/close          | Zustand              | Ephemeral UI state     |
| Form drafts               | Local state          | Not server-relevant    |

---

## Error Handling Pattern

**Data Layer**: Returns `Result<T, DbError>` - no throwing.

```typescript
// Data module returns Result
export function getAccountById(id: string): Promise<Result<Account | null, DbError>> {
  return fromSupabaseMaybe(supabase.from("account").select("*").eq("id", id).single());
}
```

**Route Boundaries**: Translate Result errors to redirects or responses.

```typescript
// Server function handles Result at boundary
const accountResult = await getAccountById(id);
if (Result.isError(accountResult)) {
  throw redirect({ to: "/login", search: { error: accountResult.error._tag } });
}
const account = accountResult.value;
```

**UI Layer**: Mutations use onError for user feedback.

```typescript
// In mutation
useMutation({
  mutationFn: markSongMatched,
  onSuccess: () => {
    queryClient.invalidateQueries(['songs', 'liked'])
    toast.success('Song added to playlist')
  },
  onError: (error) => {
    toast.error(error.message)
  },
})
```

---

## Job Lifecycle Pattern

Jobs use a `pending → running → completed/failed` state machine. The `pending` state supports future SQS queue integration.

**Service**: `src/lib/platform/jobs/lifecycle.ts`

| Function                    | Use When                                               |
| --------------------------- | ------------------------------------------------------ |
| `startJob(id)`              | Transitioning pending → running (cleans up on failure) |
| `finalizeJob(id, progress)` | Ending job with progress-based decision                |
| `failJob(id, msg)`          | Explicit failure in error handlers                     |
| `completeJob(id)`           | Explicit completion without progress logic             |

```typescript
const job = await jobs.createJob(accountId, type);  // pending
await startJob(job.id);                              // → running
// ... work ...
await finalizeJob(job.id, progress);                 // → completed/failed
```

All functions include retry logic for transient `DatabaseError` failures.

---

## Retry Utility

`withRetry()` in `src/lib/shared/utils/result-wrappers/generic.ts` wraps Result-returning operations with exponential backoff.

```typescript
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

await withRetry(() => someDbOperation(), {
  maxRetries: 3,
  isRetryable: (err) => err instanceof DatabaseError,
});
```

Only `DatabaseError` (connection/timeout) is retryable. `NotFoundError`, `ConstraintError`, `RLSError` fail immediately.
