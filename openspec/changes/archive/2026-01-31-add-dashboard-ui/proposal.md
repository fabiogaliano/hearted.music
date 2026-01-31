# Change: Add Dashboard UI (Phase 7b.1)

## Why

Users complete onboarding and land on `/dashboard` - which currently shows a placeholder. The dashboard is the **main hub** for the app, showing:

1. **Quick stats** - Total songs, analysis progress, match counts
2. **Navigation** - Access to Match Songs, Liked Songs, Playlists, Settings
3. **New songs CTA** - Call-to-action for pending/unsorted songs
4. **Recent activity** - What happened since last visit

We have a production-ready prototype in `old_app/prototypes/warm-pastel/dashboard.tsx`.

## Source Analysis: Warm-Pastel Prototype

### Component Tree

```
WarmPastelDashboard (dashboard.tsx)
├── KeyboardShortcutProvider
├── Sidebar (264px, sticky)
│   ├── Logo ("hearted.")
│   ├── NavItems (Home, Match Songs[badge], Liked Songs, Playlists, Settings)
│   └── UserSection (name, plan)
├── Main Content (flex-1, px-12 py-8)
│   └── [View Components by activeView]
└── ShortcutsHelpModal
```

### Views

| View        | Component        | Key Sub-Components                                                 |
| ----------- | ---------------- | ------------------------------------------------------------------ |
| `home`      | `Home`           | HomeHeader, NewSongsCTA, MatchingPlaylistsSection, ActivityFeed    |
| `sort`      | `Matching`       | *(out of scope - Phase 7b.3)*                                      |
| `liked`     | `LikedSongsPage` | *(out of scope - separate change)*                                 |
| `playlists` | `Playlists`      | ActivePlaylistsPanel, PlaylistLibrary, PlaylistDetailView          |
| `settings`  | `SettingsPage`   | Account, Connected Services, Appearance, Sorting Preferences, Data |

### Home View Deep-Dive

```
Home (max-w-4xl)
├── HomeHeader
│   ├── Welcome greeting ("Welcome back" + user name)
│   └── Stats row (totalSongs, analyzedPercent%, sync indicator, Sync button)
├── NewSongsCTA (conditional: only if newSongsCount > 0)
│   ├── Label ("Ready to match")
│   ├── Count ("{n} new songs")
│   ├── FanSpreadAlbumArt (3 overlapping album covers)
│   └── CTA link ("Start →")
├── MatchingPlaylistsSection
│   ├── Label ("Matching playlists")
│   ├── Playlist chips (max 4, name + trackCount)
│   └── "Manage →" link
└── ActivityFeed
    ├── Label ("Recent Activity")
    ├── ActivityItem[] (album art, song, artist, "Matched to {playlist}", time)
    └── "View all activity →" link
```

### Data Types Required

```typescript
interface HomeStats {
  totalSongs: number
  analyzedPercent: number
  matchedCount: number
  playlistCount: number
  newSongsCount: number
}

interface UserPlaylist {
  id: number
  name: string
  trackCount: number
  image: string
  description: string
  lastUpdated: string
  flagged: boolean  // is_destination in DB
}

interface RecentActivityItem {
  id: number
  song: string
  artist: string
  playlist: string
  time: string
  image: string
}
```

### State Management

| State              | Location                 | Usage                             |
| ------------------ | ------------------------ | --------------------------------- |
| `activeView`       | URL search param         | Which view to render              |
| `color`            | URL search param → theme | Theme color selection             |
| `userPlaylists`    | useState                 | Playlist list with flagged toggle |
| `selectedSongSlug` | URL search param         | Deep link to specific song        |
| `isHelpOpen`       | KeyboardShortcutProvider | Shortcuts modal visibility        |

### Keyboard Shortcuts

| Key       | Scope      | Description                 |
| --------- | ---------- | --------------------------- |
| `?`       | global     | Toggle shortcuts help modal |
| `j` / `k` | list views | Navigate up/down in lists   |
| `Enter`   | list views | Select focused item         |
| `Escape`  | modal      | Close modal                 |

**Note**: The prototype uses scope-based priority (modal > detail > list > global).

## What Changes

### New Files

| Target Location                                                  | Source                                            | Lines |
| ---------------------------------------------------------------- | ------------------------------------------------- | ----- |
| `src/features/dashboard/Dashboard.tsx`                           | Port from `dashboard.tsx`                         | ~150  |
| `src/features/dashboard/components/Sidebar.tsx`                  | Extract from `dashboard.tsx`                      | ~80   |
| `src/features/dashboard/components/NavItem.tsx`                  | New                                               | ~40   |
| `src/features/dashboard/views/HomeView.tsx`                      | Port from `features/home/Home.tsx`                | ~50   |
| `src/features/dashboard/components/HomeHeader.tsx`               | Port from `sections/HomeHeader.tsx`               | ~70   |
| `src/features/dashboard/components/NewSongsCTA.tsx`              | Port from `sections/NewSongsCTA.tsx`              | ~60   |
| `src/features/dashboard/components/MatchingPlaylistsSection.tsx` | Port from `sections/MatchingPlaylistsSection.tsx` | ~70   |
| `src/features/dashboard/components/ActivityFeed.tsx`             | Port from `components/ActivityFeed.tsx`           | ~45   |
| `src/features/dashboard/components/ActivityItem.tsx`             | Port from `components/ActivityItem.tsx`           | ~65   |
| `src/features/dashboard/components/FanSpreadAlbumArt.tsx`        | Port from `components/FanSpreadAlbumArt.tsx`      | ~50   |
| `src/features/dashboard/hooks/useFanSpreadComposition.ts`        | Port from `hooks/useFanSpreadComposition.ts`      | ~30   |
| `src/lib/server/dashboard.server.ts`                             | New                                               | ~80   |

