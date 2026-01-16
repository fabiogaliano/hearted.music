# Dashboard Layout Design

> Main application interface after onboarding

---

## Current State Analysis

### Current Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Header (User Avatar + Name)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Overview] [Liked Songs] [Matching] [Playlists] [Settings]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                      Tab Content (varies by tab)                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Problems with Current

| Issue | Impact |
|-------|--------|
| Flat tab navigation | Core action (matching) is buried as one of 5 tabs |
| Overview is redundant | Shows stats that exist elsewhere, doesn't guide action |
| Quick Actions disconnect | Actions point to tabs but aren't wired up |
| No progress indicators | User doesn't see where they are in the flow |
| Settings as tab | Occupies prime navigation space for rarely-used feature |
| No "new" indicators | User can't see which songs need attention |
| Mixed data fetching | Deferred + React Query + Fetchers = complexity |
| No credits visibility | Monetization not integrated |

### Current Quick Actions

```
1. Match Songs to Playlists → switches to matching tab
2. Analyze Songs → starts batch analysis
3. Manage Playlists → switches to playlists tab
```

These are buttons that switch tabs - not a great UX pattern.

---

## Design Principles

### 1. Matching is the Hero

The core value of the app is matching songs to playlists. This should be front-and-center, not buried in a tab.

### 2. Progressive Disclosure

Don't show everything at once. Show what's relevant now.

### 3. Status at a Glance

User should instantly understand:
- How many songs need attention
- Current credits balance
- Sync status
- Analysis progress

### 4. Contextual Actions

Right actions at the right time. Don't show "Start Matching" if there are no songs to match.

---

## New Navigation Model

### Layout: Sidebar + Main Content

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  ┌─────────┐  ┌──────────────────────────────────────────────────────────────┐ │
│  │         │  │                                                              │ │
│  │ Sidebar │  │                                                              │ │
│  │         │  │                     Main Content Area                        │ │
│  │  Nav    │  │                                                              │ │
│  │  Items  │  │                     (varies by route)                        │ │
│  │         │  │                                                              │ │
│  │         │  │                                                              │ │
│  │         │  │                                                              │ │
│  │ ─────── │  │                                                              │ │
│  │ Status  │  │                                                              │ │
│  │ Credits │  │                                                              │ │
│  │ User    │  │                                                              │ │
│  └─────────┘  └──────────────────────────────────────────────────────────────┘ │
│                                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Why Sidebar?

| Benefit | Explanation |
|---------|-------------|
| Always visible status | Credits, sync status always visible |
| Hierarchical nav | Can expand/collapse sections |
| Spotify-like feel | Matches user's mental model |
| Mobile-friendly | Collapses to hamburger |
| Settings separate | User menu, not main nav |

---

## Sidebar Design

### Structure

```
┌─────────────────────────────┐
│  🎵 hearted.              [👤] │  ← Brand + user menu (settings, logout)
├─────────────────────────────┤
│                             │
│  🏠 Home                    │  ← Overview/dashboard
│                             │
│  ▶ Sort Songs           (3) │  ← Primary action, badge = new songs
│                             │
│  📚 Library                 │
│     ├─ Liked Songs    (847) │  ← With count
│     └─ Playlists       (23) │  ← With count
│                             │
│  ─────────────────────────  │
│                             │
│  📊 Status                  │  ← Collapsible section
│     Synced: 2 min ago       │
│     Analysis: 89% complete  │
│                             │
│  ─────────────────────────  │
│                             │
│  💳 Credits                 │  ← Monetization
│     47 / 50 remaining       │
│     ████████░░░░            │
│     [Get More Credits]      │
│                             │
└─────────────────────────────┘
```

### Navigation Items

| Item | Route | Badge | Priority |
|------|-------|-------|----------|
| Home | `/app` | - | P0 |
| Sort Songs | `/app/sort` | New songs count | P0 |
| Liked Songs | `/app/library/songs` | Total count | P1 |
| Playlists | `/app/library/playlists` | Total count | P1 |

### Bottom Section

- Status: Sync time, analysis progress
- Credits: Current balance, progress bar, upgrade CTA
- User menu: Opens modal with settings, logout, help

---

## Route Structure

### TanStack Start Routes

