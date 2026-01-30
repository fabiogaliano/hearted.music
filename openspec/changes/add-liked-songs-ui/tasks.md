# Implementation Tasks

**Status**: Not started

---

## 1. Types

- [ ] 1.1 Create `src/features/liked-songs/types.ts`
  - Port from `warm-pastel/features/liked-songs/types.ts` (144 lines)
  - Types: `SortingStatus`, `UIAnalysisStatus`, `FilterOption`
  - Interfaces: `LikedSong`, `SongAnalysis`, `AnalysisContent` (full nested structure)
  - Props: `LikedSongsPageProps`, `SongListProps`, `SongDetailPanelProps`
  - Helpers: `isNewSong(likedAt)`, `formatRelativeTime(dateString)`

---

## 2. Server Functions

- [ ] 2.1 Create `src/lib/server/liked-songs.server.ts`
  - `getLikedSongsPage({ cursor, limit, filter })` - paginated fetch
    - Uses `liked-song.ts` getAll + `song-analysis.ts` get (batch)
    - Joins liked_song with track and analysis data
    - Returns `{ songs: LikedSong[], nextCursor: string | null }`
  - `getTrackImages(ids: string[])` - batch album art fetch
    - Endpoint for useVisibleSongsAlbumArt hook
    - Returns `{ images: Record<string, string> }`

---

## 3. Route Setup

- [ ] 3.1 Create `src/routes/_authenticated/dashboard/liked-songs.tsx`
  - Loader fetches initial page (50 songs with analysis)
  - Search params: `?filter=all|unsorted|sorted|analyzed`
  - Dynamic segment for slug: `$songSlug` optional param
  - Pass `songs`, `initialFilter`, `selectedSlug` to component

---

## 4. Hooks

### 4.1 Infinite Scroll

- [ ] 4.1.1 Create `src/features/liked-songs/hooks/useInfiniteScroll.ts`
  - Port from warm-pastel (57 lines)
  - IntersectionObserver with configurable `rootMargin` threshold (default 100px)
  - Returns `{ sentinelRef }` to attach to bottom element
  - Stabilize callback via ref to prevent effect re-runs

### 4.2 Song Expansion (View Transitions)

- [ ] 4.2.1 Create `src/features/liked-songs/hooks/useSongExpansion.ts`
  - Port from warm-pastel (237 lines)
  - **View Transitions helper**:
    - `supportsViewTransitions` check
    - `withViewTransition(callback)` wraps with flushSync, returns `.finished` promise
  - **State**: `selectedSongId`, `isExpanded`, `startRect`, `closingToSongId`
  - **URL Sync**:
    - `updateUrl(slug)` uses `window.history.pushState` (shallow routing)
    - `popstate` listener for browser back/forward
  - **Handlers**:
    - `handleExpand(song, event)` - capture rect, set state, push URL
    - `handleClose()` - View Transition with closingToSongId handoff
    - `handleNext()` / `handlePrevious()` - navigate within list
  - **Deep linking**: `initialSlug` prop opens panel on mount

### 4.3 Album Art Loading

- [ ] 4.3.1 Create `src/features/liked-songs/hooks/useVisibleSongsAlbumArt.ts`
  - Port from warm-pastel (101 lines)
  - Input: `visibleSongs: LikedSong[]`
  - Extract unique `spotify_track_id`s
  - Batch into groups of 50
  - TanStack Query `useQueries` for parallel fetching
  - Query key: `['album-art', 'batch', ids.sort().join(',')]`
  - Stale time: 1 hour, GC time: 2 hours
  - Returns `{ albumArt, isLoading, getAlbumArt(id) }`
  - Fallback: picsum.photos placeholder

---

## 5. Song Card

- [ ] 5.1 Create `src/features/liked-songs/components/SongCard.tsx`
  - Port from warm-pastel (116 lines)
  - Props: `song`, `albumArtUrl`, `isSelected`, `isFocused`, `onClick`, `isAnimatingTo`
  - Album art: 48x48, gradient placeholder if no URL
  - "New" indicator dot (< 7 days)
  - Track name, artist, relative time
  - Selection state: background color
  - Focus state: left border accent
  - **View Transition names** (only when `isAnimatingTo`):
    - `viewTransitionName: 'song-album'`
    - `viewTransitionName: 'song-title'`
    - `viewTransitionName: 'song-artist'`

---

## 6. Detail Panel

### 6.1 Main Panel

