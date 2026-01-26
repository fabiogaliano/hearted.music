# Implementation Tasks

Tasks ordered by dependency. Foundation first (theme, components), then route, then integration.

**Status**: Phase 1-4 complete (MVP), Phase 5-8 pending

---

## 0. Prerequisites

- [x] 0.1 Review warm-pastel prototype structure (`old_app/prototypes/warm-pastel/`)
- [x] 0.2 Confirm auth callback currently redirects to `/` (will change to `/onboarding`)
- [x] 0.3 Verify `useJobProgress` hook exists and works with SSE endpoint
- [x] 0.4 Check `playlists.ts` has query to fetch user playlists

---

## 1. Theme System (Port from Prototype) ✅

### 1.1 Theme Types and Config

- [x] 1.1.1 Create `src/lib/theme/types.ts`
  - Define `ThemeColor = 'blue' | 'green' | 'rose' | 'lavender'`
  - Define `ThemeConfig` interface (bg, surface, text, primary, etc.)
  - Define `THEME_COLORS` array and `COLOR_LABELS` map

- [x] 1.1.2 Create `src/lib/theme/colors.ts`
  - Port color definitions from `warm-pastel/shared/theme.ts`
  - Export `themes: Record<ThemeColor, ThemeConfig>`
  - Export `getDarkTheme(base: ThemeConfig): ThemeConfig`
  - Export `getThemeHue(theme: ThemeConfig): number`

- [x] 1.1.3 Create `src/lib/theme/fonts.ts`
  - Define font stacks (display: Instrument Serif, body: Geist)
  - Export `GOOGLE_FONTS_URL` for loading in root

### 1.2 Theme Exports

- [x] 1.2.1 Create `src/lib/theme/useTheme.ts`
  - Create `useTheme(color)` hook returning theme config
  - Create `getTheme(color)` for non-hook usage

- [x] 1.2.2 Add Google Fonts to `src/routes/__root.tsx`
  - Preconnect to fonts.googleapis.com
  - Load Instrument Serif and Geist fonts

- [x] 1.2.3 Create `src/lib/theme/index.ts`
  - Barrel export for theme system

---

## 2. Shared UI Components (Port from Prototype) ✅

### 2.1 Visual Effects

- [x] 2.1.1 Create `src/components/ui/HeartRippleBackground.tsx`
  - Port from `warm-pastel/shared/components/HeartRippleBackground.tsx`
  - WebGL shader with heart-shaped ripple effects
  - Responds to pointer movement

- [x] 2.1.2 Create `src/components/ui/HeartRipplePlaceholder.tsx`
  - Static fallback for WebGL-unsupported browsers

### 2.2 Color Utilities

- [x] 2.2.1 Create `src/lib/utils/color.ts`
  - Port `extractHue()` and color manipulation utilities

- [x] 2.2.2 Create `src/lib/utils/palette.ts`
  - Port `generatePalette()` for WebGL colors
  - HSL to RGB conversion utilities

---

## 3. Onboarding Route ✅

### 3.1 Route Setup

- [x] 3.1.1 Create `src/routes/onboarding.tsx`
  - Use `createFileRoute('/onboarding')`
  - Add `validateSearch` with Zod schema (step, theme, jobId, skippedPlaylists)
  - Use `zodValidator` and `fallback` from `@tanstack/zod-adapter`

- [x] 3.1.2 Add route component shell
  - Theme-aware background via inline styles
  - Conditional rendering based on `step` search param
  - Step indicator dots (hidden during loading states)

### 3.2 Step Components

All components in `src/routes/onboarding.tsx` (inline, not separate files):

- [x] 3.2.1 Create `WelcomeStep`
  - Large editorial headline "hearted"
  - Value proposition text
  - "Get Started" button → navigates to pick-color

- [x] 3.2.2 Create `PickColorStep`
  - 4 color swatches (blue, green, rose, lavender)
  - Live theme preview on selection
  - "Continue" button → navigates to connecting

- [x] 3.2.3 Create `ConnectingStep`
  - "Linking to Spotify" text
  - Pulsing dots animation

- [x] 3.2.4 Create `SyncingStep`
  - Large percentage display (tabular-nums)
  - Current item label from SSE
  - Uses `useJobProgress(jobId)` for real-time updates
  - Auto-transition to flag-playlists on completion

- [x] 3.2.5 Create `FlagPlaylistsStep`
  - Grid of playlist cards with images
  - Selection state (greyscale when unselected)
  - "Continue with N playlists" button

- [x] 3.2.6 Create `ReadyStep`
  - Completion stats (Songs, Playlists, To Sort)
  - "Start Sorting" link to dashboard

### 3.3 Step Navigation