```
routes/
├── __root.tsx              → Root layout (providers, global styles)
├── index.tsx               → Landing (public)
├── login.tsx               → Spotify OAuth
├── onboarding.tsx          → New user flow
├── _app.tsx                → Dashboard layout (pathless, with sidebar)
├── _app/
│   ├── index.tsx           → Home (smart suggestions)
│   ├── sort.tsx            → Matching experience (hero feature)
│   └── library/
│       ├── _layout.tsx     → Library sub-layout (optional)
│       ├── songs.tsx       → Liked songs table
│       └── playlists.tsx   → Playlist management
└── api/
    ├── events.tsx          → SSE endpoint
    ├── tracks/
    │   └── $id.tsx         → Track by ID
    └── ...
```

### URL Paths

| URL | Route File | Description |
|-----|------------|-------------|
| `/` | `index.tsx` | Landing (public) |
| `/login` | `login.tsx` | Spotify OAuth |
| `/onboarding` | `onboarding.tsx` | New user flow |
| `/app` | `_app/index.tsx` | Home (smart suggestions) |
| `/app/sort` | `_app/sort.tsx` | Matching interface |
| `/app/library/songs` | `_app/library/songs.tsx` | Liked songs table |
| `/app/library/playlists` | `_app/library/playlists.tsx` | Playlist management |

### Route Responsibilities

| Route | What it does | Data needed |
|-------|--------------|-------------|
| `/app` | Smart home with suggestions | New songs, recent activity |
| `/app/sort` | Matching interface | Unmatched songs, flagged playlists |
| `/app/library/songs` | Browse all songs | Paginated songs list |
| `/app/library/playlists` | Manage playlists | All playlists |

---

## Home Page Design (`/app`)

### Purpose

Single-column timeline that guides user to the right action. Editorial magazine aesthetic.

### Layout (Timeline)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  WELCOME BACK                           847 SONGS · 89% ANALYZED | 2m ago Sync  │
│  Alex                                                                            │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  READY TO MATCH                                                           │  │
│  │                                                              ┌──┐ ┌──┐    │  │
│  │  5 new songs                                              ┌──┤  │ │  │    │  │
│  │                                                           │  └──┘ └──┘    │  │
│  │                                                           └──┘  Start →   │  │
│  │                                                    (fan-spread album art) │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  FLAGGED PLAYLISTS FOR MATCHING                                                 │
│  Workout Energy 47    Chill Vibes 89    Party Mix 65    Deep Focus 42          │
│  Manage →                                                                        │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  RECENT ACTIVITY                                                                │
│  ┌────┐  Blinding Lights                                                        │
│  │art │  The Weeknd                                                             │
│  └────┘  Matched to Workout Energy · 2h ago                                     │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  ┌────┐  Levitating                                                             │
│  │art │  Dua Lipa                                                               │
│  └────┘  Matched to Party Mix · 3h ago                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  View all activity →                                                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Design Decisions

| Element | Decision | Rationale |
|---------|----------|-----------|
| Single column | No side-by-side sections | Cleaner reading flow, editorial feel |
| Stats in header | Inline with sync status | De-emphasizes stats, keeps them accessible |
| Fan-spread album art | 3 rotated album covers in CTA | Visual interest, preview of what's waiting |
| Playlists horizontal | Row with "Manage →" below | Quick glance without taking focus |
| Timeline activity | Song + artist + matched playlist | Shows value of the app (songs getting sorted) |

### Conditional Content

| Condition | What to show |
|-----------|--------------|
| Has new songs | "Ready to match X songs" CTA with album art |
| No new songs | CTA hidden, focus on activity |
| No flagged playlists | Prompt to flag playlists |

---

## Sort Songs Page (`/app/sort`)

### Purpose

The hero experience. Where users spend most of their time.

### Layout (Split View - MVP)

