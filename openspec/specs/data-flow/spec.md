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

The system SHALL define job lifecycle helpers under the jobs module.

#### Scenario: Job lifecycle service location
- **WHEN** job lifecycle helpers are referenced
- **THEN** they reside in `src/lib/jobs/lifecycle.ts`

### Requirement: Retry utility module location

The system SHALL define Result retry utilities under shared utils.

#### Scenario: Retry helper location
- **WHEN** `withRetry` is referenced
- **THEN** it resides in `src/lib/shared/utils/result-wrappers/generic.ts`

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
// lib/server/songs.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { updateLikedSongStatus } from '~/data/songs'

export const markSongMatched = createServerFn()
  .validator(z.object({
    accountId: z.string().uuid(),
    songId: z.string().uuid(),
    playlistId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    await updateLikedSongStatus(data.accountId, data.songId, 'matched')
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

**Service**: `src/lib/jobs/lifecycle.ts`

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
