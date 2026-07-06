# React Router 7 → TanStack Start Migration

Pattern-by-pattern migration guide for transitioning from React Router 7 to TanStack Start.

## Route Definition

### Before (RR7)

```tsx
// routes/posts.$postId.tsx
import type { Route } from './+types/posts.$postId'

export async function loader({ params }: Route.LoaderArgs) {
  return { post: await fetchPost(params.postId) }
}

export default function PostPage({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.post.title}</h1>
}
```

### After (TanStack)

```tsx
// src/routes/posts.$postId.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => ({ post: await fetchPost(params.postId) }),
  component: PostPage,
})

function PostPage() {
  const { post } = Route.useLoaderData()
  return <h1>{post.title}</h1>
}
```

**Key differences:**
- Export `Route` object instead of named exports
- Use `Route.useLoaderData()` hook instead of props
- Component defined inline or as local function

---

## API Routes

### Before (RR7)

```tsx
// routes/api.tracks.ts
import type { Route } from './+types/api.tracks'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireUserSession(request)
  const tracks = await getTracks(session.userId)
  return Response.json(tracks)
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireUserSession(request)
  const data = await request.json()
  const result = await createTrack(data)
  return Response.json(result)
}
```

### After (TanStack Start)

```tsx
// src/routes/api.tracks.ts (still works as route)
// OR use server functions (recommended):

// src/lib/functions/tracks.ts
import { createServerFn } from '@tanstack/react-start'

export const getTracks = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireUserSession()
    return getTracks(session.userId)
  })

export const createTrack = createServerFn({ method: 'POST' })
  .validator((data: TrackInput) => TrackInputSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireUserSession()
    return createTrack(session.userId, data)
  })
```

**Key differences:**
- Server functions are RPC-style, type-safe
- No need for manual `Response.json()`
- Validation built-in with `.validator()`

---

## Layout Routes

### Before (RR7)

```tsx
// routes/_app.tsx
export default function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main><Outlet /></main>
    </div>
  )
}

// routes/_app.dashboard.tsx
export default function Dashboard() { ... }
```

### After (TanStack)

```tsx
// src/routes/_app.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main><Outlet /></main>
    </div>
  )
}

// src/routes/_app.dashboard.tsx
export const Route = createFileRoute('/_app/dashboard')({
  component: Dashboard,
})

function Dashboard() { ... }
```

**Key differences:**
- Pathless routes use `_` prefix (same convention)
- Must export `Route` object with `component`

---

## Authentication Guards

### Before (RR7)

```tsx
// routes/_app.tsx
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUserSession(request)
  return { user }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return <UserProvider user={loaderData.user}><Outlet /></UserProvider>
}
```

### After (TanStack)

```tsx
// src/routes/_authed.tsx
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
    return { user }
  },
  component: () => {
    const { user } = Route.useRouteContext()
    return <UserProvider user={user}><Outlet /></UserProvider>
  },
})
```

**Key differences:**
- Use `beforeLoad` for auth checks (runs before loader)
- Return context from `beforeLoad` (merged into route context)
- Access via `Route.useRouteContext()`

---

## SSE Streams

### Before (RR7)

```tsx
// routes/api.events.ts
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireUserSession(request)

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const unsubscribe = eventEmitter.subscribe(session.userId, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })
      request.signal.addEventListener('abort', () => unsubscribe())
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}
```

### After (TanStack Start)

```tsx
// src/routes/api.events.ts (same pattern works!)
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/events')({
  loader: async ({ request }) => {
    const session = await requireUserSession()

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const unsubscribe = eventEmitter.subscribe(session.userId, (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        })
        request.signal.addEventListener('abort', () => unsubscribe())
      }
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  },
})
```

**Key differences:**
- Nearly identical! SSE works the same way
- Can also return Response objects from loaders

---

## Search Parameters

### Before (RR7)

```tsx
// Manual parsing
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') ?? '1')
  const sort = url.searchParams.get('sort') ?? 'desc'
  return { page, sort, data: await fetchData(page, sort) }
}
```

### After (TanStack)

```tsx
import { zodValidator, fallback } from '@tanstack/zod-adapter'

const searchSchema = z.object({
  page: fallback(z.number(), 1).default(1),
  sort: fallback(z.enum(['asc', 'desc']), 'desc').default('desc'),
})

export const Route = createFileRoute('/posts')({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => fetchData(deps.page, deps.sort),
  component: Posts,
})

function Posts() {
  const { page, sort } = Route.useSearch() // Fully typed!
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate({
      search: (prev) => ({ ...prev, page: prev.page + 1 })
    })}>
      Next
    </button>
  )
}
```

**Key differences:**
- Type-safe search params with Zod validation
- `loaderDeps` extracts search for cache key
- `fallback()` handles invalid values gracefully

---

## Data Fetching with TanStack Query

### Before (RR7)

```tsx
// Mixed pattern (loader + useQuery)
export async function loader() {
  return { initialData: await fetchInitialData() }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { data } = useQuery({
    queryKey: ['data'],
    queryFn: fetchData,
    initialData: loaderData.initialData,
  })
}
```

### After (TanStack Router + Query)

```tsx
// Router provides queryClient in context
export const Route = createFileRoute('/posts')({
  loader: async ({ context: { queryClient } }) => {
    // Prefetch and cache
    await queryClient.ensureQueryData(postsQueryOptions)
  },
  component: Posts,
})

function Posts() {
  // Suspense-enabled, uses prefetched data
  const { data } = useSuspenseQuery(postsQueryOptions)
  return <PostList posts={data} />
}

// Query options defined separately
const postsQueryOptions = queryOptions({
  queryKey: ['posts'],
  queryFn: fetchPosts,
  staleTime: 5 * 60 * 1000,
})
```

**Key differences:**
- QueryClient injected via router context
- `ensureQueryData` prefetches in loader
- `useSuspenseQuery` for Suspense integration

---

## File Structure Mapping

| RR7 | TanStack | Route |
|-----|----------|-------|
| `routes/_app.tsx` | `src/routes/_app.tsx` | Pathless layout |
| `routes/_app._index.tsx` | `src/routes/_app.index.tsx` | `/` (under layout) |
| `routes/_app.dashboard.tsx` | `src/routes/_app.dashboard.tsx` | `/dashboard` |
| `routes/api.tracks.ts` | `src/routes/api.tracks.ts` | `/api/tracks` |
| `routes/posts.$postId.tsx` | `src/routes/posts.$postId.tsx` | `/posts/:postId` |

---

## Migration Checklist

- [ ] Update vite.config.ts with `tanstackStart()` plugin
- [ ] Create src/router.tsx with `getRouter()` function
- [ ] Update root with `<RouterProvider>` and Start components
- [ ] Convert route files: export `Route` object
- [ ] Replace loader props with `Route.useLoaderData()`
- [ ] Add `validateSearch` with Zod for search params
- [ ] Convert API routes to server functions
- [ ] Update auth guards to use `beforeLoad`
- [ ] Add QueryClient to router context
- [ ] Test SSE streams (should work unchanged)