- [x] 3.3.1 Create `StepIndicator` component
  - Minimal dots showing current progress
  - Hidden during connecting/syncing steps
  - Animated width on active dot

- [x] 3.3.2 Create `useOnboardingNavigation` hook
  - `goToStep(step, extra?)` - updates search params
  - `setTheme(theme)` - updates theme in URL
  - Convenience methods: `goToWelcome()`, `goToPickColor()`, etc.

---

## 4. Auth Integration ✅ (Complete)

### 4.1 OAuth Callback Update

- [x] 4.1.1 Update `src/routes/auth/spotify.callback.tsx`
  - Create `sync_liked_songs` job after successful OAuth
  - Redirect to `/onboarding?step=syncing&jobId={job.id}`
  - Include session cookie in redirect headers

### 4.2 Session Check

- [x] 4.2.1 ~~Add session loader to onboarding route~~ N/A
  - Route-level `beforeLoad` already redirects unauthenticated users to `/`
  - Per-step auth not needed: all of `/onboarding` requires authentication

---

## 5. Data Integration

### 5.1 Playlist Loading

- [ ] 5.1.1 Add playlist query to FlagPlaylistsStep
  - Use TanStack Query with route loader data
  - Show loading skeleton while fetching
  - Handle empty state (no playlists)
  - Replace mock data with real API call

### 5.2 Preference Persistence

- [ ] 5.2.1 Create server function for updating preferences
  - `updateOnboardingStep(step: OnboardingStep)`
  - `updateThemePreference(theme: ThemeColor)`
  - `updateFlaggedPlaylists(playlistIds: string[])`

- [ ] 5.2.2 Sync URL state with DB state
  - On step change, update DB
  - On page load, restore from DB if URL doesn't specify

---

## 6. Polish & Accessibility

### 6.1 Animations

- [ ] 6.1.1 Add step transition animations
  - Fade in/out between steps
  - Consider CSS transitions or Framer Motion

### 6.2 Responsive Design

- [x] 6.2.1 Basic mobile layout working
  - Playlist grid uses responsive widths
  - Text scales appropriately

- [ ] 6.2.2 Fine-tune mobile experience
  - Touch-friendly tap targets
  - Safe area insets

### 6.3 Accessibility

- [ ] 6.3.1 Keyboard navigation
  - Tab through color options
  - Enter to select
  - Focus management between steps

- [ ] 6.3.2 Screen reader support
  - ARIA labels on color options
  - Progress announcements during sync
  - Step indicator announces current step

---

## 7. Testing

- [ ] 7.1 Add unit tests for theme utilities
- [ ] 7.2 Add component tests for each step
- [ ] 7.3 Add integration test for full onboarding flow
- [x] 7.4 Run typecheck and lint
  - `bun run typecheck` ✅ passing

---

## 8. Documentation

- [ ] 8.1 Update ROADMAP.md to mark Phase 7a progress
- [ ] 8.2 Add JSDoc comments to theme system and hooks
- [ ] 8.3 Update onboarding spec with implementation status

---

## Bonus: Landing Page ✅

Not in original spec, but ported as part of implementation:

- [x] Port `Landing` component from prototype
- [x] Port `LandingHero`, `SongPreviewPanel`, `ThemesList` components
- [x] Port `SpotifyLoginButton` (simplified for TanStack Router)
- [x] Add GSAP dependency for scroll animations
- [x] Update `src/routes/index.tsx` to use Landing component
- [x] Port mock data for landing page demo

---

## Dependencies Graph

```
Theme System (1) ✅
    ↓
UI Components (2) ✅
    ↓
Route Setup (3.1) ✅
    ↓
Step Components (3.2) ✅ ←── Data Integration (5) ⏳
    ↓                         ↑
Step Navigation (3.3) ✅       │
    ↓                         │
Auth Integration (4) ✅ ───────┘
    ↓
Polish (6) ⏳
    ↓
Testing (7) ⏳
```

---

## Summary

| Phase               | Status     | Notes                             |
| ------------------- | ---------- | --------------------------------- |
| 0. Prerequisites    | ✅ Complete |                                   |
| 1. Theme System     | ✅ Complete | 6 files in `src/lib/theme/`       |
| 2. UI Components    | ✅ Complete | HeartRipple, color utils          |
| 3. Onboarding Route | ✅ Complete | All 6 steps, navigation hook      |
| 4. Auth Integration | ✅ Complete | Callback + route-level auth guard |
| 5. Data Integration | ⏳ Pending  | Using mock data currently         |
| 6. Polish           | ⏳ Pending  | Basic responsive done             |
| 7. Testing          | ⏳ Pending  | Typecheck passing                 |
| 8. Documentation    | ⏳ Pending  |                                   |
| Bonus: Landing      | ✅ Complete | Full landing page ported          |
