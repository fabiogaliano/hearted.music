# Implementation Tasks

**Status**: ✅ Complete (cosmetic polish deferred)
**Approach**: Direct copy from v0 + adapt in place
**Last Updated**: 2026-02-03

---

## Phase 1: Infrastructure ✅

### 1.1 Create TaggedErrors
- [x] Create `src/lib/shared/errors/domain/liked-songs.ts`
  - Errors: `LikedSongsLoadError`, `SongNotFoundError`, `AlbumArtBatchError`
  - Export union type `LikedSongsError`

### 1.2 Create Query Key Factory
- [x] Create `src/features/liked-songs/queries.ts` (41 lines)
  - `likedSongsKeys` factory pattern
  - `likedSongsInfiniteQueryOptions()` for paginated list
  - `likedSongsStatsQueryOptions()` for header stats

### 1.3 Create Server Functions
- [x] Create `src/lib/server/liked-songs.server.ts` (245 lines)
  - Cursor-based pagination for liked songs
  - Stats aggregation function

---

## Phase 2: Bulk Copy ✅

### 2.1 Copy All v0 Files
- [x] Copy directory structure to `src/features/liked-songs/`
- [x] 15 files total (~3,150 lines)

---

## Phase 3: Import Path Adaptations ✅

### 3.1 Fix Import Paths
- [x] Update import aliases (`~/` → `@/`)
- [x] Update theme imports to use `useTheme()` hook
- [x] Update keyboard imports to v1 location

### 3.2 Adapt types.ts
- [x] Create `src/features/liked-songs/types.ts` (149 lines)
- [x] `LikedSong`, `SongAnalysis`, `UIAnalysisStatus` types

### 3.3 Adapt detail/utils.ts
- [x] Pure utility functions (45 lines)

---

## Phase 4: Hook Adaptations ✅

### 4.1 Adapt useInfiniteScroll.ts
- [x] IntersectionObserver-based pagination (60 lines)

### 4.2 Adapt useSongExpansion.ts
- [x] FLIP animation + URL sync via `window.history.pushState` (210 lines)
- [x] Accept `initialSlug` from route search params
- **Deviation**: Uses `history.pushState` directly (simpler than TanStack navigate)

### 4.3 ~~useVisibleSongsAlbumArt.ts~~
- [x] **SKIPPED** - Album art handled inline via simpler approach

### 4.4 Create useArtistImage.ts
- [x] TanStack Query wrapper for artist images (50 lines)

### 4.5 ~~Extract useHeroCollapse.ts~~
- [x] **SKIPPED** - Collapse logic kept inline in SongDetailPanel (YAGNI)
- Rationale: Extraction adds indirection without reuse benefit

---

## Phase 5: Component Adaptations ✅

### 5.1 Adapt SongCard.tsx
- [x] List item component (136 lines)
- [x] Uses `useTheme()` hook

### 5.2 Adapt SongDetailPanel.tsx
- [x] Full detail overlay (925 lines)
- [x] Hero collapse logic inline (not extracted)
- [x] Uses `useArtistImage` hook
- [x] Dark mode support via `useThemeWithOverride`

### 5.3 Adapt detail/*.tsx (5 components)
- [x] AudioInfo.tsx (57 lines)
- [x] ContextSection.tsx (40 lines)
- [x] MeaningSection.tsx (302 lines)
- [x] Nav.tsx (81 lines)
- [x] PlaylistsSection.tsx (265 lines)

### 5.4 Create PanelSkeleton.tsx
- [x] Loading placeholder (71 lines)

---

## Phase 6: Page & Route ✅

### 6.1 Adapt LikedSongsPage.tsx
- [x] Main page component (356 lines)
- [x] Infinite scroll pagination
- [x] Filter tabs (all/pending/matched/analyzed)
- [x] Stats header integration

### 6.2 Update Route
- [x] `src/routes/_authenticated/liked-songs.tsx` (29 lines)
- [x] Search params: `filter`, `song`
- [x] Uses `ensureInfiniteQueryData` in loader

### 6.3 ~~Feature Index~~
- [x] **SKIPPED** - Direct imports used (no barrel file needed)

---

## Phase 7: Keyboard Integration ✅

### 7.1 Wire List Navigation
- [x] Uses `useListNavigation` hook
- [x] j/k moves focus, Enter expands

### 7.2 Wire Panel Navigation
- [x] Verify Escape closes panel
- [x] Verify j/k navigates between songs
- [x] Verify Cmd+D toggles dark mode

---

## Phase 8: Database ✅

### 8.1 Migrations
- [x] `20260116160002_create_liked_song.sql`
- [x] `20260202082559_add_liked_songs_page_function.sql` (consolidated: LATERAL join + item_status)
- [x] `20260202204006_add_liked_songs_stats_function.sql` (fixed: item_status counts)

---

## Phase 9: Polish & Verification ✅

### 9.1 Loading States
- [x] PanelSkeleton for detail panel
- ~~Skeleton cards for initial load~~ — text loading state exists, skeleton cards are cosmetic polish
- ~~"Loading more..." at sentinel~~ — IntersectionObserver triggers silently, visual indicator is optional

### 9.2 Empty States
- [x] No songs state — `"No liked songs yet..."` for all filter
- [x] No matches for filter state — `` No ${filter} songs. `` for filtered views

### 9.3 Error Handling
- ~~Route errorComponent~~ — server function returns empty gracefully, dedicated error page is separate polish
- ~~Deep link 404 handling~~ — `?song=slug` handled gracefully by expansion hook (no crash path)

### 9.4 Visual Parity Verification
- [x] Compare v0 and v1 side-by-side
- [x] Verify animations match

---

## Summary

| Phase             | Status | Files                        |
| ----------------- | ------ | ---------------------------- |
| 1. Infrastructure | ✅      | 3 files created              |
| 2. Bulk Copy      | ✅      | 15 files copied              |
| 3. Import Paths   | ✅      | All adapted                  |
| 4. Hooks          | ✅      | 3 adapted (2 skipped)        |
| 5. Components     | ✅      | All 8 complete               |
| 6. Page & Route   | ✅      | Route wired                  |
| 7. Keyboard       | ✅      | All verified                 |
| 8. Database       | ✅      | 4 migrations                 |
| 9. Polish         | ✅      | Core done, cosmetic deferred |

## Deviations from Original Plan

| Planned                        | Actual              | Rationale               |
| ------------------------------ | ------------------- | ----------------------- |
| `useVisibleSongsAlbumArt` hook | Skipped             | Simpler inline approach |
| `useHeroCollapse` extraction   | Kept inline         | YAGNI - no reuse case   |
| TanStack `navigate()` for URLs | `history.pushState` | Simpler, works fine     |
| `index.ts` barrel export       | Direct imports      | Less indirection        |
