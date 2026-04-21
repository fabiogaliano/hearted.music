# Guided Onboarding — Terminology

> Canonical names for the guided onboarding implementation.
> All code, types, and documentation should use these terms consistently.

## Core Concepts

| Term | Definition |
|------|------------|
| **Walkthrough** | The phase where users experience real app routes (`/liked-songs`, `/match`) in a restricted, guided state during onboarding |
| **Steps** | Standard onboarding screens rendered on `/onboarding` (welcome, pick-color, etc.) |
| **Walkthrough song** | The song the user selects during onboarding to use throughout the walkthrough |

## Types & Values

### OnboardingMode

The UI rendering mode, exposed via route context.

```ts
type OnboardingMode = "complete" | "steps" | "walkthrough";
```

| Value | When | Sidebar | Route |
|-------|------|---------|-------|
| `"complete"` | Onboarding finished | Visible | Any |
| `"steps"` | On standard onboarding screens | Hidden | `/onboarding` |
| `"walkthrough"` | On real app routes during walkthrough steps | Hidden | `/liked-songs`, `/match` |

### OnboardingStep (DB enum)

Step values stored in `user_preferences.onboarding_step`.

```ts
export const ONBOARDING_STEPS = z.enum([
  "welcome",
  "pick-color",
  "install-extension",
  "syncing",
  "flag-playlists",
  "pick-demo-song",
  "song-walkthrough",   // was song-showcase
  "match-walkthrough",  // was match-showcase
  "plan-selection",
  "complete",
]);
```

**Migration required:**
```sql
UPDATE user_preferences SET onboarding_step = 'song-walkthrough'
WHERE onboarding_step = 'song-showcase';

UPDATE user_preferences SET onboarding_step = 'match-walkthrough'
WHERE onboarding_step = 'match-showcase';
```

### ResolvedStep

Return type from the step resolver. Contains routing + mode info for a step.

```ts
type ResolvedStep = {
  allowedPath: "/onboarding" | "/liked-songs" | "/match";
  onboardingMode: "steps" | "walkthrough";
};
```

## Modules & Functions

### step-resolver.ts

Location: `src/features/onboarding/step-resolver.ts`

```ts
function resolveStep(step: OnboardingStep): ResolvedStep;
function isPathAllowed(pathname: string, resolved: ResolvedStep): boolean;
```

**Mapping:**

| Step | `allowedPath` | `onboardingMode` |
|------|---------------|------------------|
| `song-walkthrough` | `/liked-songs` | `"walkthrough"` |
| `match-walkthrough` | `/match` | `"walkthrough"` |
| All others | `/onboarding` | `"steps"` |

### useStepNavigation()

Hook for cross-route step transitions. Saves step to DB, updates cache, navigates.

Location: `src/features/onboarding/hooks/useStepNavigation.ts`

```ts
const { navigateTo } = useStepNavigation();

navigateTo("match-walkthrough"); // saves + cache sync + navigate
```

## Route Context

Fields exposed via `_authenticated/route.tsx` route context:

| Field | Type | Description |
|-------|------|-------------|
| `onboardingMode` | `OnboardingMode` | Current UI mode |
| `walkthroughSong` | `WalkthroughSong \| null` | Song for walkthrough steps |

### WalkthroughSong

```ts
type WalkthroughSong = {
  id: string;
  spotifyTrackId: string;
  slug: string;
  name: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
};
```

## Component Props

### SongDetailPanel

```ts
interface SongDetailPanelProps {
  isWalkthrough: boolean; // true during walkthrough steps
  // ... other props
}
```

When `isWalkthrough === true`:
- Render analysis only (no PlaylistsSection)
- Show sticky footer CTA: `"See where this song belongs →"`

### SongCard

```ts
interface SongCardProps {
  isEnabled: boolean; // false for dimmed/non-interactive cards
  // ... other props
}
```

When `isEnabled === false`:
- `opacity-50`
- `pointer-events-none`
- No hover states

## UI Copy

| Location | Copy |
|----------|------|
| Song detail panel CTA | `"See where this song belongs →"` |
| Plan selection success CTA | `"Start Exploring →"` |

## Step-to-Mode Mapping Summary

| Step | Mode | Route |
|------|------|-------|
| `welcome` | `steps` | `/onboarding` |
| `pick-color` | `steps` | `/onboarding` |
| `install-extension` | `steps` | `/onboarding` |
| `syncing` | `steps` | `/onboarding` |
| `flag-playlists` | `steps` | `/onboarding` |
| `pick-demo-song` | `steps` | `/onboarding` |
| `song-walkthrough` | `walkthrough` | `/liked-songs` |
| `match-walkthrough` | `walkthrough` | `/match` |
| `plan-selection` | `steps` | `/onboarding` |
| `complete` | `complete` | Any |