From MATCHING-UI-DECISION.md, we start with Split View:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  Sort Your Songs                          [📊 Split] [🃏 Card] [📰 Feed]        │
│  12 songs waiting                                                               │
│                                                                                  │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │                                  │  │                                      │  │
│  │   CURRENT SONG                  │  │   MATCHING PLAYLISTS                 │  │
│  │                                  │  │                                      │  │
│  │   ┌────────────┐                │  │   ┌────────────────────────────────┐ │  │
│  │   │            │                │  │   │ 🏆 Workout Energy        94%   │ │  │
│  │   │  Album     │                │  │   │    High energy, upbeat tempo   │ │  │
│  │   │   Art      │                │  │   │                       [Add]    │ │  │
│  │   │            │                │  │   └────────────────────────────────┘ │  │
│  │   └────────────┘                │  │                                      │  │
│  │                                  │  │   ┌────────────────────────────────┐ │  │
│  │   "Blinding Lights"             │  │   │   Party Mix              87%   │ │  │
│  │   The Weeknd                    │  │   │    Dancing, celebration        │ │  │
│  │                                  │  │   │                       [Add]    │ │  │
│  │   Mood: Energetic, Nostalgic    │  │   └────────────────────────────────┘ │  │
│  │   Genre: Synth-pop, Dance       │  │                                      │  │
│  │   Themes: Night, Love           │  │   ┌────────────────────────────────┐ │  │
│  │                                  │  │   │   Late Night Drive      72%   │ │  │
│  │   ┌─────────────────────────┐   │  │   │    Driving, atmospheric       │ │  │
│  │   │  ▶  ●────────────  2:31 │   │  │   │                       [Add]    │ │  │
│  │   └─────────────────────────┘   │  │   └────────────────────────────────┘ │  │
│  │                                  │  │                                      │  │
│  └─────────────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  [← Previous]      [Skip for now]      [Added to 0 playlists]  [Next →] │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### View Toggle

Users can switch between views (saved to preferences):

```typescript
const viewModes = ['split', 'card', 'feed'] as const

// Split = Master-detail (MVP)
// Card = One at a time (v1.1)
// Feed = Scrollable list (v1.2)
```

---

## Library Pages

### Liked Songs (`/app/library/songs`)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  Your Liked Songs                                     [🔍 Search] [Filter ▼]   │
│  847 songs (756 analyzed)                                                       │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  □  Track             Artist           Album          Status    Actions  │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  □  Blinding Lights   The Weeknd       After Hours    ✓ Sorted  [···]   │   │
│  │  □  Levitating        Dua Lipa         Future Nost    ✓ Sorted  [···]   │   │
│  │  □  Heat Waves        Glass Animals    Dreamland      ⏳ Pending [···]   │   │
│  │  □  Bad Habit         Steve Lacy       Gemini Rights  🆕 New    [···]   │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  [◀ 1 2 3 4 5 ... 43 ▶]                               Showing 1-20 of 847      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Playlists (`/app/library/playlists`)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  Your Playlists                                       [🔍 Search] [Filter ▼]   │
│  23 playlists (12 flagged for sorting)                                          │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                                                                           │   │
│  │  Flagged for Sorting (12)                                                │   │
│  │  ────────────────────────────────────────────────────────────────────    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │   │
│  │  │ playlist │  │ playlist │  │ playlist │  │ playlist │               │   │
│  │  │   art    │  │   art    │  │   art    │  │   art    │               │   │
│  │  │          │  │          │  │          │  │          │               │   │
│  │  │Workout   │  │Party Mix │  │Chill     │  │Late Night│               │   │
│  │  │47 tracks │  │56 tracks │  │32 tracks │  │28 tracks │               │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘               │   │
│  │                                                                           │   │
│  │  Other Playlists (11)                                                    │   │
│  │  ────────────────────────────────────────────────────────────────────    │   │
│  │  ...                                                                      │   │
│  │                                                                           │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Settings Design

### Not a Tab - A Modal

Settings is accessed via user menu, opens as a modal overlay:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                   [✕]     │  │
│  │  Settings                                                                 │  │
│  │                                                                            │  │
│  │  ┌─────────────┐  ┌──────────────────────────────────────────────────┐   │  │
│  │  │             │  │                                                   │   │  │
│  │  │  Account    │  │  AI Provider                                     │   │  │
│  │  │  AI Keys    │  │                                                   │   │  │
│  │  │  Display    │  │  Current: Google AI (Gemini Pro)                 │   │  │
│  │  │  Sync       │  │                                                   │   │  │
│  │  │             │  │  API Key: ••••••••••••1234         [Change]      │   │  │
│  │  │             │  │                                                   │   │  │
│  │  │             │  │  ─────────────────────────────────────────────   │   │  │
│  │  │             │  │                                                   │   │  │
│  │  │             │  │  Other Providers                                  │   │  │
│  │  │             │  │  [+ Add OpenAI] [+ Add Anthropic]                │   │  │
│  │  │             │  │                                                   │   │  │
│  │  └─────────────┘  └──────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Settings Sections

| Section | Contents |
|---------|----------|
| Account | Spotify connection, profile |
| AI Keys | Provider management, key rotation |
| Display | Matching view preference, theme |
| Sync | Auto-sync settings, batch size |

---

## Mobile Responsiveness

### Collapsed Sidebar

