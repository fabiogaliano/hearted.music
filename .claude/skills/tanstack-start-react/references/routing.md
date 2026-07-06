# File-Based Routing Conventions

Complete reference for TanStack Router's file-based routing system.

## File Naming → Route Mapping

### Basic Routes

| File | Route Path | Description |
|------|-----------|-------------|
| `__root.tsx` | — | Root layout (wraps all routes) |
| `index.tsx` | `/` | Home page |
| `about.tsx` | `/about` | Static route |
| `posts.tsx` | `/posts` | Layout for `/posts/*` |
| `posts.index.tsx` | `/posts` | Index page for posts |
| `posts.$postId.tsx` | `/posts/:postId` | Dynamic segment |

### Dynamic Segments

```
$param      → Required dynamic segment
$           → Catch-all (splat) segment
```

**Examples:**

| File | Route | Params |
|------|-------|--------|
| `posts.$postId.tsx` | `/posts/123` | `{ postId: '123' }` |
| `users.$userId.posts.$postId.tsx` | `/users/1/posts/5` | `{ userId: '1', postId: '5' }` |
| `files.$.tsx` | `/files/a/b/c` | `{ '*': 'a/b/c' }` |

### Pathless Layouts (Grouping)

Prefix with `_` to create layout without URL segment:

| File | Route | Purpose |
|------|-------|---------|
| `_authed.tsx` | — | Auth layout (no URL) |
| `_authed.dashboard.tsx` | `/dashboard` | Protected dashboard |
| `_authed.settings.tsx` | `/settings` | Protected settings |
| `_public.tsx` | — | Public layout |
| `_public.login.tsx` | `/login` | Public login |

```
URL: /dashboard
Renders: _authed.tsx → _authed.dashboard.tsx
```

### Route Groups (Parentheses)

Group routes without affecting URL or component hierarchy:

```
(marketing)/
├── pricing.tsx      → /pricing
├── features.tsx     → /features
└── about.tsx        → /about

(app)/
├── dashboard.tsx    → /dashboard
└── settings.tsx     → /settings
```

Parentheses are stripped from URL but help organize files.

### Nested Layouts

**Flat file approach (recommended):**

```
posts.tsx                  → /posts (layout)
posts.index.tsx            → /posts (index)
posts.$postId.tsx          → /posts/:postId (layout)
posts.$postId.index.tsx    → /posts/:postId (index)
posts.$postId.edit.tsx     → /posts/:postId/edit
posts.$postId.comments.tsx → /posts/:postId/comments
```

**Directory approach (alternative):**

```
posts/
├── route.tsx              → /posts (layout)
├── index.tsx              → /posts (index)
└── $postId/
    ├── route.tsx          → /posts/:postId (layout)
    ├── index.tsx          → /posts/:postId (index)
    └── edit.tsx           → /posts/:postId/edit
```

### Special Files

| File | Purpose |
|------|---------|
| `__root.tsx` | Root layout (HTML shell) |
| `*.lazy.tsx` | Code-split component |
| `route.tsx` | Layout when using directories |

## Root Route Structure

```tsx
// src/routes/__root.tsx
import {
  createRootRoute,
  HeadContent,
  Scripts,
  Outlet,
} from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
    links: [{ rel: 'stylesheet', href: '/styles.css' }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
```

## Route with Context

```tsx
// src/routes/__root.tsx
import { createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})
```

## Layout Patterns

### Shell Layout (Sidebar + Main)

```tsx
// src/routes/_app.tsx
export const Route = createFileRoute('/_app')({
  component: AppShell,
})

function AppShell() {
  return (
    <div className="flex h-screen">
      <Sidebar className="w-64 shrink-0" />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

### Nested Layout with Context

```tsx
// src/routes/_app.library.tsx
export const Route = createFileRoute('/_app/library')({
  beforeLoad: () => ({ section: 'library' }),
  component: LibraryLayout,
})

function LibraryLayout() {
  return (
    <div>
      <LibraryNav />
      <Outlet />
    </div>
  )
}

// src/routes/_app.library.songs.tsx
export const Route = createFileRoute('/_app/library/songs')({
  component: () => {
    const { section } = Route.useRouteContext()
    // section = 'library'
    return <SongsList />
  },
})
```

## Optional Parameters

```tsx
// posts.{-$category}.tsx → /posts or /posts/tech
export const Route = createFileRoute('/posts/{-$category}')({
  component: Posts,
})

function Posts() {
  const { category } = Route.useParams() // category?: string
}

// Navigation with optional param
<Link to="/posts/{-$category}" params={{ category: undefined }}>All</Link>
<Link to="/posts/{-$category}" params={{ category: 'tech' }}>Tech</Link>
```

## Error and Loading States

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: fetchPost,
  component: Post,
  pendingComponent: () => <Skeleton />,
  pendingMs: 200,      // Show pending after 200ms
  pendingMinMs: 500,   // Keep showing for at least 500ms
  errorComponent: ({ error }) => <ErrorState error={error} />,
  notFoundComponent: () => <NotFound />,
})
```

## Route Configuration Reference

```tsx
export const Route = createFileRoute('/path')({
  // Data loading
  loader: async (ctx) => data,
  loaderDeps: ({ search }) => deps,
  beforeLoad: async (ctx) => context,

  // Validation
  validateSearch: zodValidator(schema),
  params: { parse: fn, stringify: fn },

  // Components
  component: Component,
  pendingComponent: Loading,
  errorComponent: Error,
  notFoundComponent: NotFound,

  // Caching
  staleTime: 5000,
  gcTime: 30000,
  shouldReload: false,
  preload: 'intent',
  preloadMaxAge: 10000,

  // Meta
  head: () => ({ title, meta, links }),

  // SSR
  ssr: true,
})
```

## Generated Route Tree

After routes are defined, TanStack generates `routeTree.gen.ts`:

```tsx
// src/routeTree.gen.ts (auto-generated)
export const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    appIndexRoute,
    appDashboardRoute,
    appLibraryRoute.addChildren([
      appLibrarySongsRoute,
      appLibraryPlaylistsRoute,
    ]),
  ]),
  publicRoute.addChildren([
    loginRoute,
  ]),
])
```

Import in router configuration:

```tsx
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({ routeTree })
}
```
