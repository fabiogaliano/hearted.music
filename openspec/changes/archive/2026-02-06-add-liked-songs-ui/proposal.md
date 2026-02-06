# Change: Add Liked Songs UI (Phase 7b.2)

## Why

Users need to browse their liked songs library, see analysis status, and access detailed song information. This is the **primary data view** - everything flows from here.

## Approach: Direct Copy & Adapt

We have a **production-ready prototype** at `v0/services/web/app/prototypes/warm-pastel/features/liked-songs/` with pixel-perfect UI. Rather than rewriting, we **copy files directly and adapt in place** to preserve 1:1 fidelity.

**Benefits:**
- Preserves exact styling (HSL colors, spacing, typography)
- Keeps animation timing unchanged (0.35s cubic-bezier, smoothstep easing)
- Maintains same component structure
- Reduces translation errors

## Source Files (v0 Prototype)

```
v0/services/web/app/prototypes/warm-pastel/features/liked-songs/
├── index.ts                    (539 B)   → Public exports
├── LikedSongsPage.tsx          (9.1 KB)  → Main page
├── types.ts                    (3.3 KB)  → Type definitions
├── components/
│   ├── SongCard.tsx            (3.2 KB)  → List item
│   ├── SongDetailPanel.tsx     (30 KB)   → Detail panel (largest)
│   └── detail/
│       ├── index.ts            (305 B)   → Subcomponent exports
│       ├── AudioInfo.tsx       (1.6 KB)
│       ├── ContextSection.tsx  (877 B)
│       ├── MeaningSection.tsx  (9.1 KB)
│       ├── Nav.tsx             (1.6 KB)
│       ├── PlaylistsSection.tsx(7.8 KB)
│       └── utils.ts            (1.4 KB)
└── hooks/
    ├── useInfiniteScroll.ts    (1.5 KB)
    ├── useSongExpansion.ts     (7.1 KB)
    └── useVisibleSongsAlbumArt.ts (2.8 KB)
```

**Total: 15 files, ~67 KB**

## Target Location (v1)

```
src/features/liked-songs/
├── index.ts                    ← Copy + adapt exports
├── LikedSongsPage.tsx          ← Copy + adapt
├── types.ts                    ← Copy (minimal changes)
├── components/
│   ├── SongCard.tsx            ← Copy + adapt
│   ├── SongDetailPanel.tsx     ← Copy + adapt
│   ├── PanelSkeleton.tsx       ← NEW (Suspense fallback)
│   └── detail/
│       ├── index.ts            ← Copy
│       ├── AudioInfo.tsx       ← Copy
│       ├── ContextSection.tsx  ← Copy
│       ├── MeaningSection.tsx  ← Copy
│       ├── Nav.tsx             ← Copy
│       ├── PlaylistsSection.tsx← Copy + adapt (server fn)
│       └── utils.ts            ← Copy
└── hooks/
    ├── useInfiniteScroll.ts    ← Copy
    ├── useSongExpansion.ts     ← Copy + adapt (TanStack Router)
    ├── useVisibleSongsAlbumArt.ts ← Copy + adapt
    ├── useHeroCollapse.ts      ← Extract from SongDetailPanel
    └── useArtistImage.ts       ← NEW (fetch artist background)
```

## Integration Points (v1 Codebase)

| v1 Location | Purpose |
|-------------|---------|
| `src/routes/_authenticated/liked-songs.tsx` | Route exists, needs loader |
| `src/lib/keyboard/useShortcut.ts` | Keyboard hooks (exists) |
| `src/lib/keyboard/useListNavigation.ts` | List nav (exists) |
| `src/lib/theme/` | Theme system (exists) |
| `src/lib/shared/errors/` | TaggedError pattern |
| `src/lib/server/` | Server functions home |

## Adaptations Required

### 1. Import Paths
- `~/` → `@/` (if different alias)
- Theme imports from v1 location
- Utility imports from v1 lib

### 2. URL Routing (v0 → v1)
- v0: `history.pushState` (manual)
- v1: TanStack Router `useNavigate({ search })`
- Both: shallow routing via search params

### 3. Server Functions
- v0: Direct API calls
- v1: TanStack Start server functions with `createServerFn`
- Add Result type wrapping

### 4. Error Handling
- v0: Try/catch with console
- v1: TaggedError + Result types

### 5. Theme Type Alignment
- Verify `ThemeConfig` interface matches
- Extract hue utility for dark mode

## UI Specifications (Preserve Exactly)

### Typography
| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page title | Instrument Serif | 48px | 200 |
| Stats number | Instrument Serif | 30px | 200 |
| Song title (card) | Instrument Serif | 16px | 300/400 |
| Panel title | Instrument Serif | 24px→16px | 300 |
| Body text | Geist | 14px | 400 |
| Labels | Geist | 12px | 400 (tracking-widest uppercase) |

### Layout Constants (Do Not Change)
```typescript
const LAYOUT = {
  heroHeight: 450,
  collapsedHeaderHeight: 108,
  albumArtExpanded: 112,
  albumArtCollapsed: 56,
  imagePositionY: 30,
  paddingX: 20,
}
```

### Animation Timing (Do Not Change)
```css
/* Panel slide */
transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out

/* Collapse elements */
transition: all 0.1s ease-out

/* Smoothstep easing */
t * t * (3 - 2 * t)
```

### Color System
- Theme-based: `ThemeConfig` provides base colors
- Dark mode: Generated from primary hue extraction
- Vignette gradients preserved exactly

## Acceptance Criteria

1. **Visual Parity**: Side-by-side comparison shows identical UI
2. **Animation Parity**: Collapse, transitions, hover effects match exactly
3. **Keyboard Parity**: j/k/Enter/Escape work identically
4. **State Parity**: Filter, selection, expansion states work same
5. **Responsive Parity**: Panel width clamping, mobile behavior matches

## References

- [v0 Prototype](/app/v0/services/web/app/prototypes/warm-pastel/features/liked-songs/)
- [v1 Keyboard System](/app/v1_hearted/src/lib/keyboard/)
