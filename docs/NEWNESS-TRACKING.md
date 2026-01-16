# Newness Tracking System

> How to track what's "new" for users and when to clear the status

---

## Problem Statement

User needs to know:
1. Which songs were added since last visit
2. Which matches were generated since last visit
3. Which analyses completed since last visit

**Key question**: When does something stop being "new"?

---

## Solution: Multi-Strategy Clearing

Different clearing strategies for different contexts:

| Strategy | When to Use | Example |
|----------|-------------|---------|
| **Explicit clear** | User takes deliberate action | "Mark all as read" button |
| **Action-based** | User interacts with item | Adding song to playlist |
| **View-based** | Item shown in viewport | Song visible for 2+ seconds |
| **Age-based** | Time-based expiry | Auto-clear after 7 days |

---

## Database Schema

```sql
CREATE TABLE user_item_status (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,              -- 'track', 'match', 'analysis', 'playlist'
  item_id INTEGER NOT NULL,

  -- Newness state
  is_new BOOLEAN DEFAULT true,
  first_appeared_at TIMESTAMPTZ DEFAULT now(),

  -- View tracking (for view-based clearing)
  view_count INTEGER DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,

  -- Action tracking (for action-based clearing)
  action_type TEXT,                     -- 'added_to_playlist', 'skipped', 'analyzed'
  action_at TIMESTAMPTZ,

  -- Composite unique constraint
  UNIQUE(user_id, item_type, item_id)
);

-- Index for efficient queries
CREATE INDEX idx_user_item_status_new ON user_item_status(user_id, item_type, is_new)
  WHERE is_new = true;

CREATE INDEX idx_user_item_status_type ON user_item_status(user_id, item_type);
```

---

## Clearing Strategies Implementation

### Strategy 1: Explicit Clear (User-Initiated)

```typescript
// Server function: Mark items as seen
import { createServerFn } from '@tanstack/start'
import { z } from 'zod'

const MarkSeenSchema = z.object({
  itemType: z.enum(['track', 'match', 'analysis', 'playlist']),
  itemIds: z.array(z.string()).optional(), // If empty, marks all
})

export const markSeenFn = createServerFn({ method: 'POST' })
  .validator(MarkSeenSchema)
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    if (data.itemIds?.length) {
      // Mark specific items
      await db
        .update(userItemStatus)
        .set({
          is_new: false,
          viewed_at: new Date()
        })
        .where(
          and(
            eq(userItemStatus.account_id, session.userId),
            eq(userItemStatus.item_type, data.itemType),
            inArray(userItemStatus.item_id, data.itemIds)
          )
        )
    } else {
      // Mark all of type as seen
      await db
        .update(userItemStatus)
        .set({
          is_new: false,
          viewed_at: new Date()
        })
        .where(
          and(
            eq(userItemStatus.account_id, session.userId),
            eq(userItemStatus.item_type, data.itemType)
          )
        )
    }

    return { success: true }
  })

// Component
function NewItemsHeader({ type, count }: { type: string; count: number }) {
  const { mutate: markSeen } = useMarkSeen()

  if (count === 0) return null

  return (
    <div className="flex items-center justify-between">
      <Badge variant="new">{count} new</Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => markSeen({ itemType: type })}
      >
        Mark all as seen
      </Button>
    </div>
  )
}
```

### Strategy 2: Action-Based Clear

```typescript
// When user adds song to playlist, automatically clear "new" status
export function useAddToPlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ trackId, playlistId }) => {
      const res = await fetch('/api/playlist/add-track', {
        method: 'POST',
        body: JSON.stringify({ trackId, playlistId })
      })
      return res.json()
    },
    onSuccess: (_, { trackId }) => {
      // Clear newness for this track
      queryClient.setQueryData(['new-items', 'track'], (old: number[]) =>
        old?.filter(id => id !== trackId) ?? []
      )

      // Update server-side
      fetch('/api/items/mark-actioned', {
        method: 'POST',
        body: JSON.stringify({
          itemType: 'track',
          itemId: trackId,
          actionType: 'added_to_playlist'
        })
      })
    }
  })
}
```

### Strategy 3: View-Based Clear (Intersection Observer)