### Modified Files

| File                                      | Changes                            |
| ----------------------------------------- | ---------------------------------- |
| `src/routes/_authenticated/dashboard.tsx` | Add loader, render Dashboard shell |

### Existing Integration Points

| File                                  | Integration                                       |
| ------------------------------------- | ------------------------------------------------- |
| `src/routes/_authenticated/route.tsx` | Auth guard (exists)                               |
| `src/lib/data/liked-song.ts`          | `getCount()`, `getPending()`                      |
| `src/lib/data/playlists.ts`           | `getPlaylistCount()`, `getDestinationPlaylists()` |
| `src/lib/data/matching.ts`            | `getLatestMatchContext()`, match stats            |
| `src/lib/theme/colors.ts`             | Theme system (exists, same as prototype)          |
| `src/lib/theme/types.ts`              | ThemeColor, ThemeConfig types (exists)            |

## Architecture

### Route Structure

Phase 7b.1 implements the shell + home view. Other views are separate changes:

```
/_authenticated/
  dashboard.tsx          → Shell with sidebar, renders child routes
  dashboard/
    index.tsx            → Home view (this change)
    # Future phases:
    match.tsx            → Match songs flow (Phase 7b.3)
    liked-songs.tsx      → Liked songs (separate change)
    playlists.tsx        → Playlists (Phase 7b.4)
    settings.tsx         → Settings (Phase 7b.5)
```

### Data Loading

```typescript
// dashboard.server.ts
export const getDashboardStats = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireAuth()

    const [
      totalSongs,
      pendingSongs,
      playlistCount,
      destinationPlaylists,
    ] = await Promise.all([
      LikedSong.getCount(session.accountId),
      LikedSong.getPending(session.accountId),
      Playlist.getPlaylistCount(session.accountId),
      Playlist.getDestinationPlaylists(session.accountId),
    ])

    // Calculate analyzed % from song_analysis table
    // Calculate matched count from item_status where action_type = 'matched'

    return {
      stats: {
        totalSongs: totalSongs.value ?? 0,
        analyzedPercent: calculateAnalyzedPercent(...),
        matchedCount: calculateMatchedCount(...),
        playlistCount: playlistCount.value ?? 0,
        newSongsCount: pendingSongs.value?.length ?? 0,
      },
      playlists: destinationPlaylists.value ?? [],
      recentActivity: await getRecentActivity(session.accountId),
    }
  })
```

### Theme Integration

The prototype's theme system (`shared/theme.ts`) is already ported to v1 at `src/lib/theme/`:
- Same 4 colors: blue, green, rose, lavender
- Same ThemeConfig structure
- Same font configuration (Instrument Serif + Geist)

Theme is selected during onboarding and stored in `preference` table.

## Acceptance Criteria

1. Dashboard loads after onboarding completion (redirect already works)
2. Sidebar shows navigation with active state highlighting
3. Home view displays stats: total songs, analyzed %, playlist count, new songs count
4. NewSongsCTA appears when pending songs exist, links to match flow
5. Matching playlists section shows destination playlists
6. Activity feed shows recent matching activity (initially empty state OK)
7. Theme persists from onboarding selection
8. `?` key shows keyboard shortcuts help modal
9. Mobile: sidebar collapses (implementation TBD in Phase 7b.1)

## Out of Scope

- Match Songs flow (Phase 7b.3)
- Liked Songs view (separate change)
- Playlists management view (Phase 7b.4)
- Settings view (Phase 7b.5)
- Mobile bottom nav (can be added in polish)
- Sync button functionality (requires Spotify API integration)

## Implementation Status

**Status**: ✅ Core Complete (polish deferred)

### Completed
- Dashboard shell with Sidebar + NavItem
- Home view: DashboardHeader, MatchReviewCTA, FanSpreadAlbumArt, ActivityFeed, ActivityItem
- Server functions with parallel data loading
- Types with discriminated union for ActivityItem
- Empty states for CTA and ActivityFeed

### Deferred
- **MatchingPlaylistsSection** → Phase 7b.4 (Playlists view)
- **Keyboard shortcuts** → Future polish
- **Loading states / Skeletons** → Future polish
- **Error boundary** → Future polish
- **Mobile responsive** → Future polish

### Design Adjustments
- `HomeView.tsx` merged into `Dashboard.tsx` (simpler)
- `useFanSpreadComposition.ts` inlined as `getComposition()` function
- Sidebar/NavItem placed in `routes/_authenticated/-components/` (TanStack Router convention)
- Added RPC migration for efficient analyzed count query

See `tasks.md` for detailed task completion status.

## References

- [warm-pastel/dashboard.tsx](/old_app/prototypes/warm-pastel/dashboard.tsx)
- [warm-pastel/features/home/](/old_app/prototypes/warm-pastel/features/home/)
- [ROADMAP Phase 7b](/docs/migration_v2/ROADMAP.md)
