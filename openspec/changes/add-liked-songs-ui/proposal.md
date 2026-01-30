# Change: Add Liked Songs UI (Phase 7b.2)

## Why

Users need to browse their liked songs library, see analysis status, and access detailed song information. This is the **primary data view** - everything flows from here.

Key features:
1. **Infinite scroll** - Handle 1000+ songs efficiently
2. **View Transitions** - Smooth card-to-panel shared element animation
3. **Filtering** - All, unsorted, sorted, analyzed
4. **Detail panel** - Full analysis with themes, emotions, audio features
5. **Scroll-driven hero collapse** - Dynamic header that shrinks on scroll

We have a production-ready prototype in `old_app/prototypes/warm-pastel/features/liked-songs/` (~2,000 lines including subcomponents).

## What Changes

### Source: Warm-Pastel Prototype

| File | Lines | What We Use |
|------|-------|-------------|
| `features/liked-songs/LikedSongsPage.tsx` | 317 | Main page, filtering, scroll |
| `features/liked-songs/components/SongCard.tsx` | 116 | List item with view-transition-name |
| `features/liked-songs/components/SongDetailPanel.tsx` | 921 | Slide-out panel with collapse animation |
| `features/liked-songs/components/detail/AudioInfo.tsx` | 61 | Energy/Mood/BPM display |
| `features/liked-songs/components/detail/MeaningSection.tsx` | 303 | Themes, emotional hook, journey |
| `features/liked-songs/components/detail/ContextSection.tsx` | 39 | "Perfect For" tags |
| `features/liked-songs/components/detail/PlaylistsSection.tsx` | 260 | Playlist matching + actions |
| `features/liked-songs/components/detail/Nav.tsx` | 82 | Prev/Next/Close buttons |
| `features/liked-songs/components/detail/utils.ts` | 54 | Label helpers |
| `features/liked-songs/hooks/useInfiniteScroll.ts` | 57 | IntersectionObserver pagination |
| `features/liked-songs/hooks/useSongExpansion.ts` | 237 | View Transitions + URL sync |
| `features/liked-songs/hooks/useVisibleSongsAlbumArt.ts` | 101 | Lazy album art with TanStack Query |
| `features/liked-songs/types.ts` | 144 | Type definitions |

### New Files

| Target Location | Purpose |
|-----------------|---------|
| `src/routes/_authenticated/dashboard/liked-songs.tsx` | Route with loader |
| `src/features/liked-songs/LikedSongsPage.tsx` | Main page component |
| `src/features/liked-songs/components/SongCard.tsx` | List item |
| `src/features/liked-songs/components/SongDetailPanel.tsx` | Slide-out detail panel |
| `src/features/liked-songs/components/detail/` | 5 subcomponents + utils |
| `src/features/liked-songs/hooks/useInfiniteScroll.ts` | IntersectionObserver hook |
| `src/features/liked-songs/hooks/useSongExpansion.ts` | View Transitions + state |
| `src/features/liked-songs/hooks/useVisibleSongsAlbumArt.ts` | Batched album art fetching |
| `src/features/liked-songs/types.ts` | LikedSong, AnalysisContent types |
| `src/lib/server/liked-songs.server.ts` | Paginated data fetching |

### Existing Integration Points

| File | Integration |
|------|-------------|
| `src/lib/data/liked-song.ts` | Query liked songs (getAll, getPending) |
| `src/lib/data/song-analysis.ts` | Get analysis for detail panel |
| `src/lib/theme/` | Theme system (exists) |
| `src/lib/keyboard/` | Keyboard navigation (exists) |

## Architecture

### Data Flow

```
Route Loader (initial 50 songs with analysis)
    ↓
LikedSongsPage (display first 10, client-side filter)
    ↓
useInfiniteScroll (IntersectionObserver on sentinel)
    ↓
loadedCount increases → slice more from filteredSongs
    ↓
(If need more data) → Server function for next page
```

### View Transitions Animation (NOT FLIP)

The prototype uses the **View Transitions API** for shared element animation, not traditional FLIP:

1. **Open**: User clicks card
   - `useSongExpansion` captures card's bounding rect
   - Sets `selectedSongId`, `isExpanded = true`
   - Panel slides in from right (`translateX(100%) → translateX(0)`)
   - Panel elements have `viewTransitionName: 'song-album' | 'song-title' | 'song-artist'`
   - Browser morphs from card position to panel position

2. **Close**: User presses Escape or clicks X
   - `withViewTransition()` wraps state update with `flushSync`
   - Sets `closingToSongId` so **card** gets the view-transition-name
   - Sets `isExpanded = false` so **panel** loses the name
   - Browser captures snapshots and morphs panel elements back to card
   - After `transition.finished`, clear state

3. **Fallback**: If View Transitions not supported
   - Simple slide animation, no morphing

### Scroll-Driven Hero Collapse

The detail panel has a sophisticated scroll-collapse mechanism:

```
┌─────────────────────────────┐
│  Genre                   ✕  │  ← Sticky header (108px collapsed)
│  ┌───┐ Title                │
│  │Art│ Artist · Album       │  ← Hero (450px expanded → 108px)
│  └───┘                      │
├─────────────────────────────┤
│  Content scrolls here...    │
│                             │
└─────────────────────────────┘
```

**Collapse Mechanism**:
- Intercepts wheel events on scroll container
- Tracks `collapseOffset` (0 to 342px = 450 - 108)
- Interpolates all values with `lerp()` and `smoothstep()`
- Album art: 112px → 56px, repositions
- Snap states at 0% and 100% with hysteresis
- Bottom fade gradient masks the clip edge
- Respects `prefers-reduced-motion`

