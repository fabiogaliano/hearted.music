# Implementation Tasks

**Status**: Not started

---

## 1. Server Functions & Data Layer

- [ ] 1.1 Create `src/lib/server/dashboard.server.ts`
  - `getDashboardStats()` server function using `createServerFn`
  - Calls existing data layer functions in parallel:
    - `LikedSong.getCount(accountId)` → totalSongs
    - `LikedSong.getPending(accountId)` → newSongsCount (length)
    - `Playlist.getPlaylistCount(accountId)` → playlistCount
    - `Playlist.getDestinationPlaylists(accountId)` → matching playlists
  - Returns: `{ stats: HomeStats, playlists: Playlist[], recentActivity: ActivityItem[] }`

- [ ] 1.2 Add `getAnalyzedCount()` to `src/lib/data/song-analysis.ts`
  - Count songs with analysis for an account
  - Used to calculate `analyzedPercent = (analyzedCount / totalSongs) * 100`

- [ ] 1.3 Add `getRecentActivity()` to data layer
  - Query `item_status` where `action_type = 'matched'`
  - Join with `song` and `playlist` tables
  - Order by `actioned_at` DESC, limit 10
  - Returns: `RecentActivityItem[]`

---

## 2. Types

- [ ] 2.1 Create `src/features/dashboard/types.ts`
  ```typescript
  export interface HomeStats {
    totalSongs: number
    analyzedPercent: number
    matchedCount: number
    playlistCount: number
    newSongsCount: number
  }

  export interface DashboardPlaylist {
    id: string
    name: string
    trackCount: number
    imageUrl: string | null
  }

  export interface RecentActivityItem {
    id: string
    songName: string
    artistName: string
    playlistName: string
    timeAgo: string
    albumArtUrl: string | null
  }

  export interface DashboardLoaderData {
    stats: HomeStats
    playlists: DashboardPlaylist[]
    recentActivity: RecentActivityItem[]
    userName: string
  }
  ```

---

## 3. Route Setup

- [ ] 3.1 Update `src/routes/_authenticated/dashboard.tsx`
  - Add `beforeLoad` that fetches dashboard data via `getDashboardStats()`
  - Pass data to Dashboard component via route context
  - Keep existing onboarding redirect logic

- [ ] 3.2 Create `src/routes/_authenticated/dashboard/index.tsx`
  - Default child route for home view
  - Renders `HomeView` component

---

## 4. Dashboard Shell

- [ ] 4.1 Create `src/features/dashboard/Dashboard.tsx` (~150 lines)
  - Port from `warm-pastel/dashboard.tsx` lines 290-401
  - Simplified: only sidebar + `<Outlet />` for child routes
  - Remove view switching logic (handled by router)
  - Props: `stats`, `playlists`, `userName`, `theme`

- [ ] 4.2 Create `src/features/dashboard/components/Sidebar.tsx` (~80 lines)
  - Extract sidebar from `dashboard.tsx` lines 294-358
  - Logo: "sorted.music" with `fonts.display`
  - Nav items via `NavItem` component
  - User section: name + plan tier
  - Sticky positioning, 256px width

- [ ] 4.3 Create `src/features/dashboard/components/NavItem.tsx` (~40 lines)
  - TanStack Router `Link` component
  - Active state styling (text weight + color)
  - Optional badge for counts (unsorted songs)
  - Props: `to`, `label`, `badge?`, `isActive`

---

## 5. Home View Components

- [ ] 5.1 Create `src/features/dashboard/views/HomeView.tsx` (~50 lines)
  - Port from `features/home/Home.tsx`
  - Orchestrates: HomeHeader, NewSongsCTA, MatchingPlaylistsSection, ActivityFeed
  - Props from loader data via route context

- [ ] 5.2 Create `src/features/dashboard/components/HomeHeader.tsx` (~70 lines)
  - Port from `sections/HomeHeader.tsx`
  - Welcome greeting with user name
  - Stats row: totalSongs, analyzedPercent%, sync indicator
  - Sync button (disabled for now, shows "2m ago")

- [ ] 5.3 Create `src/features/dashboard/components/NewSongsCTA.tsx` (~60 lines)
  - Port from `sections/NewSongsCTA.tsx`
  - Conditional render: only if `newSongsCount > 0`
  - Label "Ready to match" + count "{n} new songs"
  - FanSpreadAlbumArt with recent album covers
  - Link to `/dashboard/match` with "Start →"

