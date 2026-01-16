# Data Flow Patterns

> How data moves through the new architecture

---

## Core Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API Layer | TanStack Start server functions | Type-safe, colocated with routes, single deployment |
| Real-time | SSE (Server-Sent Events) | Simpler than WebSocket, perfect for progress updates |
| State Management | TanStack Query + Zustand | Server state vs UI state separation |
| Type Safety | Valibot + Generated types | Runtime validation + compile-time safety |

---

## TanStack Start API Patterns

> **When to use each server-side pattern**

| Pattern | Use Case | Example |
|---------|----------|---------|
| `createServerFn()` | Type-safe RPC from components, data mutations, form handlers | `createServerFn({ method: 'POST' }).validator(schema).handler(...)` |
| `createAPIFileRoute()` | REST endpoints, SSE streams, webhooks, external integrations | `routes/api/events.tsx`, `routes/api/webhooks/spotify.tsx` |
| Route `loader` | Initial page data, runs isomorphically (server SSR + client nav) | Prefetch Query data, auth guards, redirects |

**Key insight**: Loaders are **isomorphic** (run on both server and client). Wrap server-only operations (DB access, secrets) in `createServerFn()`, then call from loader:

```typescript
// ✅ Correct: Server function wraps server-only code
const getProtectedData = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireUserSession()  // Server-only
    return await db.query(...)                   // Server-only
  })

export const Route = createFileRoute('/dashboard')({
  loader: () => getProtectedData(),  // Isomorphic call to server function
})

// ❌ Wrong: Direct server access in loader exposes to client
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    const secret = process.env.SECRET  // Exposed to client bundle!
  },
})
```

---

## Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐     ┌────────────────┐     ┌────────────────┐          │
│  │   Components   │◄────│  Query Cache   │◄────│   API Client   │          │
│  │                │     │ (TanStack)     │     │                │          │
│  │  MatchingPage  │     │                │     │  api.tracks    │          │
│  │  TrackList     │────►│  useTracks()   │────►│  api.playlists │          │
│  │  etc.          │     │  usePlaylists()│     │  api.matching  │          │
│  └───────┬────────┘     └────────────────┘     └───────┬────────┘          │
│          │                                              │                   │
│          │ UI State                                     │ HTTP              │
│          ▼                                              ▼                   │
│  ┌────────────────┐                            ┌────────────────┐          │
│  │  Zustand Store │                            │   SSE Client   │          │
│  │                │                            │                │          │
│  │  - selected    │                            │  /api/events   │          │
│  │  - ui state    │                            │                │          │
│  └────────────────┘                            └───────┬────────┘          │
│                                                        │                    │
└────────────────────────────────────────────────────────┼────────────────────┘
                                                         │
─────────────────────────────────────────────────────────┼─────────────────────
                                                         │
┌────────────────────────────────────────────────────────┼────────────────────┐
│                           SERVER                       │                     │
├────────────────────────────────────────────────────────┼────────────────────┤
│                                                        │                     │
│  ┌────────────────┐     ┌────────────────┐     ┌──────▼─────────┐          │
│  │  TanStack      │◄────│   Services     │────►│  SSE Emitter   │          │
│  │  Start Routes  │     │                │     │                │          │
│  │                │     │  SpotifyService│     │  progress      │          │
│  │  loader()      │────►│  MatchService  │────►│  new-match     │          │
│  │  serverFn()    │     │  AnalysisServ. │     │  analysis-done │          │
│  └───────┬────────┘     └───────┬────────┘     └────────────────┘          │
│          │                      │                                           │
│          │                      │                                           │
│          ▼                      ▼                                           │
│  ┌────────────────┐     ┌────────────────┐                                 │
│  │  Repositories  │◄────│   Validators   │                                 │
│  │                │     │   (Valibot)    │                                 │
│  │  TrackRepo     │     │                │                                 │
│  │  PlaylistRepo  │     │  At boundary:  │                                 │
│  │  MatchRepo     │     │  - params      │                                 │
│  └───────┬────────┘     │  - body        │                                 │
│          │              │  - response    │                                 │
│          ▼              └────────────────┘                                 │
│  ┌────────────────┐                                                        │
│  │   Supabase     │                                                        │
│  │   PostgreSQL   │                                                        │
│  └────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pattern 1: Query → Display

The most common pattern: fetch data, display it.