### Type Definitions

```typescript
// Core types from prototype
type SortingStatus = 'unsorted' | 'sorted' | 'ignored'
type UIAnalysisStatus = 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed'
type FilterOption = 'all' | 'unsorted' | 'sorted' | 'analyzed'

interface LikedSong {
  liked_at: string
  sorting_status: SortingStatus | null
  track: {
    id: number
    spotify_track_id: string
    name: string
    artist: string
    album: string | null
  }
  analysis: SongAnalysis | null
  uiAnalysisStatus: UIAnalysisStatus
}

interface SongAnalysis {
  id: number
  track_id: number
  analysis: AnalysisContent
  model_name: string
  version: number
  created_at: string | null
}

interface AnalysisContent {
  meaning?: {
    themes?: Array<{ name: string; confidence: number; description: string }>
    interpretation?: {
      metaphors?: Array<{ text: string; meaning: string }>
      deeper_meaning?: string
      surface_meaning?: string
      cultural_significance?: string
    }
  }
  emotional?: {
    energy?: number
    valence?: number
    intensity?: number
    dominant_mood?: string
    mood_description?: string
    journey?: Array<{ mood: string; section: string; description: string }>
  }
  context?: {
    audience?: { resonates_with?: string[]; universal_appeal?: number; primary_demographic?: string }
    best_moments?: string[]
    listening_contexts?: Record<string, number>
  }
  musical_style?: {
    vocal_style?: string
    genre_primary?: string
    sonic_texture?: string
    production_style?: string
  }
  audio_features?: {
    tempo?: number
    energy?: number
    valence?: number
    liveness?: number
    loudness?: number
    speechiness?: number
    acousticness?: number
    danceability?: number
    instrumentalness?: number
  }
  matching_profile?: {
    theme_cohesion?: number
    mood_consistency?: number
    sonic_similarity?: number
    energy_flexibility?: number
  }
}
```

### Detail Panel Sections

The panel renders these sections in order:

1. **Hero Header**
   - Artist background image (fetched separately via useArtistImage)
   - Vignette overlay gradient
   - Genre tag (top-left)
   - Floating album art (view-transition-name: song-album)
   - Title + Artist · Album (view-transition-name: song-title, song-artist)
   - Nav controls (top-right): prev/next/close

2. **Meta Row**
   - "Liked X days ago"
   - "New" badge (if < 7 days)

3. **AudioInfo**
   - Energy: High/Med/Low
   - Mood: Bright/Balanced/Melancholic
   - XXX BPM

4. **Mood Description**
   - Italic quote from `analysis.emotional.mood_description`

5. **MeaningSection** (3 sub-sections)
   - **Emotional Hook**: mood_description, dominant_mood, intensity label
   - **Themes List**: Theme names with hover-to-expand descriptions (coordinated hover - only one open)
   - **Journey Timeline**: Collapsed by default, expandable, shows section→mood→description

6. **ContextSection**
   - "Perfect For" heading
   - Pill tags from `analysis.context.best_moments`

7. **PlaylistsSection**
   - "Add to Your Playlists" heading
   - Prominent matches (score >= 0.6): full row with Add button
   - Other matches: collapsed, expandable
   - Added summary count
   - Footer: "Skip this song" / "Mark as sorted"

### Keyboard Navigation

**List scope** (`liked-list`):
- j/k: Move focus indicator
- Enter: Expand focused song
- Focus syncs with selected song when panel navigates

**Panel scope** (`liked-detail`):
- Escape: Close panel
- j/k or Up/Down: Navigate to prev/next song
- Cmd+D: Toggle dark mode

### Album Art Loading

Uses `useVisibleSongsAlbumArt` hook:
- Input: `displayedSongs` (only rendered subset)
- Extracts unique spotify_track_ids
- Batches into groups of 50 (API limit)
- Parallel fetch via TanStack Query `useQueries`
- Endpoint: `/api/track-images?ids=...`
- Stale time: 1 hour, GC time: 2 hours
- Fallback: picsum.photos placeholder

### URL Sync Strategy

Uses **shallow routing** (pushState) for smooth animations:
- Panel open: `pushState({ slug }, '/dashboard/liked-songs/{slug}')`
- Panel close: `pushState(null, '/dashboard/liked-songs')`
- Browser back: `popstate` listener reopens/closes panel
- Deep linking: `initialSlug` prop from URL opens panel on mount

## Acceptance Criteria

1. Initial load shows first 10 songs
2. Scrolling loads more (infinite scroll via IntersectionObserver)
3. Filter tabs work: All, Unsorted, Sorted, Analyzed
4. Clicking song opens detail panel with View Transition morph
5. Detail panel shows all sections: hero, audio info, meaning, context, playlists
6. Hero collapses smoothly on scroll (450px → 108px)
7. j/k navigation within detail panel
8. Escape closes panel with reverse View Transition
9. Deep linking: `/dashboard/liked-songs/{slug}` opens detail
10. Album art lazy-loads as cards enter viewport
11. Mobile: full-screen detail panel
12. Reduced motion: Skip transitions, instant collapse

## References

- [warm-pastel/features/liked-songs/](/old_app/prototypes/warm-pastel/features/liked-songs/)
- [ROADMAP Phase 7b](/docs/migration_v2/ROADMAP.md)