```typescript
// hooks/useTrackNewness.ts
export function useTrackNewness(trackId: number, isNew: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isNew || !ref.current) return

    let timeoutId: NodeJS.Timeout

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Start 2-second timer when item enters viewport
            timeoutId = setTimeout(() => {
              // Clear newness after 2 seconds of visibility
              fetch('/api/items/mark-viewed', {
                method: 'POST',
                body: JSON.stringify({
                  itemType: 'track',
                  itemId: trackId
                })
              })

              queryClient.setQueryData(['new-items', 'track'], (old: number[]) =>
                old?.filter(id => id !== trackId) ?? []
              )
            }, 2000)
          } else {
            // Cancel if item leaves viewport before 2 seconds
            clearTimeout(timeoutId)
          }
        })
      },
      { threshold: 0.5 }  // 50% visible
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
  const { data: newItems } = useNewItems('track')
  const isNew = newItems?.includes(track.id)
  const ref = useTrackNewness(track.id, isNew)

  return (
    <div ref={ref} className="relative">
      {isNew && <NewBadge />}
      {/* rest of card */}
    </div>
  )
}
```

### Strategy 4: Age-Based Clear (Background Job)

```typescript
// Cron job or scheduled function (runs daily)
async function clearStaleNewItems() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  await db
    .update(userItemStatus)
    .set({ is_new: false })
    .where(
      and(
        eq(userItemStatus.is_new, true),
        lt(userItemStatus.first_appeared_at, sevenDaysAgo)
      )
    )
}
```

---

## Query Hooks

```typescript
// lib/queries/newItems.queries.ts
export const newItemsQueries = {
  byType: (type: 'track' | 'match' | 'analysis') => queryOptions({
    queryKey: ['new-items', type],
    queryFn: async () => {
      const res = await fetch(`/api/items/new?type=${type}`)
      return NewItemsSchema.parse(await res.json())
    },
    staleTime: 1000 * 60,  // 1 minute
  }),

  counts: queryOptions({
    queryKey: ['new-items', 'counts'],
    queryFn: async () => {
      const res = await fetch('/api/items/new/counts')
      return NewItemsCountsSchema.parse(await res.json())
    },
    staleTime: 1000 * 30,  // 30 seconds
  })
}

// Hook for component use
export function useNewItems(type: 'track' | 'match' | 'analysis') {
  return useQuery(newItemsQueries.byType(type))
}

export function useNewItemsCounts() {
  return useQuery(newItemsQueries.counts)
}
```

---

## Server Functions

```typescript
// lib/server/newness.server.ts
import { createServerFn } from '@tanstack/start'
import { z } from 'zod'

// Get new item IDs by type
export const getNewItemsFn = createServerFn({ method: 'GET' })
  .validator(z.object({
    type: z.enum(['track', 'match', 'analysis', 'playlist'])
  }))
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    const newItems = await db
      .select({ item_id: userItemStatus.item_id })
      .from(userItemStatus)
      .where(
        and(
          eq(userItemStatus.account_id, session.userId),
          eq(userItemStatus.item_type, data.type),
          eq(userItemStatus.is_new, true)
        )
      )

    return newItems.map(i => i.item_id)
  })

// Get new counts for all types
export const getNewCountsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireUserSession()

    const counts = await db
      .select({
        item_type: userItemStatus.item_type,
        count: sql<number>`count(*)`
      })
      .from(userItemStatus)
      .where(
        and(
          eq(userItemStatus.account_id, session.userId),
          eq(userItemStatus.is_new, true)
        )
      )
      .groupBy(userItemStatus.item_type)

    return Object.fromEntries(counts.map(c => [c.item_type, c.count]))
  })

// Mark items as viewed (called from intersection observer)
export const markViewedFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    itemType: z.enum(['track', 'match', 'analysis', 'playlist']),
    itemId: z.string()
  }))
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    await db
      .update(userItemStatus)
      .set({
        is_new: false,
        viewed_at: new Date()
      })
      .where(
        and(
          eq(userItemStatus.account_id, session.userId),
          eq(userItemStatus.item_type, data.itemType),
          eq(userItemStatus.item_id, data.itemId)
        )
      )

    return { success: true }
  })

// Mark items as actioned (added to playlist, skipped, etc.)
export const markActionedFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    itemType: z.enum(['track', 'match', 'analysis', 'playlist']),
    itemId: z.string(),
    actionType: z.enum(['added_to_playlist', 'skipped', 'dismissed'])
  }))
  .handler(async ({ data }) => {
    const session = await requireUserSession()

    await db
      .update(userItemStatus)
      .set({
        is_new: false,
        actioned_at: new Date(),
        action_type: data.actionType
      })
      .where(
        and(
          eq(userItemStatus.account_id, session.userId),
          eq(userItemStatus.item_type, data.itemType),
          eq(userItemStatus.item_id, data.itemId)
        )
      )

    return { success: true }
  })
```

---

