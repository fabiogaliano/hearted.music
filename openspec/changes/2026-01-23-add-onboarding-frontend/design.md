# Design Document: Onboarding Frontend

## Overview

This document captures key technical decisions for the onboarding frontend implementation.

---

## 1. Routing Architecture

### Decision: Single Route with Search Params

```
/onboarding?step=welcome
/onboarding?step=pick-color&theme=rose
/onboarding?step=syncing&jobId=abc-123&theme=rose
```

### Rationale

TanStack Router's search params are **first-class state management**:

1. **Type-safe with Zod**: Full inference from schema to component
2. **URL-persistent**: Bookmarkable, shareable, back-button works
3. **Middleware support**: Can retain/strip params across navigation
4. **Matches prototype**: Easy port from `useState` pattern

### Alternative Considered: Nested Routes

```
/onboarding/welcome
/onboarding/pick-color
/onboarding/syncing
```

**Rejected because:**
- More file overhead (7+ route files vs 1)
- Shared state requires route context or external store
- Prototype uses internal state machine (harder to port)

---

## 2. Component Architecture

### Directory Structure

```
src/routes/onboarding.tsx          # Route definition + search params
src/routes/onboarding/
  -components/                     # Co-located step components
    WelcomeStep.tsx
    PickColorStep.tsx
    ConnectingStep.tsx
    SyncingStep.tsx
    FlagPlaylistsStep.tsx
    ReadyStep.tsx
    StepIndicator.tsx
  -hooks/
    useOnboardingNavigation.ts     # Step navigation helpers
```

### Why `-components/` Prefix?

TanStack Router file-based routing uses `-` prefix for non-route directories:
- `onboarding/-components/` → NOT a route
- `onboarding/step.tsx` → WOULD be a nested route (we don't want this)

---

## 3. Theme System

### Token Structure

```typescript
interface ThemeTokens {
  // Backgrounds
  bg: string           // Page background
  surface: string      // Card/panel background
  surfaceDim: string   // Muted surface
  border: string       // Borders

  // Text
  text: string         // Primary text
  textMuted: string    // Secondary text
  textOnPrimary: string // Text on primary color

  // Accent
  primary: string      // Primary action color
  primaryHover: string // Primary hover state
}
```

### CSS Variables Approach

Theme tokens are applied as CSS variables on `:root`:

```css
:root {
  --theme-bg: hsl(30, 20%, 98%);
  --theme-text: hsl(30, 10%, 15%);
  --theme-primary: hsl(350, 60%, 55%);
  /* ... */
}
```

**Why CSS Variables?**
- Works with Tailwind's `bg-[var(--theme-bg)]` syntax
- Enables smooth dark mode transitions
- No JS re-renders on theme change

### Color Options

| ID | Name | Hue | Character |
|----|------|-----|-----------|
| `blue` | Ocean | 210 | Calm, professional |
| `green` | Forest | 150 | Fresh, natural |
| `rose` | Coral | 350 | Warm, friendly (default) |
| `lavender` | Violet | 270 | Creative, playful |

---

## 4. State Synchronization

### Three Sources of Truth

1. **URL Search Params**: Current step, theme, jobId
2. **Database**: `user_preferences.onboarding_step`, `theme_color`
3. **React State**: Transient UI state (animations, loading)

### Sync Strategy

```
URL (primary for navigation)
  ↑↓ (bidirectional sync)
Database (persistence for resumability)
  ↓ (read-only for UI)
React State (derived/transient)
```

**Rules:**
1. URL change → update DB
2. Page load → read DB if URL missing step param
3. React state derived from URL + DB, never written back

### Edge Cases

| Scenario | Handling |
|----------|----------|
| URL says `syncing` but no jobId | Redirect to `connecting`, start new sync |
| URL says `complete` but DB says `syncing` | Trust DB, redirect to actual step |
| User manually edits URL to skip | Validate prerequisites, block or allow |

---

## 5. SSE Integration for Syncing Step

### Connection Lifecycle

```
SyncingStep mounts
  ↓
useJobProgress(jobId) connects to /api/jobs/{jobId}/progress
  ↓
SSE events update local state
  ↓
When status === 'completed':
  - Close SSE connection
  - Navigate to flag-playlists step
```

### Progress Display

```typescript
// Derived values for UI
const percentage = Math.round((done / total) * 100)
const statusText = currentItem?.label ?? 'Preparing...'
```

### Error Handling

| Error | Handling |
|-------|----------|
| Job not found | Show error, offer retry |
| SSE disconnects | EventSource auto-reconnects |
| Job fails | Show failure message, offer retry |

---

## 6. Playlist Selection (Flag Step)

### Data Flow

```
Route loader fetches playlists
  ↓
FlagPlaylistsStep receives via useLoaderData()
  ↓
Local state tracks selection
  ↓
"Continue" saves selection to DB via server function
```

### Selection Rules

- Minimum 1 playlist selected OR explicit skip
- Skip records `skippedPlaylists: true` in search params
- Dashboard shows reminder banner if skipped

### UI Pattern

- Grid layout (3 columns desktop, 1 mobile)
- Playlist card: cover art, name, track count, checkbox
- "Select All" / "Clear" helpers

---

## 7. Typography System

From DESIGN-GUIDANCE.md:

### Headlines (Display Font: Instrument Serif)

| Element | Size | Weight | Tracking |
|---------|------|--------|----------|
| Hero | 8xl (96px) | 400 | -0.02em |
| Section | 5xl (48px) | 400 | -0.01em |
| Card | 2xl (24px) | 400 | 0 |

### Body (Body Font: Geist)

| Element | Size | Weight |
|---------|------|--------|
| Body | base (16px) | 400 |
| Label | xs (12px) | 500 uppercase |
| Stat | 4xl (36px) | 200 tabular-nums |

---

## 8. Animation Considerations

### Step Transitions

- Fade out current → Fade in next (150ms each)
- No horizontal slide (feels like page navigation)
- Maintain scroll position

### Micro-interactions

| Element | Animation |
|---------|-----------|
| Color picker | Scale 1.05 on hover, ring on select |
| Step indicator | Width expand on active (dots) |
| Progress | Count up with easing |
| Buttons | Subtle lift on hover |

### Performance

- Use CSS transforms (GPU accelerated)
- Avoid animating layout properties
- HeartRipple WebGL has requestAnimationFrame budget

---

## 9. Mobile Considerations

### Breakpoints

| Name | Width | Layout Changes |
|------|-------|----------------|
| Mobile | < 640px | Single column, larger tap targets |
| Tablet | 640-1024px | 2 column playlist grid |
| Desktop | > 1024px | 3 column grid, centered content |

### Touch Targets

- Minimum 44x44px touch targets
- Color picker circles: 56px on mobile
- Playlist cards: full-width tap area

### Safe Areas

- Account for notches (env(safe-area-inset-*))
- Step indicator at bottom with padding

---

## 10. Accessibility Requirements

### Keyboard Navigation

- Tab through all interactive elements
- Enter/Space to activate buttons and checkboxes
- Arrow keys for color picker (optional enhancement)

### Screen Reader

- Announce step changes with live region
- Progress updates announced periodically (not every %)
- Descriptive labels on color options ("Rose theme, warm pink tones")

### Focus Management

- Auto-focus first interactive element on step change
- Trap focus in modal-like steps (none currently)
- Visible focus indicators (2px ring)
