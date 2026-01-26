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

### New Files to Create

| Target Location | Purpose |
|-----------------|---------|
| `src/routes/onboarding.tsx` | Main onboarding route with search params state |
| `src/routes/onboarding/-components/` | Step components (Welcome, PickColor, etc.) |
| `src/lib/theme/` | Theme system (colors, fonts, provider) |
| `src/components/ui/GrainOverlay.tsx` | Analog film grain texture |
| `src/components/ui/HeartRipple.tsx` | WebGL background effect |

### Existing Integration Points

| File | Integration |
|------|-------------|
| `src/routes/auth/spotify.callback.tsx` | Redirect to `/onboarding?step=syncing` after OAuth |
| `src/routes/api.jobs.$id.progress.tsx` | SSE endpoint for sync progress |
| `src/lib/hooks/useJobProgress.ts` | Real-time progress updates in Syncing step |
| `src/lib/data/playlists.ts` | Load user playlists for Flag step |

## Architecture Decision: Search Params State

**Decision**: Use TanStack Router search params instead of nested routes.

### Why Search Params?

| Aspect | Nested Routes | Search Params (Chosen) |
|--------|---------------|------------------------|
| State persistence | Route path | URL query string |
| Back button | Each step is history entry | Configurable |
| Shareable URLs | `/onboarding/syncing` | `/onboarding?step=syncing&theme=rose` |
| File overhead | 7+ route files | 1 route file + components |
| Prototype match | Requires refactor | Direct port (useState → useSearch) |

### Search Params Schema

```typescript
import { z } from 'zod'
import { fallback, zodValidator } from '@tanstack/zod-adapter'

const onboardingStepSchema = z.enum([
  'welcome',
  'pick-color',
  'connecting',
  'syncing',
  'flag-playlists',
  'ready',
  'complete'
])

const onboardingSearchSchema = z.object({
  step: fallback(onboardingStepSchema, 'welcome').default('welcome'),
  theme: fallback(z.enum(['blue', 'green', 'rose', 'lavender']), 'rose').default('rose'),
  jobId: z.string().uuid().optional(), // For syncing step
  skippedPlaylists: z.boolean().optional(),
})

export const Route = createFileRoute('/onboarding')({
  validateSearch: zodValidator(onboardingSearchSchema),
})
```

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