```
┌──────────────────────────────────────────────┐
│  [☰]  🎵 hearted.                         [👤] │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│           Main Content                       │
│           (full width)                       │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│  [🏠] [▶ Sort (3)] [📚 Library]  [⚙]       │  ← Bottom nav
└──────────────────────────────────────────────┘
```

### Bottom Navigation Items

| Icon | Label | Route |
|------|-------|-------|
| 🏠 | Home | `/app` |
| ▶ | Sort | `/app/sort` |
| 📚 | Library | `/app/library` |
| ⚙ | Settings | Modal |

---

## Component Structure

```
app/
├── routes/                          # TanStack Start file-based routing
│   ├── __root.tsx                   ← Root layout (providers, error boundary)
│   ├── index.tsx                    ← Landing page (public)
│   ├── login.tsx                    ← Spotify OAuth
│   ├── onboarding.tsx               ← New user flow
│   ├── _app.tsx                     ← Dashboard layout (pathless, with sidebar)
│   ├── _app/
│   │   ├── index.tsx                ← Home (smart suggestions)
│   │   ├── sort.tsx                 ← Matching page
│   │   └── library/
│   │       ├── songs.tsx            ← Songs table
│   │       └── playlists.tsx        ← Playlist management
│   └── api/                         ← API routes
│       ├── events.tsx               ← SSE endpoint
│       └── ...
│
├── features/
│   ├── layout/
│   │   ├── Sidebar.tsx              ← Sidebar navigation
│   │   ├── SidebarNav.tsx           ← Nav items
│   │   ├── SidebarStatus.tsx        ← Sync/analysis status
│   │   ├── SidebarCredits.tsx       ← Credits display
│   │   ├── UserMenu.tsx             ← User dropdown
│   │   ├── MobileNav.tsx            ← Bottom nav for mobile
│   │   └── SettingsModal.tsx        ← Settings overlay
│   │
│   ├── home/
│   │   ├── index.ts                 ← Exports
│   │   ├── types.ts                 ← HomeProps, UserPlaylist, RecentActivityItem
│   │   └── variations/
│   │       └── HomeTimeline.tsx     ← Single-column timeline layout
│   │
│   ├── sort/
│   │   ├── SortPage.tsx             ← Container
│   │   ├── ViewToggle.tsx           ← Split/Card/Feed toggle
│   │   ├── views/
│   │   │   ├── SplitView.tsx        ← MVP
│   │   │   ├── CardView.tsx         ← v1.1
│   │   │   └── FeedView.tsx         ← v1.2
│   │   └── components/
│   │       ├── SongDetails.tsx
│   │       ├── PlaylistMatches.tsx
│   │       └── SortControls.tsx
│   │
│   └── library/
│       ├── songs/
│       │   ├── SongsPage.tsx
│       │   └── SongsTable.tsx
│       └── playlists/
│           ├── PlaylistsPage.tsx
│           └── PlaylistGrid.tsx
```

---

## Router Configuration

### Type Registration (Required for type-safe navigation)

```typescript
// src/router.tsx
import { createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,  // 1 minute default
      refetchOnWindowFocus: false,
    },
  },
})

export function createAppRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 30_000,  // Preload data valid for 30s
  })
}

// CRITICAL: Type registration for full type inference
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

export type AppRouter = ReturnType<typeof createAppRouter>
```

### Root Layout with Query Provider

```typescript
// routes/__root.tsx
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => {
    const { queryClient } = Route.useRouteContext()

    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    )
  },
})
```

---

## State Management

### Global State (Zustand)

```typescript
interface AppStore {
  // UI state
  sidebarCollapsed: boolean
  settingsOpen: boolean

  // User preferences (synced with server)
  matchingView: 'split' | 'card' | 'feed'

  // Transient state
  currentSortIndex: number
  skippedSongs: Set<string>
}
```

### Server State (TanStack Query)

```typescript
// Key patterns
const queryKeys = {
  user: ['user'],
  songs: {
    all: ['songs'],
    new: ['songs', 'new'],
    byId: (id: string) => ['songs', id],
  },
  playlists: {
    all: ['playlists'],
    flagged: ['playlists', 'flagged'],
    byId: (id: string) => ['playlists', id],
  },
  matches: (songId: string) => ['matches', songId],
}
```

---

## Data Flow

### Home Page

```
Route Loader:
  → user data
  → new songs count
  → library stats
  → recent activity

Client Queries:
  → None needed (all from loader)
```