## Creating New Items (Server-Side)

```typescript
// When a new track is synced
async function onTracksSynced(userId: number, trackIds: number[]) {
  // Batch insert new items
  await db.insert(userItemStatus)
    .values(trackIds.map(trackId => ({
      user_id: userId,
      item_type: 'track',
      item_id: trackId,
      is_new: true,
      first_appeared_at: new Date()
    })))
    .onConflictDoNothing()  // Ignore if already exists

  // Emit SSE event
  eventEmitter.emit(userId, {
    type: 'new-items',
    itemType: 'track',
    count: trackIds.length
  })
}

// When a match is generated
async function onMatchGenerated(userId: number, matchId: number) {
  await db.insert(userItemStatus)
    .values({
      user_id: userId,
      item_type: 'match',
      item_id: matchId,
      is_new: true
    })
    .onConflictDoNothing()

  eventEmitter.emit(userId, {
    type: 'new-match',
    matchId
  })
}
```

---

## SSE Integration

```typescript
// In useServerEvents hook
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case 'new-items':
      // Invalidate new items cache
      queryClient.invalidateQueries({
        queryKey: ['new-items', data.itemType]
      })
      queryClient.invalidateQueries({
        queryKey: ['new-items', 'counts']
      })

      // Show toast for significant new items
      if (data.count > 0) {
        toast.info(`${data.count} new ${data.itemType}s`, {
          action: {
            label: 'View',
            onClick: () => navigate(`/${data.itemType}s?filter=new`)
          }
        })
      }
      break

    case 'new-match':
      queryClient.invalidateQueries({ queryKey: ['new-items', 'match'] })
      queryClient.invalidateQueries({ queryKey: ['new-items', 'counts'] })
      break
  }
}
```

---

## UI Components

### New Badge

```typescript
// components/ui/NewBadge.tsx
export function NewBadge({ className }: { className?: string }) {
  return (
    <span className={cn(
      'absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center',
      'rounded-full bg-blue-500 text-[10px] font-bold text-white',
      'animate-pulse',
      className
    )}>
      NEW
    </span>
  )
}

// Or simpler dot
export function NewDot({ className }: { className?: string }) {
  return (
    <span className={cn(
      'absolute top-0 right-0 h-2 w-2 rounded-full bg-blue-500',
      className
    )} />
  )
}
```

### New Items Filter

```typescript
// components/NewItemsFilter.tsx
export function NewItemsFilter({ type }: { type: string }) {
  const [showNew, setShowNew] = useSearchParams()
  const { data: count } = useNewItemsCount(type)

  return (
    <Toggle
      pressed={showNew.get('filter') === 'new'}
      onPressedChange={(pressed) => {
        setShowNew(prev => {
          if (pressed) prev.set('filter', 'new')
          else prev.delete('filter')
          return prev
        })
      }}
    >
      Show new only
      {count > 0 && <Badge variant="secondary" className="ml-2">{count}</Badge>}
    </Toggle>
  )
}
```

### Sidebar with Counts

```typescript
// components/Sidebar.tsx
export function Sidebar() {
  const { data: counts } = useNewItemsCounts()

  return (
    <nav>
      <NavLink to="/tracks">
        Liked Songs
        {counts?.track > 0 && <Badge>{counts.track} new</Badge>}
      </NavLink>
      <NavLink to="/matches">
        Matches
        {counts?.match > 0 && <Badge>{counts.match} new</Badge>}
      </NavLink>
    </nav>
  )
}
```

---

## Recommended Strategy by Item Type

| Item Type | Primary Clear | Secondary Clear | Age Expiry |
|-----------|---------------|-----------------|------------|
| **Tracks** | View-based (2s) | Action (add to playlist) | 7 days |
| **Matches** | Action (accept/skip) | View-based (3s) | 14 days |
| **Analyses** | View-based (1s) | Implicit (track viewed) | 3 days |

---

## File Structure

```
lib/
├── queries/
│   └── newItems.queries.ts       # TanStack Query definitions
│
├── hooks/
│   └── useTrackNewness.ts        # Intersection observer hook
│
├── schemas/
│   └── newItems.schema.ts        # Valibot schemas
│
├── server/
│   └── newness.server.ts         # Server functions (createServerFn)

components/
├── ui/
│   ├── NewBadge.tsx
│   └── NewDot.tsx
├── NewItemsFilter.tsx
└── NewItemsHeader.tsx
```

**Note:** With TanStack Start, server functions replace traditional API routes. The functions in `lib/server/newness.server.ts` can be imported directly in components and will automatically run on the server.
