# Project Architecture Patterns

Patterns tailored for the hearted app architecture: data flow, state management, and UI patterns.

## Data Flow Architecture

### Layer Separation

| Layer | Location | Purpose |
|-------|----------|---------|
| **API Client** | `lib/api/*.ts` | Fetch + Valibot validation |
| **Server Functions** | `lib/functions/*.ts` | RPC endpoints |
| **Query Cache** | TanStack Query | Server state |
| **UI State** | Zustand | Local preferences |
| **Real-time** | SSE `/api/events` | Progress & updates |

### Pattern 1: Query → Display

```tsx
// 1. Schema (lib/schemas/track.schema.ts)
export const TrackSchema = v.object({
  id: v.string(),
  name: v.string(),
  artist: v.string(),
  isNew: v.boolean(),
})

export type Track = v.InferOutput<typeof TrackSchema>

// 2. Server function (lib/functions/tracks.ts)
export const getTracks = createServerFn()
  .handler(async () => {
    const tracks = await db.tracks.findMany()
    return v.parse(v.array(TrackSchema), tracks)
  })

// 3. Query options (lib/queries/tracks.ts)
export const tracksQueryOptions = queryOptions({
  queryKey: ['tracks'],
  queryFn: () => getTracks(),
  staleTime: 5 * 60 * 1000,
})

// 4. Route loader (routes/_app.library.songs.tsx)
export const Route = createFileRoute('/_app/library/songs')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(tracksQueryOptions),
  component: SongsPage,
})

// 5. Component (minimal)
function SongsPage() {
  const { data: tracks } = useSuspenseQuery(tracksQueryOptions)
  return <TrackList tracks={tracks} />
}
```

### Pattern 2: Mutation → Invalidate → Refetch

```tsx
// lib/mutations/matching.ts
export function useRunMatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { trackId: string; playlistId: string }) =>
      addToPlaylist(data),

    // Optimistic update
    onMutate: async ({ trackId, playlistId }) => {
      await queryClient.cancelQueries({ queryKey: ['tracks'] })

      const previous = queryClient.getQueryData(['tracks'])

      queryClient.setQueryData(['tracks'], (old: Track[]) =>
        old.map(t => t.id === trackId ? { ...t, isNew: false } : t)
      )

      return { previous }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },

    onError: (err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tracks'], context.previous)
      }
    },
  })
}
```

### Pattern 3: SSE Real-Time Updates

```tsx
// lib/hooks/useServerEvents.ts
export function useServerEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const eventSource = new EventSource('/api/events')

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)

      switch (data.type) {
        case 'analysis:progress':
          queryClient.setQueryData(
            ['analysis-job', data.jobId],
            (old: AnalysisJob) => ({ ...old, progress: data.progress })
          )
          break

        case 'analysis:complete':
          queryClient.invalidateQueries({ queryKey: ['tracks'] })
          queryClient.invalidateQueries({ queryKey: ['analysis-job', data.jobId] })
          toast.success('Analysis complete!')
          break

        case 'track:new':
          // Add to new items without full refetch
          queryClient.setQueryData(
            ['tracks', 'new'],
            (old: string[] = []) => [data.trackId, ...old]
          )
          break
      }
    }

    return () => eventSource.close()
  }, [queryClient])
}

// Use at root
function App() {
  useServerEvents()
  return <Outlet />
}
```

## State Management

### Zustand for UI State Only

```tsx
// lib/stores/ui.store.ts
interface UIStore {
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  matchingView: 'split' | 'card' | 'feed'
  setMatchingView: (view: UIStore['matchingView']) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      matchingView: 'split',
      setMatchingView: (view) => set({ matchingView: view }),
    }),
    { name: 'ui-preferences' }
  )
)
```

### Query Keys Convention

```tsx
// lib/queries/keys.ts
export const queryKeys = {
  user: ['user'] as const,

  tracks: {
    all: ['tracks'] as const,
    new: ['tracks', 'new'] as const,
    byId: (id: string) => ['tracks', id] as const,
  },

  playlists: {
    all: ['playlists'] as const,
    byId: (id: string) => ['playlists', id] as const,
    songs: (id: string) => ['playlists', id, 'songs'] as const,
  },

  matches: (trackId: string) => ['matches', trackId] as const,

  analysis: {
    job: (id: string) => ['analysis-job', id] as const,
  },
}
```

## Route Structure

### Dashboard Shell

```
src/routes/
├── __root.tsx                 # HTML shell, providers
├── _public.tsx                # Public layout (no auth)
├── _public.login.tsx          # /login
├── _app.tsx                   # App shell (sidebar + main)
├── _app.index.tsx             # /
├── _app.sort.tsx              # /sort (matching)
├── _app.library.tsx           # Library layout
├── _app.library.songs.tsx     # /library/songs
├── _app.library.playlists.tsx # /library/playlists
└── api.events.ts              # /api/events (SSE)
```

