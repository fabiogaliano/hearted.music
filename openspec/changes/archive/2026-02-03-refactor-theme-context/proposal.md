# Change: Refactor Theme to Context Pattern

**Status:** ✅ Completed
**Date:** 2026-02-02

## Why

Theme was being prop-drilled through ~45 component instances across the codebase. This created:
- Verbose component signatures (`theme: ThemeConfig` on every component)
- Deep prop threading (5+ levels in some cases)
- Repetitive `theme={theme}` JSX throughout

Since 99% of theme usage is pure passthrough (no transformation), React Context is the appropriate solution.

## What Changes

### Before
```tsx
// Route
<Landing theme={theme} />

// Feature
function Landing({ theme }: { theme: ThemeConfig }) {
  return <SongCard theme={theme} />;
}

// Component
function SongCard({ theme }: { theme: ThemeConfig }) {
  return <AlbumPlaceholder theme={theme} />;
}

// Leaf
function AlbumPlaceholder({ theme }: { theme: ThemeConfig }) {
  return <div style={{ background: theme.surface }} />;
}
```

### After
```tsx
// Route (SOURCE)
useRegisterTheme(theme);
return <Landing />;

// Feature
function Landing() {
  const theme = useTheme();
  return <SongCard />;
}

// Component
function SongCard() {
  const theme = useTheme();
  return <AlbumPlaceholder />;
}

// Leaf
function AlbumPlaceholder() {
  const theme = useTheme();
  return <div style={{ background: theme.surface }} />;
}
```

## API Reference

### `useRegisterTheme(theme: ThemeConfig): void`

**Use in:** Routes and layouts that determine the active theme.

Registers a theme with the provider. Also syncs `--theme-hue` CSS variable to `document.documentElement` for global focus ring styling.

```tsx
// src/routes/_authenticated/route.tsx
const theme = getTheme(themeColor ?? DEFAULT_THEME);
useRegisterTheme(theme);
```

**Current usage locations:**
- `src/routes/__root.tsx` (NotFoundPage)
- `src/routes/index.tsx` (LandingPage)
- `src/routes/_authenticated/route.tsx` (AuthenticatedLayout)

### `useTheme(): ThemeConfig`

**Use in:** Any component that needs theme colors/styling.

Returns the theme registered by the nearest ancestor route.

```tsx
function MyComponent() {
  const theme = useTheme();
  return <div style={{ color: theme.text }} />;
}
```

**Throws:** Error if used outside `ThemeHueProvider`.

### `useThemeWithOverride(themeOverride?: ThemeConfig): ThemeConfig`

**Use in:** Components that accept an optional theme override prop.

Returns the override if provided, otherwise falls back to context theme.

```tsx
interface Props {
  theme?: ThemeConfig; // Optional override
  isDark?: boolean;
}

function SongDetailPanel({ theme: themeOverride, isDark }: Props) {
  const baseTheme = useThemeWithOverride(themeOverride);
  const effectiveTheme = isDark ? createDarkTheme(baseTheme) : baseTheme;
  // ...
}
```

## Decision Tree

```
Creating a new component that uses theme?
│
├─ Is it a ROUTE that loads theme from DB?
│  └─ YES → useRegisterTheme(theme)
│
├─ Does it need an optional theme OVERRIDE?
│  └─ YES → useThemeWithOverride(optionalProp)
│
└─ Otherwise
   └─ useTheme()
```

## Files Modified

| Category | Files |
|----------|-------|
| Provider | `src/lib/theme/ThemeHueProvider.tsx` |
| Routes | `__root.tsx`, `index.tsx`, `route.tsx`, `dashboard.tsx`, `liked-songs.tsx` |
| Landing | `Landing.tsx`, `LandingHero.tsx`, `SongPreviewPanel.tsx` |
| Liked Songs | `LikedSongsPage.tsx`, `SongCard.tsx`, `SongDetailPanel.tsx`, detail/* |
| Dashboard | `Dashboard.tsx`, `ActivityFeed.tsx`, `ActivityItem.tsx`, sections/* |
| Onboarding | `Onboarding.tsx`, all step components |
| UI | `AlbumPlaceholder.tsx`, `CDCase.tsx`, `HeartRipple*`, etc. |
| Tests | `render.tsx` (added ThemeHueProvider wrapper) |

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| `theme={theme}` instances | ~45 | 0 |
| Components with `theme` prop | ~40 | 1 (SongDetailPanel, optional) |
| Lines of prop threading | ~90 | 0 |

## Testing

- ✅ `bun run typecheck` passes
- ✅ `bun run test` - 125 tests pass
- ✅ Manual verification - theme switching works correctly

---

## Phase 2: Performance Optimization

**Status:** ✅ Completed
**Date:** 2026-02-02

### Problem

The initial context implementation used a single context with `{ theme, registerTheme }`:

```tsx
// Before: Single context causes unnecessary re-renders
const ThemeContext = createContext<{ theme: ThemeConfig; registerTheme: (t) => void } | null>(null);
```

This created performance issues:
- **Object identity**: `{ theme, registerTheme }` creates a new object reference every render
- **No memoization**: `registerTheme` was recreated on every render (no `useCallback`)
- **Unnecessary re-renders**: 38 READ-only components re-render when 3 WRITE-only routes change theme

### Solution: Split Context Pattern

Split into two separate contexts with distinct stability characteristics:

| Context | Value | Consumers | Stability |
|---------|-------|-----------|-----------|
| `ThemeDispatchContext` | `registerTheme` function | 3 routes | Never changes (useCallback with []) |
| `ThemeStateContext` | `ThemeConfig` directly | 38 components | Only on theme change |

### Implementation Details

1. **Split contexts**: Separate dispatch (stable) from state (reactive)
2. **useCallback**: `registerTheme` memoized with empty dependency array
3. **Functional setState**: `setTheme((current) => ...)` avoids stale closure without deps
4. **Lazy initial state**: `() => themes[DEFAULT_THEME]` for optimal initialization
5. **displayName**: Added for React DevTools debugging

### Code Changes

```tsx
// After: Split context pattern
const ThemeDispatchContext = createContext<RegisterTheme | null>(null);
ThemeDispatchContext.displayName = "ThemeDispatch";

const ThemeStateContext = createContext<ThemeConfig | null>(null);
ThemeStateContext.displayName = "ThemeState";

const registerTheme = useCallback<RegisterTheme>((newTheme) => {
  setTheme((current) => (current === newTheme ? current : newTheme));
}, []); // Empty deps = stable reference forever
```

### API Unchanged

All 41 consumers continue to work without modification:
- `useRegisterTheme(theme)` - routes (3 usages)
- `useTheme()` - components (38 usages)
- `useThemeWithOverride(prop?)` - special cases (1 usage)