```typescript
// 1. API Client (lib/api/tracks.api.ts)
import { TracksResponseSchema } from '../schemas/tracks.schema'

export const tracksApi = {
  list: async () => {
    const res = await fetch('/api/tracks')
    if (!res.ok) throw new ApiError(res)
    return TracksResponseSchema.parse(await res.json())  // Validated!
  },

  byId: async (id: number) => {
    const res = await fetch(`/api/tracks/${id}`)
    if (!res.ok) throw new ApiError(res)
    return TrackSchema.parse(await res.json())
  }
}

// 2. Query Hook (lib/queries/tracks.queries.ts)
import { queryOptions, useQuery } from '@tanstack/react-query'
import { tracksApi } from '../api/tracks.api'

export const trackQueries = {
  all: queryOptions({
    queryKey: ['tracks'],
    queryFn: tracksApi.list,
    staleTime: 1000 * 60 * 5,  // 5 minutes
  }),

  byId: (id: number) => queryOptions({
    queryKey: ['tracks', id],
    queryFn: () => tracksApi.byId(id),
  })
}

// 3. Component (features/library/TrackList.tsx)
export function TrackList() {
  const { data: tracks, isLoading, error } = useQuery(trackQueries.all)

  if (isLoading) return <TrackListSkeleton />
  if (error) return <ErrorState error={error} />

  return (
    <div className="space-y-2">
      {tracks.map(track => (
        <TrackCard key={track.id} track={track} />
      ))}
    </div>
  )
}
```

---

## Pattern 2: Mutation → Invalidate → Refetch

Actions that change data.

```typescript
// 1. API Client
export const matchingApi = {
  runMatch: async (playlistId: number, trackIds: number[]) => {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId, trackIds })
    })
    if (!res.ok) throw new ApiError(res)
    return MatchResultsSchema.parse(await res.json())
  }
}

// 2. Mutation Hook (lib/mutations/matching.mutations.ts)
export function useRunMatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: matchingApi.runMatch,

    // Optimistic update (optional)
    onMutate: async ({ playlistId }) => {
      await queryClient.cancelQueries({ queryKey: ['matches', playlistId] })
      const previous = queryClient.getQueryData(['matches', playlistId])
      return { previous }
    },

    // On success, update cache
    onSuccess: (data, { playlistId }) => {
      queryClient.setQueryData(['matches', playlistId], data)
      // Also invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['playlists', playlistId] })
    },

    // On error, rollback
    onError: (err, { playlistId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['matches', playlistId], context.previous)
      }
    }
  })
}

// 3. Component usage
function MatchButton({ playlistId, trackIds }) {
  const { mutate: runMatch, isPending, error } = useRunMatch()

  return (
    <Button
      onClick={() => runMatch({ playlistId, trackIds })}
      disabled={isPending}
    >
      {isPending ? 'Matching...' : 'Find Matches'}
    </Button>
  )
}
```

---

## Pattern 3: SSE for Real-Time Updates

Progress updates and notifications.

```typescript
// 1. SSE Route (routes/api/events.tsx)
import { createAPIFileRoute } from '@tanstack/start/api'

export const Route = createAPIFileRoute('/api/events')({
  GET: async ({ request }) => {
    const session = await requireUserSession(request)

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        // Subscribe to events for this user
        const unsubscribe = eventEmitter.subscribe(session.userId, (event) => {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        })

        // Cleanup on close
        request.signal.addEventListener('abort', () => {
          unsubscribe()
          controller.close()
        })

        // Keep-alive ping every 30s
        const ping = setInterval(() => {
          controller.enqueue(encoder.encode(': ping\n\n'))
        }, 30000)

        request.signal.addEventListener('abort', () => clearInterval(ping))
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }
})

// 2. SSE Client Hook with Reconnection (lib/hooks/useServerEvents.ts)
export function useServerEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let eventSource: EventSource | null = null
    let retryCount = 0
    let retryTimeout: ReturnType<typeof setTimeout>
    const MAX_RETRIES = 5

    function connect() {
      eventSource = new EventSource('/api/events')

      eventSource.onopen = () => {
        retryCount = 0  // Reset on successful connection
      }

      eventSource.onerror = () => {
        eventSource?.close()

        if (retryCount < MAX_RETRIES) {
          retryCount++
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
          const delay = Math.min(1000 * 2 ** (retryCount - 1), 30000)
          retryTimeout = setTimeout(connect, delay)
        }
      }

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'analysis:progress':
            // Update analysis job cache
            queryClient.setQueryData(
              ['analysis-job', data.jobId],
              (old: any) => ({ ...old, progress: data.progress })
            )
            break

          case 'analysis:complete':
            // Invalidate to refetch fresh data
            queryClient.invalidateQueries({ queryKey: ['tracks'] })
            queryClient.invalidateQueries({ queryKey: ['analysis-job', data.jobId] })
            break

          case 'match:new':
            // Add to matches cache
            queryClient.setQueryData(
              ['matches', 'new'],
              (old: any[]) => [data.match, ...(old ?? [])]
            )
            break
        }
      }
    }

    connect()

    return () => {
      clearTimeout(retryTimeout)
      eventSource?.close()
    }
  }, [queryClient])
}

// 3. Use in root layout
function App() {
  useServerEvents()  // Subscribe once at app level
  return <Outlet />
}
```