- [ ] 5.4 Create `src/features/dashboard/components/FanSpreadAlbumArt.tsx` (~50 lines)
  - Port from `components/FanSpreadAlbumArt.tsx`
  - 3 overlapping album covers with rotation
  - Hover effects (scale, translate, z-index)

- [ ] 5.5 Create `src/features/dashboard/hooks/useFanSpreadComposition.ts` (~30 lines)
  - Port from `hooks/useFanSpreadComposition.ts`
  - Returns positioning data for 3 images

- [ ] 5.6 Create `src/features/dashboard/components/MatchingPlaylistsSection.tsx` (~70 lines)
  - Port from `sections/MatchingPlaylistsSection.tsx`
  - Label "Matching playlists"
  - Show max 4 destination playlists with track counts
  - "Manage →" link to `/dashboard/playlists`

- [ ] 5.7 Create `src/features/dashboard/components/ActivityFeed.tsx` (~45 lines)
  - Port from `components/ActivityFeed.tsx`
  - Label "Recent Activity"
  - Maps over activities → ActivityItem
  - "View all activity →" link (to liked songs or library)

- [ ] 5.8 Create `src/features/dashboard/components/ActivityItem.tsx` (~65 lines)
  - Port from `components/ActivityItem.tsx`
  - Album art (56x56), song name, artist
  - "Matched to {playlist}" + time ago
  - Hover state with background color

---

## 6. Keyboard Shortcuts

- [ ] 6.1 Integrate `KeyboardShortcutProvider` in Dashboard
  - Wrap dashboard content with provider
  - Import from existing keyboard system if ported, or port from prototype

- [ ] 6.2 Create `src/features/dashboard/components/ShortcutsHelpModal.tsx`
  - Port from `shared/keyboard/ShortcutsHelpModal.tsx`
  - Triggered by `?` key
  - Shows shortcuts grouped by scope
  - Escape to close

- [ ] 6.3 Port keyboard hooks if not already in v1
  - `KeyboardShortcutProvider.tsx` (~244 lines)
  - `useShortcut.ts` and `useListNavigation.ts`
  - Types from `types.ts`

---

## 7. Empty States

- [ ] 7.1 Empty state for NewSongsCTA
  - Already handled: component returns null if `newSongsCount === 0`

- [ ] 7.2 Empty state for MatchingPlaylistsSection
  - Show "No playlists selected" + link to select playlists
  - Conditional when `playlists.length === 0`

- [ ] 7.3 Empty state for ActivityFeed
  - Show "No recent activity" message
  - Conditional when `activities.length === 0`

---

## 8. Polish

- [ ] 8.1 Loading states
  - Skeleton components for stats cards
  - Suspense boundaries where appropriate

- [ ] 8.2 Error handling
  - Error boundary for dashboard
  - Retry button on failed data loads

- [ ] 8.3 Mobile responsive (basic)
  - Hide sidebar on < md breakpoint
  - Adjust padding/margins for mobile
  - Full mobile nav deferred to polish phase

---

## Summary

| Phase | Tasks | Est. Lines | Priority |
|-------|-------|-----------|----------|
| 1. Server/Data | 3 | ~120 | High |
| 2. Types | 1 | ~40 | High |
| 3. Routes | 2 | ~50 | High |
| 4. Shell | 3 | ~270 | High |
| 5. Home View | 8 | ~440 | High |
| 6. Keyboard | 3 | ~300 | Medium |
| 7. Empty States | 3 | ~30 | Medium |
| 8. Polish | 3 | ~100 | Low |
| **Total** | **26** | **~1350** | |

### Implementation Order

1. Types (2.1) - foundation
2. Server functions (1.1, 1.2, 1.3) - data layer
3. Routes (3.1, 3.2) - routing setup
4. Shell (4.1, 4.2, 4.3) - basic layout
5. Home view (5.1 through 5.8) - main UI
6. Keyboard (6.1, 6.2, 6.3) - shortcuts
7. Empty states (7.1-7.3) - edge cases
8. Polish (8.1-8.3) - final touches

### Dependencies

- Types must be created before server functions
- Server functions must exist before routes
- Shell must exist before home view components
- Keyboard provider must wrap dashboard before shortcuts work