### Sort Page

```
Route Loader:
  → unmatched songs (paginated)
  → flagged playlists (for matching)

Client Queries:
  → match results for current song (on demand)
  → prefetch next song's matches
```

### Library Pages

```
Route Loader:
  → paginated data based on URL params

Client Queries:
  → song details on row expand
  → playlist details on card click
```

---

## Empty States

### No New Songs

```
┌─────────────────────────────────────────┐
│                                          │
│         🎉 All caught up!               │
│                                          │
│    You've sorted all your liked songs.  │
│    Like more songs on Spotify and       │
│    we'll sync them here.                │
│                                          │
│         [🔄 Sync Now]                   │
│                                          │
└─────────────────────────────────────────┘
```

### No Flagged Playlists

```
┌─────────────────────────────────────────┐
│                                          │
│         📋 No playlists flagged         │
│                                          │
│    Flag some playlists so we know       │
│    where to suggest sorting songs.      │
│                                          │
│         [Go to Playlists]               │
│                                          │
└─────────────────────────────────────────┘
```

### Low Credits

```
┌─────────────────────────────────────────┐
│                                          │
│         💳 Running low on credits       │
│                                          │
│    You have 3 credits remaining.        │
│    Get more to continue analyzing.      │
│                                          │
│    [Get 100 Credits - $5]               │
│                                          │
└─────────────────────────────────────────┘
```

---

## Transitions

### Onboarding → Dashboard

After onboarding completes:
1. Redirect to `/app`
2. Show "Welcome!" toast
3. If songs need sorting, hero shows "Sort X songs"
4. If no flagged playlists, prompt to flag some

### Between Views

```typescript
import { Link, useNavigate } from '@tanstack/react-router'

// Programmatic navigation
const navigate = useNavigate()
navigate({ to: '/app/sort' })
navigate({ to: '/app/library/songs' })

// Declarative navigation with active state
<Link
  to="/app/sort"
  activeProps={{ className: 'bg-primary text-white' }}
  inactiveProps={{ className: 'text-muted-foreground' }}
>
  Sort Songs
</Link>

// With search params (type-safe)
<Link
  to="/app/library/songs"
  search={{ filter: 'new', page: 1 }}
>
  View New Songs
</Link>
```

### Type-Safe Search Params with Fallback

Always use `fallback()` for search params to handle invalid/missing values gracefully:

```typescript
// routes/_app/library/songs.tsx
import { createFileRoute } from '@tanstack/react-router'
import { zodValidator, fallback } from '@tanstack/zod-adapter'
import { z } from 'zod'

// Schema with fallback defaults - invalid values become defaults instead of errors
const songsSearchSchema = z.object({
  page: fallback(z.number().min(1), 1).default(1),
  filter: fallback(z.enum(['all', 'new', 'matched', 'unmatched']), 'all').default('all'),
  sort: fallback(z.enum(['recent', 'name', 'artist']), 'recent').default('recent'),
  q: z.string().optional(),  // Optional search query
})

export const Route = createFileRoute('/_app/library/songs')({
  validateSearch: zodValidator(songsSearchSchema),
  component: SongsPage,
})

function SongsPage() {
  const { page, filter, sort, q } = Route.useSearch()
  const navigate = useNavigate()

  // Type-safe search param updates
  const setFilter = (newFilter: typeof filter) => {
    navigate({
      search: (prev) => ({ ...prev, filter: newFilter, page: 1 }),
    })
  }

  const nextPage = () => {
    navigate({
      search: (prev) => ({ ...prev, page: prev.page + 1 }),
    })
  }

  return (/* ... */)
}
```

**Why `fallback()`?**
- User bookmarks URL with `?filter=old` → app doesn't crash, uses 'all'
- Typos in manually-entered URLs gracefully degrade
- Removes need for defensive guards in components

---

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `j` / `↓` | Next song (in sort view) |
| `k` / `↑` | Previous song |
| `1-9` | Add to playlist N |
| `s` | Skip song |
| `?` | Show keyboard shortcuts |
| `/` | Focus search |

---

## Next Steps

1. [ ] Implement `_app.tsx` layout shell with sidebar
2. [ ] Create sidebar components (nav, status, credits)
3. [ ] Build home page with smart suggestions
4. [ ] Migrate sort page with view toggle
5. [ ] Create library sub-routes
6. [ ] Add settings modal
7. [ ] Implement mobile responsive behavior
8. [ ] Add keyboard shortcuts