---

## Pattern 4: UI State with Zustand

For state that doesn't belong to server.

```typescript
// lib/stores/ui.store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  // Sidebar
  sidebarOpen: boolean
  toggleSidebar: () => void

  // Matching UI
  selectedPlaylistId: number | null
  setSelectedPlaylist: (id: number | null) => void

  // View preferences
  trackViewMode: 'list' | 'grid'
  setTrackViewMode: (mode: 'list' | 'grid') => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Sidebar
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      // Matching
      selectedPlaylistId: null,
      setSelectedPlaylist: (id) => set({ selectedPlaylistId: id }),

      // View preferences
      trackViewMode: 'list',
      setTrackViewMode: (mode) => set({ trackViewMode: mode }),
    }),
    {
      name: 'ui-preferences',
      partitionKey: (state) => ['trackViewMode'],  // Only persist some fields
    }
  )
)
```

---

## Pattern 5: Form State with React Hook Form + Valibot

Forms with validation.

```typescript
// lib/schemas/playlist.schema.ts
import * as v from 'valibot'

export const CreatePlaylistSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(100)),
  description: v.optional(v.string()),
})

export type CreatePlaylistInput = v.InferOutput<typeof CreatePlaylistSchema>

// components/CreatePlaylistForm.tsx
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { CreatePlaylistSchema, type CreatePlaylistInput } from '~/lib/schemas'

export function CreatePlaylistForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate: createPlaylist, isPending } = useCreatePlaylist()

  const form = useForm<CreatePlaylistInput>({
    resolver: valibotResolver(CreatePlaylistSchema),
    defaultValues: {
      name: '',
      description: '',
    }
  })

  const onSubmit = (data: CreatePlaylistInput) => {
    createPlaylist(data, {
      onSuccess: () => {
        form.reset()
        onSuccess()
      }
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input
        {...form.register('name')}
        error={form.formState.errors.name?.message}
      />
      <Textarea
        {...form.register('description')}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Playlist'}
      </Button>
    </form>
  )
}
```

---

## Pattern 6: Type-Safe Routes with TanStack Start

Using file-based routing with type-safe loaders and server functions.

```typescript
// routes/api/tracks/$id.tsx
import { createAPIFileRoute } from '@tanstack/start/api'
import { z } from 'zod'

const ParamsSchema = z.object({
  id: z.coerce.number()
})

export const Route = createAPIFileRoute('/api/tracks/$id')({
  GET: async ({ request, params }) => {
    const session = await requireUserSession(request)
    const { id } = ParamsSchema.parse(params)

    const track = await trackRepository.getById(id)
    if (!track) {
      return new Response('Not Found', { status: 404 })
    }

    return Response.json(track)
  }
})

// routes/api/matching.tsx - Server function for mutations
import { createServerFn } from '@tanstack/start'
import { z } from 'zod'

const MatchRequestSchema = z.object({
  playlistId: z.number(),
  trackIds: z.array(z.number())
})

export const runMatchServerFn = createServerFn({ method: 'POST' })
  .validator(MatchRequestSchema)
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    const results = await matchingService.findMatches(
      session.userId,
      data.playlistId,
      data.trackIds
    )

    return { results }
  })

// Usage in component
import { runMatchServerFn } from '~/routes/api/matching'

function MatchButton({ playlistId, trackIds }) {
  const handleMatch = async () => {
    const result = await runMatchServerFn({ data: { playlistId, trackIds } })
    // Handle result
  }

  return <Button onClick={handleMatch}>Match</Button>
}
```

---

## Pattern 7: Route Loaders with TanStack Start + Query

Data loading at the route level with resilient parallel fetching.

### Option A: Server Function with allSettled (Simpler)

Use when you want partial data even if some fetches fail.

