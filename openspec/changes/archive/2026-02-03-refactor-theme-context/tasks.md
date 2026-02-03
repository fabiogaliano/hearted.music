# Tasks: Refactor Theme to Context Pattern

**Status:** ✅ All Complete

## Phase 1: Provider Setup

- [x] Extend `ThemeHueProvider` to store and provide `ThemeConfig` via context
- [x] Add `useTheme()` hook for components to consume theme
- [x] Add `useThemeWithOverride()` hook for optional override pattern
- [x] Keep `useRegisterTheme()` for routes (already exists)

## Phase 2: Migrate Leaf Components

- [x] `src/components/ui/AlbumPlaceholder.tsx`
- [x] `src/components/ui/CDCase.tsx`
- [x] `src/components/ui/HeartRipplePlaceholder.tsx`
- [x] `src/components/ui/HeartRippleBackground.tsx`
- [x] `src/features/landing/components/ThemesList.tsx`
- [x] `src/features/landing/components/AnimatedHeart.tsx`
- [x] `src/features/landing/components/WaitlistInput.tsx`
- [x] `src/features/landing/components/SpotifyLoginButton.tsx`
- [x] `src/features/landing/components/ReleaseToggle.tsx`

## Phase 3: Migrate Navigation Components

- [x] `src/routes/_authenticated/-components/Sidebar.tsx`
- [x] `src/routes/_authenticated/-components/NavItem.tsx`

## Phase 4: Migrate Onboarding Components

- [x] `src/features/onboarding/Onboarding.tsx`
- [x] `src/features/onboarding/components/StepContainer.tsx`
- [x] `src/features/onboarding/components/WelcomeStep.tsx`
- [x] `src/features/onboarding/components/ConnectingStep.tsx`
- [x] `src/features/onboarding/components/SyncingStep.tsx`
- [x] `src/features/onboarding/components/PickColorStep.tsx`
- [x] `src/features/onboarding/components/FlagPlaylistsStep.tsx`
- [x] `src/features/onboarding/components/ReadyStep.tsx`

## Phase 5: Migrate Dashboard Components

- [x] `src/features/dashboard/Dashboard.tsx`
- [x] `src/features/dashboard/components/ActivityFeed.tsx`
- [x] `src/features/dashboard/components/ActivityItem.tsx`
- [x] `src/features/dashboard/sections/DashboardHeader.tsx`
- [x] `src/features/dashboard/sections/MatchReviewCTA.tsx`

## Phase 6: Migrate Landing Components

- [x] `src/features/landing/Landing.tsx`
- [x] `src/features/landing/components/LandingHero.tsx`
- [x] `src/features/landing/components/SongPreviewPanel.tsx`
- [x] `src/features/matching/components/SongSection.tsx`
- [x] `src/features/matching/components/MatchesSection.tsx`

## Phase 7: Migrate Liked Songs Components

- [x] `src/features/liked-songs/LikedSongsPage.tsx`
- [x] `src/features/liked-songs/components/SongCard.tsx`
- [x] `src/features/liked-songs/components/SongDetailPanel.tsx` (special: useThemeWithOverride)
- [x] `src/features/liked-songs/components/PanelSkeleton.tsx`
- [x] `src/features/liked-songs/components/detail/Nav.tsx`
- [x] `src/features/liked-songs/components/detail/AudioInfo.tsx`
- [x] `src/features/liked-songs/components/detail/ContextSection.tsx`
- [x] `src/features/liked-songs/components/detail/MeaningSection.tsx`
- [x] `src/features/liked-songs/components/detail/PlaylistsSection.tsx`

## Phase 8: Update Routes

- [x] `src/routes/__root.tsx` - Remove theme props from children
- [x] `src/routes/index.tsx` - Remove theme prop from Landing
- [x] `src/routes/_authenticated/route.tsx` - Remove theme prop from Sidebar
- [x] `src/routes/_authenticated/dashboard.tsx` - Remove theme prop from Dashboard
- [x] `src/routes/_authenticated/liked-songs.tsx` - Remove theme prop from LikedSongsPage

## Phase 9: Update Tests

- [x] Add `ThemeHueProvider` to test utilities wrapper
- [x] Remove `theme` props from test renders
- [x] Verify all tests pass

## Phase 10: Cleanup

- [x] Remove unused `useSyncThemeHue` from `useTheme.ts`
- [x] Remove unused ThemeConfig imports where applicable
- [x] Run `bun run typecheck` - passes
- [x] Run `bun run test` - 125 tests pass

## Phase 11: Performance Optimization

- [x] Split single `ThemeContext` into `ThemeDispatchContext` and `ThemeStateContext`
- [x] Add `useCallback` for `registerTheme` with empty dependency array
- [x] Use functional `setTheme((current) => ...)` to avoid stale closure
- [x] Add lazy initial state `() => themes[DEFAULT_THEME]`
- [x] Add `displayName` for React DevTools debugging
- [x] Verify API unchanged (all 41 consumers work without modification)
- [x] Run `bun run typecheck` - passes
- [x] Run `bun run test` - 125 tests pass