- [ ] 6.1.1 Create `src/features/liked-songs/components/SongDetailPanel.tsx`
  - Port from warm-pastel (921 lines) - this is the largest component
  - Props: `song`, `albumArtUrl`, `artistImageUrl`, `isExpanded`, `startRect`, `onClose`, `onNext`, `onPrevious`, `hasNext`, `hasPrevious`, `isDark`
  - **Theme derivation**: `getThemedDarkColors(theme)` generates HSL-based dark palette
  - **Slide animation**: `translateX(100%) → translateX(0)` on `isExpanded`
  - **Responsive width**: `clamp(380px, 45vw, calc(100vw - 280px))`
  - **View Transition names** (when `isExpanded`): song-album, song-title, song-artist
  - Renders: header, hero, content sections

### 6.2 Scroll-Driven Hero Collapse

- [ ] 6.2.1 Implement hero collapse animation in SongDetailPanel
  - **Layout constants**: heroHeight=450, collapsedHeaderHeight=108, albumArtExpanded=112, albumArtCollapsed=56
  - **Refs**: scrollRef, headerRef, heroRef, artistImageRef, vignetteRef, bottomFadeRef, albumArtRef, textBlockRef, titleRef, metaRef, contentRef
  - **Wheel event interception**:
    - Track `collapseOffset` (0 to 342)
    - Consume wheel delta until fully collapsed, then allow scroll
    - On scroll up at top, reverse collapse
  - **Apply progress**:
    - `lerp(from, to, progress)` for smooth interpolation
    - `smoothstep(t)` for easing: `t * t * (3 - 2 * t)`
    - Snap states with hysteresis (< 0.02 snaps to 0, > 0.96 snaps to 1)
  - **Animated properties**:
    - Hero height: 450px → 108px
    - Album art: 112px → 56px, position shifts
    - Title font: 24px → 16px
    - Artist font: 14px → 12px
    - Artist image opacity: 1 → 0
    - Bottom fade opacity: 0 → 1
    - Header border opacity: 0 → 1
  - **Reduced motion**: Instant collapse if `prefers-reduced-motion`
  - **Song change**: Reset scroll and collapse state

### 6.3 Detail Subcomponents

- [ ] 6.3.1 Create `src/features/liked-songs/components/detail/index.ts`
  - Export all subcomponents and utils

- [ ] 6.3.2 Create `src/features/liked-songs/components/detail/utils.ts`
  - Port from warm-pastel (54 lines)
  - `getMatchQuality(score)` → { label, showProminent }
  - `getIntensityLabel(intensity)` → 'Hits hard' | 'Builds intensity' | etc.
  - `getAudioQualityLabel(value, type)` for energy/valence/danceability/acousticness
  - `getTempoFeel(tempo)` → 'Racing' | 'Driving' | 'Steady' | etc.

- [ ] 6.3.3 Create `src/features/liked-songs/components/detail/Nav.tsx`
  - Port from warm-pastel (82 lines)
  - Previous/Next/Close buttons with SVG icons
  - Disabled state when no prev/next
  - Dark/light mode color adaptation

- [ ] 6.3.4 Create `src/features/liked-songs/components/detail/AudioInfo.tsx`
  - Port from warm-pastel (61 lines)
  - Compact display: Energy, Mood, BPM
  - Labels: High/Med/Low for energy, Bright/Balanced/Melancholic for valence

- [ ] 6.3.5 Create `src/features/liked-songs/components/detail/MeaningSection.tsx`
  - Port from warm-pastel (303 lines)
  - **EmotionalHook**: mood_description (italic), dominant_mood tag, intensity label
  - **ThemesList**: Coordinated hover (only one theme expanded at a time)
    - `openIndex` state, `pinnedIndex` for click-to-pin
    - Hover opens, mouse leave closes after 150ms delay
  - **JourneyTimeline**: Collapsed by default
    - Toggle button shows section count
    - Timeline: section label (10px uppercase) + mood + description

- [ ] 6.3.6 Create `src/features/liked-songs/components/detail/ContextSection.tsx`
  - Port from warm-pastel (39 lines)
  - "Perfect For" heading
  - Pill tags from `analysis.context.best_moments[]`

