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

### Directory Structure (ACTUAL)

```
src/routes/_authenticated/
  route.tsx                        # Auth guard layout (provides session)
  onboarding.tsx                   # Route definition + step search param
  dashboard.tsx                    # Dashboard (redirects to onboarding if incomplete)

src/features/onboarding/
  Onboarding.tsx                   # Main orchestrator component
  types.ts                         # SyncStats, HistoryState extensions
  components/
    WelcomeStep.tsx
    PickColorStep.tsx
    ConnectingStep.tsx
    SyncingStep.tsx
    FlagPlaylistsStep.tsx
    ReadyStep.tsx
    StepContainer.tsx              # Shared layout wrapper
  hooks/
    useOnboardingNavigation.ts     # Step navigation helpers

src/lib/server/
  onboarding.server.ts             # Server functions (sync, preferences)
```

### Why Features Directory?

The implementation evolved to use a feature-based architecture:
- **Separation of concerns**: Route files handle routing, feature folders handle UI
- **Colocation**: Steps, hooks, types, and styles together
- **Reusability**: Components can be used outside the route context if needed
- **Testing**: Easier to test components in isolation

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

## 4. State Synchronization (ACTUAL)

### Four Sources of Truth

1. **URL Search Params**: Current step only (`?step=syncing`)
2. **Router History State**: Ephemeral data (jobIds, librarySummary, syncStats, theme)
3. **Database**: Persistent state (onboarding_step, theme_color, playlist destinations)
4. **React State**: Transient UI state (animations, selections)

### Sync Strategy

```
URL ?step= (navigation source of truth)
  ↓
Route loader reads DB (current saved step, theme, playlists)
  ↓
Validate: URL step vs DB step (prevent skipping ahead)
  ↓
Router state passes ephemeral data between steps
  ↓
Server functions persist important state to DB
```

**Rules:**
1. URL step must not exceed DB saved step (prevents manual URL hacking)
2. Router state carries data forward through the flow
3. Server functions called on "Continue" to persist progress
4. Theme persisted immediately on selection (optimistic)

### Step Progression Guards

| Scenario | Handling |
|----------|----------|
| URL step > DB step | Redirect to DB step (no skipping) |
| URL step = "welcome" but DB step > "welcome" | Auto-resume to DB step |
| No playlists synced | Auto-skip "flag-playlists" → "ready" |
| User manually edits URL | Step validation prevents progression |

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