### Shell Layout Pattern

```tsx
// routes/_app.tsx
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user }
  },
  component: AppShell,
})

function AppShell() {
  const { user } = Route.useRouteContext()
  const { sidebarCollapsed } = useUIStore()

  return (
    <div className="flex h-screen">
      <Sidebar collapsed={sidebarCollapsed} user={user} />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

## Newness Tracking Pattern

### View-Based Clearing

```tsx
// lib/hooks/useTrackNewness.ts
export function useTrackNewness(trackId: string, isNew: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isNew || !ref.current) return

    let timeoutId: ReturnType<typeof setTimeout>

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // 2 seconds visible = mark as viewed
            timeoutId = setTimeout(() => {
              markAsViewed({ itemType: 'track', itemId: trackId })

              queryClient.setQueryData(
                queryKeys.tracks.new,
                (old: string[] = []) => old.filter(id => id !== trackId)
              )
            }, 2000)
          } else {
            clearTimeout(timeoutId)
          }
        })
      },
      { threshold: 0.5 }
    )

    observer.observe(ref.current)

    return () => {
      observer.disconnect()
      clearTimeout(timeoutId)
    }
  }, [trackId, isNew, queryClient])

  return ref
}

// Usage in component
function TrackCard({ track }: { track: Track }) {
  const ref = useTrackNewness(track.id, track.isNew)

  return (
    <div ref={ref} className={cn(track.isNew && 'ring-2 ring-primary')}>
      {track.name}
    </div>
  )
}
```

### Action-Based Clearing

```tsx
export function useAddToPlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addToPlaylistFn,
    onSuccess: (_, { trackId }) => {
      // Clear newness on action
      queryClient.setQueryData(
        queryKeys.tracks.new,
        (old: string[] = []) => old.filter(id => id !== trackId)
      )
    },
  })
}
```

## View Mode Pattern

```tsx
// features/sort/SortPage.tsx
export function SortPage() {
  const { matchingView } = useUIStore()
  const { data: tracks } = useSuspenseQuery(newTracksQueryOptions)

  return (
    <div className="h-full">
      <ViewToggle />

      {matchingView === 'split' && <SplitView tracks={tracks} />}
      {matchingView === 'card' && <CardView tracks={tracks} />}
      {matchingView === 'feed' && <FeedView tracks={tracks} />}
    </div>
  )
}

// Same data, different presentation
function SplitView({ tracks }: { tracks: Track[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="grid grid-cols-2 h-full">
      <TrackList
        tracks={tracks}
        selected={selected}
        onSelect={setSelected}
      />
      <MatchingPanel trackId={selected} />
    </div>
  )
}
```

## Form Pattern with Server Functions

```tsx
// features/playlist/CreatePlaylistForm.tsx
const CreatePlaylistSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  description: v.optional(v.string()),
})

export function CreatePlaylistForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm({
    resolver: valibotResolver(CreatePlaylistSchema),
    defaultValues: { name: '', description: '' },
  })

  const [isPending, startTransition] = useTransition()

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const result = await createPlaylist({ data })

      if (result.error) {
        form.setError('name', { message: result.error })
        return
      }

      onSuccess()
    })
  })

  return (
    <form onSubmit={onSubmit}>
      <Input {...form.register('name')} placeholder="Playlist name" />
      <Textarea {...form.register('description')} placeholder="Description" />
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create'}
      </Button>
    </form>
  )
}
```

## Error Handling Pattern

```tsx
// Explicit error states, not defensive guards
function TrackList({ tracks }: { tracks: Track[] }) {
  // Don't do: tracks?.length > 0 ? ... : null
  // Data is validated at boundary, trust it here

  if (tracks.length === 0) {
    return <EmptyState message="No tracks yet" />
  }

  return (
    <ul>
      {tracks.map(track => (
        <TrackCard key={track.id} track={track} />
      ))}
    </ul>
  )
}

// Route-level error handling
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    const post = await getPost({ id: params.postId })
    if (!post) throw notFound()
    return post
  },
  component: Post,
  errorComponent: ({ error }) => (
    <ErrorState
      message={error.message}
      action={<Link to="/posts">Back to posts</Link>}
    />
  ),
  notFoundComponent: () => (
    <NotFound message="Post not found" />
  ),
})
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Mixed fetching** | Manual fetch() + useQuery | Consistent server functions + Query |
| **Local interfaces** | Types duplicated | Single source: Valibot schemas |
| **Defensive guards** | `Array.isArray(x) ? x : []` | Validate at boundary, trust inside |
| **Giant components** | 400+ line files | Compose smaller focused pieces |
| **N+1 queries** | Loop fetching | Batch queries, Promise.all |
| **Error swallowing** | Empty data on error | Explicit error/empty states |
