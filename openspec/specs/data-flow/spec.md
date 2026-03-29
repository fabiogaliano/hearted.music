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

The system SHALL use TanStack Start server functions for data mutations. Matching actions SHALL write to `match_decision`, not `item_status`. All matching-related server functions SHALL reside in `src/lib/server/matching.functions.ts`.

#### Scenario: Server function definition
- **WHEN** creating a server mutation
- **THEN** use `createServerFn()` with Zod validation

#### Scenario: Type safety
- **WHEN** calling server functions
- **THEN** input and output types are inferred

#### Scenario: Error handling
- **WHEN** server function fails
- **THEN** error is typed and catchable

#### Scenario: addSongToPlaylist writes match_decision
- **WHEN** user adds song to a specific playlist
- **THEN** `addSongToPlaylist` server function SHALL insert `match_decision(song_id, playlist_id, 'added')`
- **AND** SHALL NOT write to `item_status.action_type`
- **AND** SHALL reside in `src/lib/server/matching.functions.ts`

#### Scenario: dismissSong batch-declines
- **WHEN** user dismisses a song with suggestions for playlists A, B, C
- **THEN** `dismissSong` server function SHALL batch insert `match_decision(decision='dismissed')` for each shown playlist
- **AND** accept an array of playlist IDs as input
- **AND** SHALL reside in `src/lib/server/matching.functions.ts`

#### Scenario: next has no server function
- **WHEN** user clicks Next Song
- **THEN** no server function is called
- **AND** navigation state is managed in client-side UI state only

#### Scenario: getMatchingSession server function
- **WHEN** the matching page initializes
- **THEN** call `getMatchingSession` server function in `src/lib/server/matching.functions.ts`
- **AND** it SHALL return `{ contextId, totalSongs }` or `null`
- **AND** use `createServerFn()` with Zod validation and `requireAuthSession()`

#### Scenario: getSongMatches server function
- **WHEN** the matching page needs data for a specific song
- **THEN** call `getSongMatches` server function in `src/lib/server/matching.functions.ts`
- **AND** it SHALL accept `{ contextId, offset }` as input
- **AND** return `{ song, matches }` or `null`
- **AND** use `createServerFn()` with Zod validation and `requireAuthSession()`

#### Scenario: File organization
- **WHEN** organizing matching server functions
- **THEN** `addSongToPlaylist`, `dismissSong`, `getMatchingSession`, and `getSongMatches` SHALL all reside in `src/lib/server/matching.functions.ts`
- **AND** these functions SHALL be moved from `src/lib/server/liked-songs.functions.ts`

---

### Requirement: SSE for Real-Time Progress

The system SHALL use SSE for request-local job progress and database polling for cross-process background library-processing progress.

#### Scenario: Progress subscription for sync jobs
- **WHEN** a sync-phase job starts inside the web application request runtime
- **THEN** the client connects to SSE endpoint `/api/jobs/$id/progress`
- **AND** the server emits in-memory progress events for that job while the request-owned work is active

#### Scenario: Progress display for background library-processing jobs
- **WHEN** a queued `enrichment` or `match_snapshot_refresh` job is running inside the VPS worker process
- **THEN** the client SHALL read progress by polling persisted `job` state
- **AND** it SHALL use `status`, `progress`, and `error` fields from the database as the source of truth

#### Scenario: Terminal background library-processing job handling
- **WHEN** a polled `enrichment` or `match_snapshot_refresh` job reaches `completed` or `failed`
- **THEN** the polling consumer SHALL stop polling that job identifier
- **AND** it MAY re-read persisted library-processing-backed active work to discover a later ensured job
- **AND** it SHALL not depend on `user_preferences` job pointers or worker-owned chunk chaining

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

#### Scenario: Matching route loader
- **WHEN** navigating to `/match`
- **THEN** the route loader SHALL call `getMatchingSession` to preload context and total count
- **AND** follow the same pattern as the liked-songs route loader (`ensureQueryData`)

---

### Requirement: Optimistic Updates

The system SHALL provide optimistic updates for user actions.

#### Scenario: Add to playlist
- **WHEN** user adds song to playlist
- **THEN** immediately show playlist as "added" in the matches list (before server confirms)

#### Scenario: Dismiss song
- **WHEN** user dismisses a song
- **THEN** immediately remove all suggestions from the list and advance (before server confirms)

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

### Requirement: Retry utility module location

The system SHALL define Result retry utilities under shared utils.

#### Scenario: Retry helper location
- **WHEN** `withRetry` is referenced
- **THEN** it resides in `src/lib/shared/utils/result-wrappers/generic.ts`

### Requirement: Library-processing read models surface active work and first-match readiness

The system SHALL surface active library-processing work and derived first-match readiness through persisted read models and server functions backed by `library_processing_state` and `job`, not through `user_preferences` orchestration pointers or worker-owned SSE.

#### Scenario: Active background work is resolved from persisted library-processing state
- **WHEN** onboarding or dashboard loaders need to show current background processing state
- **THEN** the system SHALL resolve active `enrichment` and `match_snapshot_refresh` jobs from persisted library-processing state and job rows
- **AND** it SHALL not depend on `user_preferences.enrichment_job_id` or `user_preferences.target_playlist_match_refresh_job_id`

#### Scenario: First-match readiness is derived from the latest published snapshot
- **WHEN** a loader or server function needs to answer whether the account has a real visible match yet
- **THEN** it SHALL derive `firstMatchReady` from the latest published snapshot for that account
- **AND** it SHALL not persist a separate milestone flag in `library_processing_state`

#### Scenario: Existing polling and invalidation refresh cross-process progress
- **WHEN** a queued background library-processing job settles in the worker process
- **THEN** existing job polling and query invalidation flows SHALL refresh the corresponding read models
- **AND** the UI SHALL not require worker-runtime SSE or Supabase Realtime to observe that cross-process state change

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
import { insertMatchDecision } from '~/lib/data/match-decision-queries'

export const addSongToPlaylist = createServerFn()
  .validator(z.object({
    songId: z.uuid(),
    playlistId: z.uuid(),
    spotifyTrackId: z.string().min(1),
    spotifyPlaylistId: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    // Matching decisions are recorded in match_decision, not item_status
    await insertMatchDecision(session.accountId, data.songId, data.playlistId, 'added')
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
