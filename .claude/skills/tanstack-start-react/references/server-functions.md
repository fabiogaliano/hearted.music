# Server Functions & Data Loading

Complete reference for TanStack Start server functions, data loading patterns, and middleware.

## Server Functions Basics

### Creating Server Functions

```tsx
import { createServerFn } from '@tanstack/react-start'

// GET (default)
export const getPosts = createServerFn()
  .handler(async () => {
    return db.posts.findMany()
  })

// POST with validation
export const createPost = createServerFn({ method: 'POST' })
  .validator((data: { title: string; content: string }) => {
    return PostSchema.parse(data) // Throws on invalid
  })
  .handler(async ({ data }) => {
    return db.posts.create({ data })
  })

// With context from middleware
export const getPrivatePosts = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return db.posts.findMany({ where: { userId: context.user.id } })
  })
```

### Using in Loaders

```tsx
export const Route = createFileRoute('/posts')({
  loader: () => getPosts(),
  component: Posts,
})

function Posts() {
  const posts = Route.useLoaderData()
  return <PostList posts={posts} />
}
```

### Using in Components

```tsx
function CreatePostForm() {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = async (formData: FormData) => {
    startTransition(async () => {
      const result = await createPost({
        data: {
          title: formData.get('title') as string,
          content: formData.get('content') as string,
        },
      })
      // Handle result
    })
  }

  return (
    <form action={handleSubmit}>
      <input name="title" />
      <textarea name="content" />
      <button disabled={isPending}>Create</button>
    </form>
  )
}
```

## File Organization

```
src/
├── lib/
│   ├── server/              # Server-only code (DB, secrets)
│   │   ├── db.ts
│   │   └── auth.server.ts
│   │
│   ├── functions/           # Server functions (safe to import)
│   │   ├── posts.ts
│   │   ├── users.ts
│   │   └── auth.ts
│   │
│   └── schemas/             # Shared validation
│       └── post.schema.ts
│
└── routes/
```

**Pattern: Separate server-only from functions**

```tsx
// lib/server/posts.server.ts — Server-only
import { db } from './db'

export async function findPostById(id: string) {
  return db.posts.findFirst({ where: { id } })
}

export async function createPostInDb(data: PostInput, userId: string) {
  return db.posts.create({ data: { ...data, userId } })
}

// lib/functions/posts.ts — Safe to import anywhere
import { createServerFn } from '@tanstack/react-start'
import { findPostById, createPostInDb } from '../server/posts.server'
import { authMiddleware } from './auth'

export const getPost = createServerFn()
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => findPostById(data.id))

export const createPost = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: PostInput) => PostInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    return createPostInDb(data, context.user.id)
  })
```

## Middleware

### Creating Middleware

```tsx
import { createMiddleware } from '@tanstack/react-start'

// Auth middleware
export const authMiddleware = createMiddleware({ type: 'function' })
  .server(async ({ next }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw new Error('Unauthorized')
    }
    return next({ context: { user } })
  })

// Logging middleware
export const loggingMiddleware = createMiddleware({ type: 'function' })
  .server(async ({ next, data }) => {
    console.log('Server function called:', data)
    const start = Date.now()
    const result = await next()
    console.log(`Completed in ${Date.now() - start}ms`)
    return result
  })
```

### Chaining Middleware

```tsx
export const adminAction = createServerFn({ method: 'POST' })
  .middleware([loggingMiddleware, authMiddleware, adminMiddleware])
  .handler(async ({ context }) => {
    // context.user is typed from authMiddleware
    // context.isAdmin is typed from adminMiddleware
  })
```

### Client-Side Middleware

```tsx
const authMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    // Add auth header before request
    const token = await getAuthToken()
    return next({
      headers: { Authorization: `Bearer ${token}` },
    })
  })
  .server(async ({ next, request }) => {
    // Verify on server
    const auth = request.headers.get('Authorization')
    const user = await verifyToken(auth)
    return next({ context: { user } })
  })
```

## Error Handling

### Throwing Errors

```tsx
import { redirect, notFound } from '@tanstack/react-router'

export const getPost = createServerFn()
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await findPostById(data.id)

    if (!post) {
      throw notFound()
    }

    return post
  })

export const requireAuth = createServerFn()
  .handler(async () => {
    const user = await getCurrentUser()

    if (!user) {
      throw redirect({ to: '/login' })
    }

    return user
  })
```

### Custom Error Responses

```tsx
export const createPost = createServerFn({ method: 'POST' })
  .validator((data: PostInput) => data)
  .handler(async ({ data }) => {
    try {
      return await db.posts.create({ data })
    } catch (error) {
      if (error.code === 'P2002') {
        return { error: 'A post with this title already exists' }
      }
      throw error
    }
  })
```

## SSE Streams

### Server Route for SSE

