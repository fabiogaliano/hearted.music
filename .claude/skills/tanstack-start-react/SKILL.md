---
name: tanstack-start-react
description: Full-stack React with TanStack Start + TanStack Router. Use for file-based routing, type-safe loaders, server functions (createServerFn), SSE, auth guards, TanStack Query, or migrating from React Router.
---

# TanStack Start + Router (React)

Full-stack React framework built on TanStack Router + Vite. Type-safe routing, server functions, and SSR.

## Quick Reference

### Route Definition

```tsx
// src/routes/posts.$postId.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$postId')({
  validateSearch: zodValidator(z.object({ tab: z.string().optional() })),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ params, deps }) => fetchPost(params.postId, deps.tab),
  component: PostComponent,
})

function PostComponent() {
  const post = Route.useLoaderData()
  const { postId } = Route.useParams()
  const { tab } = Route.useSearch()
  return <div>{post.title}</div>
}
```

### Server Functions

```tsx
import { createServerFn } from '@tanstack/react-start'

export const createPost = createServerFn({ method: 'POST' })
  .validator((data: { title: string }) => data)
  .handler(async ({ data }) => {
    return db.posts.create(data)
  })

// In loader or component
const post = await createPost({ data: { title: 'Hello' } })
```

### File Naming → Routes

| File | Route |
|------|-------|
| `__root.tsx` | Root layout |
| `index.tsx` | `/` |
| `posts.tsx` | `/posts` (layout) |
| `posts.index.tsx` | `/posts` (index) |
| `posts.$postId.tsx` | `/posts/:postId` |
| `_authed.tsx` | Pathless layout (auth guard) |
| `_authed.dashboard.tsx` | `/dashboard` (requires auth) |

## Core Patterns

### 1. Protected Routes

```tsx
// src/routes/_authed.tsx
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user }
  },
  component: () => <Outlet />,
})

// src/routes/_authed.dashboard.tsx — auto-protected
export const Route = createFileRoute('/_authed/dashboard')({
  component: () => {
    const { user } = Route.useRouteContext()
    return <h1>Welcome {user.name}</h1>
  },
})
```

### 2. Search Params with Zod

```tsx
import { zodValidator } from '@tanstack/zod-adapter'
import { fallback } from '@tanstack/zod-adapter'

const searchSchema = z.object({
  page: fallback(z.number(), 1).default(1),
  sort: fallback(z.enum(['asc', 'desc']), 'desc').default('desc'),
  filter: z.string().optional(),
})

export const Route = createFileRoute('/posts')({
  validateSearch: zodValidator(searchSchema),
  component: Posts,
})

function Posts() {
  const { page, sort, filter } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}>
      Next Page
    </button>
  )
}
```

### 3. Loader with TanStack Query Integration

```tsx
export const Route = createFileRoute('/posts')({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(postsQueryOptions)
  },
  component: Posts,
})

function Posts() {
  const { data: posts } = useSuspenseQuery(postsQueryOptions)
  return <PostList posts={posts} />
}
```

### 4. Code Splitting (Automatic)

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    tanstackStart({ autoCodeSplitting: true }),
    react(),
  ],
})
```

Or manual with `.lazy.tsx`:

```tsx
// posts.lazy.tsx — component code-split
export const Route = createLazyFileRoute('/posts')({
  component: PostsComponent,
  pendingComponent: () => <Skeleton />,
})
```

## Reference Guides

- **[Migration from React Router 7](references/migration.md)** — Pattern-by-pattern migration guide
- **[File-Based Routing](references/routing.md)** — Complete file naming conventions
- **[Server Functions](references/server-functions.md)** — Data mutations, middleware, SSE
- **[Project Patterns](references/patterns.md)** — v1_hearted architecture patterns

## Router Configuration

```tsx
// src/router.tsx
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultStaleTime: 0,
    defaultPreloadStaleTime: 30_000,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

## Key Hooks

| Hook | Purpose |
|------|---------|
| `Route.useParams()` | Type-safe path params |
| `Route.useSearch()` | Type-safe search params |
| `Route.useLoaderData()` | Loader return data |
| `Route.useRouteContext()` | Context from beforeLoad |
| `useNavigate()` | Programmatic navigation |
| `useRouter()` | Router instance |

## Navigation

```tsx
// Link with params and search
<Link
  to="/posts/$postId"
  params={{ postId: '123' }}
  search={{ tab: 'comments' }}
  activeProps={{ className: 'active' }}
>
  View Post
</Link>

// Relative navigation
<Link to="..">Back</Link>
<Link to=".">Reload</Link>

// Programmatic
const navigate = useNavigate()
navigate({ to: '/posts', search: { page: 2 } })
```
