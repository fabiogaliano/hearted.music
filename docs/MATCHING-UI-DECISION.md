# Matching UI Decision

> Final decision on matching display approach

---

## Decision: Progressive View System

### Release Order

| Phase | View | Priority | Status |
|-------|------|----------|--------|
| **MVP** | Split View | P0 | 🚧 Next |
| **v1.1** | Card Stack | P1 | Planned |
| **v1.2** | Timeline/Feed | P2 | Planned |

### User Toggle

Users can switch between available views via a toggle in the UI:

```
┌─────────────────────────────────────────────────────────────┐
│  Match Your Songs                    [📊] [🃏] [📰]         │
│                                       ↑    ↑    ↑           │
│                                    Split Card Timeline      │
│                                    (MVP) (v1.1) (v1.2)      │
└─────────────────────────────────────────────────────────────┘
```

Preference saved to `user_preferences.matching_view`:
- `'split'` (default)
- `'card'`
- `'timeline'`

---

## Why This Order

### Split View First (MVP)

**Pros for MVP:**
- Shows all information (transparency builds trust)
- Power users (early adopters) love detail
- Easier to debug matching algorithm
- Desktop-first is fine for MVP
- Proves the core matching works

**Trade-offs accepted:**
- Not mobile-optimized (yet)
- Can feel complex for casual users

### Card Stack Second (v1.1)

**Why add next:**
- Mobile users need this
- Simpler UX for mainstream adoption
- Good for "quick sort" sessions
- Reuses same data, just different display

### Timeline Third (v1.2)

**Why last:**
- More passive browsing than active sorting
- Good for "maintenance mode" (new songs trickle in)
- Can be added after core experience is solid

---

## Implementation Notes

### Shared State Across Views

All views use the same:
- Query hooks (`useMatches()`, `useTracks()`, `usePlaylists()`)
- Mutations (`useAddToPlaylist()`, `useSkipTrack()`)
- Store (`matchingStore` for selected playlist, queue position)

Only the **presentation** changes.

```typescript
// features/matching/views/
├── SplitView.tsx      ← MVP
├── CardStackView.tsx  ← v1.1
├── TimelineView.tsx   ← v1.2
└── index.tsx          ← View switcher

// features/matching/MatchingPage.tsx
export function MatchingPage() {
  const { view } = useMatchingPreferences()

  return (
    <MatchingLayout>
      {view === 'split' && <SplitView />}
      {view === 'card' && <CardStackView />}
      {view === 'timeline' && <TimelineView />}
    </MatchingLayout>
  )
}
```

### View Toggle Component

```typescript
// components/ViewToggle.tsx
const views = [
  { id: 'split', icon: '📊', label: 'Split View', available: true },
  { id: 'card', icon: '🃏', label: 'Card Stack', available: false },  // v1.1
  { id: 'timeline', icon: '📰', label: 'Timeline', available: false }, // v1.2
]

export function ViewToggle() {
  const { view, setView } = useMatchingPreferences()

  return (
    <div className="flex gap-1">
      {views.map(v => (
        <button
          key={v.id}
          onClick={() => v.available && setView(v.id)}
          disabled={!v.available}
          className={cn(
            'rounded-lg p-2',
            view === v.id ? 'bg-primary text-white' : 'bg-muted',
            !v.available && 'opacity-50 cursor-not-allowed'
          )}
          title={v.available ? v.label : `${v.label} (Coming soon)`}
        >
          {v.icon}
        </button>
      ))}
    </div>
  )
}
```

---

## Database Addition

```sql
-- Add to user_preferences table
ALTER TABLE user_preferences
ADD COLUMN matching_view TEXT DEFAULT 'split'
CHECK (matching_view IN ('split', 'card', 'timeline'));
```

---

## Next Steps

1. [ ] Implement Split View with real data (MVP)
2. [ ] Add view preference to user_preferences
3. [ ] Create view toggle component (shows coming soon for unavailable)
4. [ ] Implement Card Stack view (v1.1)
5. [ ] Implement Timeline view (v1.2)
