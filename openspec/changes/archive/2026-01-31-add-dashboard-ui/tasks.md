# Implementation Tasks

**Status**: In Progress (Core complete, polish deferred)

---

## 1. Server Functions & Data Layer ✅

- [x] 1.1 Create `src/lib/server/dashboard.server.ts`
  - `getDashboardStats()` - parallel fetch with `Promise.all`
  - `getRecentActivity()` - returns liked activities (matched events TBD)

- [x] 1.2 Add `getAnalyzedCountForAccount()` to `src/lib/data/song-analysis.ts`
  - Uses RPC function for efficient JOIN query

- [x] 1.3 Add `getRecentActivity()` to data layer
  - Currently returns "liked" activities only
  - "matched" events to be added when match flow is implemented

**Additional implementations (not in original plan):**

- [x] 1.4 Add RPC migration `count_analyzed_songs_for_account`
  - `supabase/migrations/20260131183703_add_count_analyzed_songs_rpc.sql`
  - Efficient JOIN instead of large IN clauses

- [x] 1.5 Add `getLastCompletedSync()` to `src/lib/data/jobs.ts`
  - Used for "Last synced: 2m ago" display

- [x] 1.6 Add `getRecentWithDetails()` to `src/lib/data/liked-song.ts`
  - FK join for song name, artists, image_url

---

## 2. Types ✅

- [x] 2.1 Create `src/features/dashboard/types.ts`
  - `DashboardStats`, `DashboardProps`, `ActivityItem` (discriminated union)
  - `UserPlaylist`, `MatchPreview`

---

## 3. Route Setup ✅

- [x] 3.1 Update `src/routes/_authenticated/dashboard.tsx`
  - Loader with parallel data fetching
  - Renders Dashboard component directly (no index.tsx needed)

- [x] ~~3.2 Create dashboard/index.tsx~~ (merged into 3.1)

---

## 4. Dashboard Shell ✅

- [x] 4.1 Create `src/features/dashboard/Dashboard.tsx`
  - Composition: DashboardHeader → MatchReviewCTA → ActivityFeed

- [x] 4.2 Create `src/routes/_authenticated/-components/Sidebar.tsx`
  - Logo "hearted.", nav items, user section
  - Placed in routes/-components/ per TanStack Router convention

- [x] 4.3 Create `src/routes/_authenticated/-components/NavItem.tsx`
  - TanStack Router Link with active state

---

## 5. Home View Components ✅ (7/7 - MatchingPlaylistsSection deferred)

- [x] 5.1 ~~HomeView.tsx~~ → `Dashboard.tsx` (renamed, same purpose)

- [x] 5.2 ~~HomeHeader.tsx~~ → `DashboardHeader.tsx` (renamed)
  - Welcome greeting, stats row, sync button

- [x] 5.3 ~~NewSongsCTA.tsx~~ → `MatchReviewCTA.tsx` (renamed)
  - Conditional render when `reviewCount > 0`
  - FanSpreadAlbumArt + link to /match

- [x] 5.4 Create `FanSpreadAlbumArt.tsx`
  - 1-3 overlapping album covers with rotation
  - Hover effects (scale, translate, z-index)

- [x] 5.5 ~~useFanSpreadComposition.ts~~ → inlined as `getComposition()`
  - Returns positioning data based on image count

- [ ] ~~5.6 MatchingPlaylistsSection.tsx~~ → **DEFERRED** to Phase 7b.4 (Playlists view)

- [x] 5.7 Create `ActivityFeed.tsx`
  - Maps activities to ActivityItem components
  - Returns null when empty

- [x] 5.8 Create `ActivityItem.tsx`
  - Polymorphic component using discriminated union
  - Handles "liked" and "matched" activity types

---

## 6. Keyboard Shortcuts — **DEFERRED**

Deferred to future polish phase. Not blocking for MVP dashboard.

- [ ] ~~6.1 KeyboardShortcutProvider integration~~
- [ ] ~~6.2 ShortcutsHelpModal~~
- [ ] ~~6.3 Port keyboard hooks~~

---

## 7. Empty States ✅

- [x] 7.1 MatchReviewCTA empty state
  - `if (reviewCount === 0) return null;`

- [x] ~~7.2 MatchingPlaylistsSection empty~~ → deferred with component

- [x] 7.3 ActivityFeed empty state
  - `if (activities.length === 0) return null;`

---

## 8. Polish — **DEFERRED**

Deferred to future polish phase.

- [ ] ~~8.1 Loading states / Skeletons~~
- [ ] ~~8.2 Error handling / Error boundary~~
- [ ] ~~8.3 Mobile responsive~~

---

## Summary

| Phase           | Status      | Notes                              |
| --------------- | ----------- | ---------------------------------- |
| 1. Server/Data  | ✅ Complete | +3 extra implementations           |
| 2. Types        | ✅ Complete |                                    |
| 3. Routes       | ✅ Complete | Simplified structure               |
| 4. Shell        | ✅ Complete | Different paths than planned       |
| 5. Home View    | ✅ Complete | MatchingPlaylistsSection deferred  |
| 6. Keyboard     | ⏸️ Deferred | Future polish                      |
| 7. Empty States | ✅ Complete |                                    |
| 8. Polish       | ⏸️ Deferred | Future polish                      |

### Files Created/Modified

**New files:**
- `src/features/dashboard/Dashboard.tsx`
- `src/features/dashboard/types.ts`
- `src/features/dashboard/sections/DashboardHeader.tsx`
- `src/features/dashboard/sections/MatchReviewCTA.tsx`
- `src/features/dashboard/components/ActivityFeed.tsx`
- `src/features/dashboard/components/ActivityItem.tsx`
- `src/features/dashboard/components/FanSpreadAlbumArt.tsx`
- `src/lib/server/dashboard.server.ts`
- `src/lib/shared/utils/format-time.ts`
- `src/routes/_authenticated/-components/Sidebar.tsx`
- `src/routes/_authenticated/-components/NavItem.tsx`
- `src/routes/_authenticated/liked-songs.tsx` (placeholder)
- `src/routes/_authenticated/match.tsx` (placeholder)
- `src/routes/_authenticated/playlists.tsx` (placeholder)
- `src/routes/_authenticated/settings.tsx` (placeholder)
- `supabase/migrations/20260131183703_add_count_analyzed_songs_rpc.sql`

**Modified files:**
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/route.tsx`
- `src/lib/data/song-analysis.ts`
- `src/lib/data/liked-song.ts`
- `src/lib/data/jobs.ts`
- `src/lib/auth/guards.ts`