```typescript
// routes/_app/library/songs.tsx
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

// Helper to extract allSettled results with defaults
function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback
}

// Server function with resilient parallel loading
const getSongsLoader = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireUserSession()

    // allSettled: all fetches run, failures don't break the page
    const results = await Promise.allSettled([
      songsRepository.getLikedSongs(session.userId),
      newnessRepository.getNewCounts(session.userId),
      activityRepository.getRecent(session.userId, 5),
    ])

    return {
      songs: settled(results[0], []),
      newCounts: settled(results[1], { songs: 0, matches: 0 }),
      recentActivity: settled(results[2], []),
      // Surface which calls failed for error UI
      errors: results
        .map((r, i) => r.status === 'rejected' ? ['songs', 'newCounts', 'activity'][i] : null)
        .filter(Boolean),
    }
  })

export const Route = createFileRoute('/_app/library/songs')({
  loader: () => getSongsLoader(),
  component: SongsPage,
})

function SongsPage() {
  const { songs, newCounts, errors } = Route.useLoaderData()

  return (
    <div>
      {errors.length > 0 && <PartialDataWarning failed={errors} />}
      <h1>Your Liked Songs ({songs.length})</h1>
      {newCounts.songs > 0 && <Badge>{newCounts.songs} new</Badge>}
      <SongsList songs={songs} />
    </div>
  )
}
```

### Option B: TanStack Query Integration (Recommended for complex UIs)

Use when you need caching, background refetching, and optimistic updates.

```typescript
// lib/queries/songs.queries.ts
import { queryOptions } from '@tanstack/react-query'

export const songQueries = {
  liked: () => queryOptions({
    queryKey: ['songs', 'liked'],
    queryFn: () => songsApi.getLiked(),
    staleTime: 1000 * 60 * 5,  // 5 minutes
  }),

  newCounts: () => queryOptions({
    queryKey: ['songs', 'newCounts'],
    queryFn: () => newnessApi.getCounts(),
    staleTime: 1000 * 30,  // 30 seconds
  }),
}

// routes/_app/library/songs.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { songQueries } from '~/lib/queries/songs.queries'

export const Route = createFileRoute('/_app/library/songs')({
  loader: async ({ context: { queryClient } }) => {
    // Prefetch in parallel - errors handled by Query's error boundary
    await Promise.allSettled([
      queryClient.ensureQueryData(songQueries.liked()),
      queryClient.ensureQueryData(songQueries.newCounts()),
    ])
    // Return nothing - data comes from Query cache
  },
  component: SongsPage,
})

function SongsPage() {
  // useSuspenseQuery reads from prefetched cache
  const { data: songs } = useSuspenseQuery(songQueries.liked())
  const { data: newCounts } = useSuspenseQuery(songQueries.newCounts())

  return (
    <div>
      <h1>Your Liked Songs ({songs.length})</h1>
      {newCounts.songs > 0 && <Badge>{newCounts.songs} new</Badge>}
      <SongsList songs={songs} />
    </div>
  )
}
```

**Why `allSettled` over `all`?**
- `Promise.all` fails fast: one rejection cancels everything
- `Promise.allSettled` completes all: you get partial data + error info
- Better UX: show what you can, indicate what failed

---

## File Structure for Data Layer

```
lib/
├── api/                          # API clients
│   ├── client.ts                 # Base fetch wrapper with auth
│   ├── tracks.api.ts
│   ├── playlists.api.ts
│   ├── matching.api.ts
│   └── analysis.api.ts
│
├── queries/                      # TanStack Query definitions
│   ├── tracks.queries.ts
│   ├── playlists.queries.ts
│   ├── matching.queries.ts
│   └── analysis.queries.ts
│
├── mutations/                    # TanStack Query mutations
│   ├── tracks.mutations.ts
│   ├── playlists.mutations.ts
│   ├── matching.mutations.ts
│   └── analysis.mutations.ts
│
├── schemas/                      # Valibot schemas
│   ├── track.schema.ts
│   ├── playlist.schema.ts
│   ├── matching.schema.ts
│   └── common.schema.ts
│
├── stores/                       # Zustand stores
│   ├── ui.store.ts
│   ├── matching.store.ts
│   └── analysis.store.ts
│
├── hooks/                        # Custom hooks
│   ├── useServerEvents.ts        # SSE subscription
│   ├── useAnalysisProgress.ts    # Analysis job tracking
│   └── useNewItems.ts            # "New" badge tracking
│
└── validation/                   # Validation utilities
    ├── form-validators.ts
    ├── param-validators.ts
    └── response-validators.ts
```

---

## Summary: The Data Flow Contract

1. **API Client** → Validates response with Valibot schema
2. **Query Hook** → Caches in TanStack Query
3. **Component** → Receives typed data from cache
4. **Mutation** → Invalidates/updates cache on success
5. **SSE** → Pushes updates that invalidate relevant queries
6. **UI Store** → Handles non-server state (selections, preferences)
7. **Forms** → Validate input before mutation