- [ ] 6.3.7 Create `src/features/liked-songs/components/detail/PlaylistsSection.tsx`
  - Port from warm-pastel (260 lines)
  - **PlaylistRow**: Full (prominent) vs compact (other) variants
    - Match quality label from `getMatchQuality(score)`
    - Add button / "Added" state
  - **Prominent matches**: score >= 0.6, full display
  - **Other matches**: Collapsed by default, expandable
  - **AddedSummary**: "Added to X playlist(s)"
  - **Footer actions**: "Skip this song" / "Mark as sorted"

---

## 7. Page Component

- [ ] 7.1 Create `src/features/liked-songs/LikedSongsPage.tsx`
  - Port from warm-pastel (317 lines)
  - Props: `theme`, `songs`, `isLoading`, `initialFilter`, `selectedSlug`, `isDarkMode`
  - **Filter state**: 'all' | 'unsorted' | 'sorted' | 'analyzed'
  - **Filtering logic**:
    - unsorted: `sorting_status === 'unsorted' || null`
    - sorted: `sorting_status === 'sorted'`
    - analyzed: `uiAnalysisStatus === 'analyzed'`
  - **Pagination**: `loadedCount` state, reset on filter change
  - **Hooks integration**:
    - `useInfiniteScroll({ onLoadMore, hasMore })`
    - `useSongExpansion(filteredSongs, { initialSlug })`
    - `useVisibleSongsAlbumArt(displayedSongs)`
    - `useArtistImage(selectedSong?.spotify_track_id)` for panel background
  - **Stats**: total, analyzed, unsorted counts
  - **Dark mode toggle**: Cmd+D shortcut

- [ ] 7.2 Integrate with route loader data
  - Replace mock data with loader data
  - Wire up server function for pagination when `loadedCount` exceeds loaded data

---

## 8. Keyboard Navigation

- [ ] 8.1 Add list navigation (scope: 'liked-list')
  - Use existing `useListNavigation` hook
  - j/k to move focus
  - Enter to expand
  - Sync focus with selected song when panel navigates

- [ ] 8.2 Add panel navigation (scope: 'liked-detail')
  - `useShortcut` for Escape → close
  - `useShortcut` for j/k and Up/Down → next/prev song
  - `useShortcut` for Cmd+D → toggle dark mode

---

## 9. Filtering

- [ ] 9.1 Implement filter tabs UI
  - Tabs: All, Unsorted, Sorted, Analyzed
  - Active state styling
  - Click handler updates filter

- [ ] 9.2 URL sync for filter
  - Read `?filter=` from search params
  - Update URL on filter change (shallow or full navigation TBD)
  - Reset `loadedCount` to `INITIAL_LOAD_SIZE` on filter change

---

## 10. Polish

- [ ] 10.1 Loading states
  - Skeleton cards during initial load
  - "Loading more..." text at sentinel
  - Spinner for album art loading

- [ ] 10.2 Empty states
  - No songs yet: "Like songs on Spotify to see them here"
  - No matches for filter: "No {filter} songs"

- [ ] 10.3 Error handling
  - Failed loads with retry button
  - Toast for failed playlist add

- [ ] 10.4 Reduced motion support
  - Detect `prefers-reduced-motion`
  - Skip View Transitions → simple state change
  - Instant hero collapse (no animation)

- [ ] 10.5 Mobile responsiveness
  - Full-screen panel (100vw)
  - Touch-friendly tap targets
  - Swipe to close (optional)

---

## Summary

| Phase | Tasks | Complexity |
|-------|-------|------------|
| 1. Types | 1 | Low |
| 2. Server | 1 | Medium |
| 3. Route | 1 | Low |
| 4. Hooks | 3 | Medium |
| 5. Card | 1 | Low |
| 6. Panel | 7 | High (921 lines + subcomponents) |
| 7. Page | 2 | Medium |
| 8. Keyboard | 2 | Low |
| 9. Filter | 2 | Low |
| 10. Polish | 5 | Medium |
| **Total** | **25** | |

## Implementation Order

Recommended sequence for minimal dependencies:

1. **Types** (1.1) - Foundation
2. **Server functions** (2.1) - Data layer
3. **Route** (3.1) - Wire up loader
4. **Hooks** (4.1-4.3) - Reusable logic
5. **Card** (5.1) - List item
6. **Panel subcomponents** (6.3.1-6.3.7) - Smallest to largest
7. **Panel main** (6.1.1, 6.2.1) - Compose subcomponents
8. **Page** (7.1, 7.2) - Compose everything
9. **Keyboard** (8.1, 8.2) - Enhancement
10. **Filtering** (9.1, 9.2) - Enhancement
11. **Polish** (10.x) - Final touches