```tsx
// src/routes/api.events.ts
export const Route = createFileRoute('/api/events')({
  loader: async ({ request }) => {
    const user = await requireAuth()

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        // Send initial connection message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`))

        // Subscribe to events
        const unsubscribe = eventEmitter.subscribe(user.id, (event) => {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        })

        // Keep-alive ping
        const ping = setInterval(() => {
          controller.enqueue(encoder.encode(': ping\n\n'))
        }, 30000)

        // Cleanup on disconnect
        request.signal.addEventListener('abort', () => {
          unsubscribe()
          clearInterval(ping)
          controller.close()
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  },
})
```

### Client SSE Hook

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
            ['analysis', data.jobId],
            (old: any) => ({ ...old, progress: data.progress })
          )
          break

        case 'analysis:complete':
          queryClient.invalidateQueries({ queryKey: ['tracks'] })
          break

        case 'match:new':
          queryClient.setQueryData(
            ['matches', 'new'],
            (old: Match[] = []) => [data.match, ...old]
          )
          break
      }
    }

    eventSource.onerror = () => {
      // Reconnect handled automatically by EventSource
    }

    return () => eventSource.close()
  }, [queryClient])
}

// Use at app level
function App() {
  useServerEvents()
  return <Outlet />
}
```

## Request/Response Utilities

```tsx
import {
  getRequest,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'

export const getCachedData = createServerFn()
  .handler(async () => {
    // Read request headers
    const auth = getRequestHeader('Authorization')
    const accept = getRequestHeader('Accept')

    // Get full request
    const request = getRequest()
    const url = new URL(request.url)

    // Set response headers
    setResponseHeader('Cache-Control', 'public, max-age=300')
    setResponseHeader('X-Custom', 'value')

    // Set status code
    setResponseStatus(200)

    return fetchData()
  })
```

> ⚠️ **Critical: Server-Only Imports in Route Files**
>
> **Never import `getRequest` at the module level in route files!** Route files are isomorphic (bundled for both client and server). Top-level imports of server-only utilities cause virtual module resolution failures:
>
> ```
> Failed to resolve import "tanstack-start-injected-head-scripts:v"
> ```
>
> **❌ Wrong - causes bundling errors:**
> ```tsx
> // routes/index.tsx
> import { getRequest } from '@tanstack/react-start/server' // ❌ Module-level import
>
> export const Route = createFileRoute('/')({
>   beforeLoad: async () => {
>     const request = getRequest() // ❌ Direct call in beforeLoad
>     const session = getSession(request)
>     // ...
>   },
> })
> ```
>
> **✅ Correct - wrap in createServerFn:**
> ```tsx
> // routes/index.tsx
> import { createServerFn } from '@tanstack/react-start'
> import { getRequest } from '@tanstack/react-start/server'
>
> const getPageData = createServerFn({ method: 'GET' }).handler(async () => {
>   const request = getRequest() // ✅ Inside server function handler
>   const session = getSession(request)
>   return { isLoggedIn: !!session }
> })
>
> export const Route = createFileRoute('/')({
>   beforeLoad: async () => {
>     return getPageData() // ✅ Call the server function
>   },
> })
> ```
>
> **Why this happens:** The build process tree-shakes `createServerFn` implementations from client bundles, replacing them with RPC stubs. But bare imports of `getRequest` at module level get bundled into the client, triggering the virtual module error.
>
> **References:** [GitHub #6189](https://github.com/TanStack/router/issues/6189), [GitHub #5196](https://github.com/TanStack/router/issues/5196)

## Session Management

```tsx
import { useSession } from '@tanstack/react-start/server'

interface AppSession {
  userId?: string
  email?: string
}

export function useAppSession() {
  return useSession<AppSession>({
    name: 'app-session',
    password: process.env.SESSION_SECRET!,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60, // 7 days
    },
  })
}

// Login function
export const login = createServerFn({ method: 'POST' })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => {
    const user = await authenticateUser(data.email, data.password)

    if (!user) {
      return { error: 'Invalid credentials' }
    }

    const session = await useAppSession()
    await session.update({ userId: user.id, email: user.email })

    throw redirect({ to: '/dashboard' })
  })

// Logout function
export const logout = createServerFn({ method: 'POST' })
  .handler(async () => {
    const session = await useAppSession()
    await session.clear()
    throw redirect({ to: '/login' })
  })

// Get current user
export const getCurrentUser = createServerFn()
  .handler(async () => {
    const session = await useAppSession()
    const { userId } = session.data

    if (!userId) return null

    return db.users.findFirst({ where: { id: userId } })
  })
```

## Data Loading Patterns

### Loader with Dependencies

```tsx
export const Route = createFileRoute('/posts')({
  validateSearch: zodValidator(z.object({
    page: z.number().default(1),
    limit: z.number().default(20),
  })),

  // Extract search params as cache key dependencies
  loaderDeps: ({ search }) => ({
    page: search.page,
    limit: search.limit,
  }),

  loader: async ({ deps }) => {
    return getPosts({ page: deps.page, limit: deps.limit })
  },
})
```

### Parallel Data Loading

```tsx
export const Route = createFileRoute('/dashboard')({
  loader: async ({ context }) => {
    // Load in parallel
    const [user, stats, notifications] = await Promise.all([
      getUser(),
      getStats(),
      getNotifications(),
    ])

    return { user, stats, notifications }
  },
})
```

### Deferred Loading (Streaming)

```tsx
import { defer } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    const post = await getPost(params.postId)

    return {
      post,
      // Stream comments after initial render
      comments: defer(getComments(params.postId)),
    }
  },
  component: Post,
})

function Post() {
  const { post, comments } = Route.useLoaderData()

  return (
    <article>
      <h1>{post.title}</h1>
      <Suspense fallback={<CommentsSkeleton />}>
        <Await resolve={comments}>
          {(resolved) => <Comments data={resolved} />}
        </Await>
      </Suspense>
    </article>
  )
}
```
