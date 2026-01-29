# Change: Add Onboarding Frontend (Phase 7a)

## Why

The backend infrastructure is complete (auth, sync, analysis, SSE progress), but users have no way to experience the app. The onboarding flow is the **first user-facing feature** that will:

1. **Deliver the "aha moment"**: Show automatic song sorting in action
2. **Build trust progressively**: Small asks → bigger asks (OAuth → theme → playlists → API key)
3. **Guide without blocking**: Suggest, don't force (playlists and API key are skippable)

We have a **production-ready prototype** in `old_app/prototypes/warm-pastel/` (578 lines) that implements the full visual design. This change ports and adapts it to the v1 architecture.

## What Changes

### Source: Warm-Pastel Prototype (`old_app/prototypes/warm-pastel/`)

| File/Directory | Lines | What We Use |
|---------------|-------|-------------|
| `onboarding.tsx` | 578 | Full onboarding state machine, 6 steps |
| `shared/theme.ts` | ~100 | Theme system with 4 colors, dark mode |
| `shared/components/` | ~200 | GrainOverlay, HeartRippleBackground |
| `shared/utils/color.ts` | ~50 | HSL utilities, pastel generation |
| `DESIGN-GUIDANCE.md` | — | Typography & spacing reference |

### New Files Created

| Target Location | Purpose |
|-----------------|---------|
| `src/routes/_authenticated/route.tsx` | Auth guard layout wrapping all protected routes |
| `src/routes/_authenticated/onboarding.tsx` | Onboarding route with step search param |
| `src/features/onboarding/Onboarding.tsx` | Main orchestrator component |
| `src/features/onboarding/components/` | Step components (WelcomeStep, PickColorStep, etc.) |
| `src/features/onboarding/hooks/useOnboardingNavigation.ts` | Step navigation helpers |
| `src/lib/theme/` | Theme system (colors, fonts, types) |
| `src/lib/server/onboarding.server.ts` | Server functions (createSyncJob, saveTheme, etc.) |
| `src/components/ui/HeartRippleBackground.tsx` | WebGL heart ripple effect |
| `src/components/ui/GrainOverlay.tsx` | Analog film grain texture |

### Existing Integration Points

| File | Integration |
|------|-------------|
| `src/routes/auth/spotify/callback.tsx` | Redirect to `/dashboard` (which then redirects to onboarding if incomplete) |
| `src/routes/_authenticated/dashboard.tsx` | Checks onboarding status, redirects to `/onboarding?step={currentStep}` |
| `src/routes/api/jobs/$id/progress.tsx` | SSE endpoint for sync progress |
| `src/lib/hooks/useJobProgress.ts` | Real-time progress updates in Syncing step |
| `src/lib/data/playlists.ts` | Load user playlists for Flag step |

## Architecture Decision: Hybrid State Management

**Decision**: Use minimal search params (step only) + router state + database for different state lifetimes.

### Why Hybrid Approach?

| Data | Storage | Rationale |
|------|---------|-----------|
| Current step | URL search param (`?step=`) | Shareable, bookmarkable |
| Theme selection | Database + local state | Persisted, not cluttering URL |
| Job IDs | Router history state | Ephemeral, passed between steps |
| Library summary | Router history state | Ephemeral, fetched fresh each flow |
| Sync stats | Router history state | Forward from SyncingStep to ReadyStep |

### Actual Search Params Schema

```typescript
import { z } from 'zod'
import { zodValidator } from '@tanstack/zod-adapter'

const searchSchema = z.object({
  step: z.enum(ONBOARDING_STEPS).default('welcome'),
})

export const Route = createFileRoute('/_authenticated/onboarding')({
  validateSearch: zodValidator(searchSchema),
})
```

### Router History State (via navigate options)

```typescript
// Declared in src/features/onboarding/types.ts
declare module '@tanstack/react-router' {
  interface HistoryState {
    phaseJobIds?: PhaseJobIds      // Job tracking for sync
    theme?: string                  // Selected theme
    syncStats?: SyncStats           // Song/playlist counts
    librarySummary?: LibrarySummary // Pre-fetched totals
  }
}
```

### Authenticated Layout Pattern

The onboarding route is wrapped in `_authenticated/route.tsx`:
- Validates session via `requireAuth()` in `beforeLoad`
- Provides `session` in route context for all child routes
- Unauthenticated users are redirected to `/` (landing)

## Impact

### Affected Specs
- `onboarding` - Implementation of spec requirements

### Affected Code
- `src/routes/` - New onboarding route
- `src/lib/theme/` - New theme system
- `src/components/ui/` - New shared components
- `src/routes/auth/spotify.callback.tsx` - Redirect logic update

### Database
- Uses existing `user_preferences.onboarding_step` column
- No schema changes required

### Dependencies
- **No new npm packages** - Uses existing TanStack Router, Zod, Tailwind

## Acceptance Criteria

1. **Landing (welcome)**: Shows value prop, "Get Started" CTA navigates to OAuth
2. **Theme (pick-color)**: User selects theme, persisted in search params and preferences
3. **Connecting**: Shows while OAuth redirect is in progress
4. **Syncing**: Real-time progress via SSE, shows percentage and current item
5. **Flag Playlists**: Grid of user's playlists, can select destinations (skippable)
6. **Ready**: Shows completion stats, "Go to Dashboard" button
7. **Resumability**: Refreshing page or returning continues from saved step
8. **Mobile**: Responsive layout works on all screen sizes
9. **Accessibility**: Keyboard navigation, screen reader friendly

## AI Assistant Tools

When implementing this change, use:

- **`tanstack-start-react` skill** - For route loaders, search params, server functions
- **`react-best-practices` skill** - For component patterns, performance
- **`web-interface-guidelines` skill** - For UI review, accessibility
- **TanStack MCP** - For up-to-date TanStack Router documentation

## References

- [Onboarding Spec](/openspec/specs/onboarding/spec.md)
- [Onboarding Flow Design](/docs/ONBOARDING-FLOW.md)
- [Warm-Pastel Prototype](/old_app/prototypes/warm-pastel/)
- [TanStack Router Search Params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
