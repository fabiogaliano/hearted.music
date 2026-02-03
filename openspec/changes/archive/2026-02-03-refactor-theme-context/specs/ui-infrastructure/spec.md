# UI Infrastructure

Theme management and global UI state.

## ADDED Requirements

### Requirement: Theme Context Provider

The application SHALL provide theme configuration to all components via React Context, eliminating prop drilling.

**Acceptance Criteria:**
- Theme is registered at route level using `useRegisterTheme(theme)`
- Components consume theme using `useTheme()` hook
- Components with optional override use `useThemeWithOverride(prop?)`
- `--theme-hue` CSS variable syncs to `document.documentElement`

#### Scenario: Route registers theme for children

```gherkin
Given a route component that determines the active theme
When the route renders
Then it calls useRegisterTheme(theme) to provide theme to descendants
And the --theme-hue CSS variable is set on document.documentElement
```

#### Scenario: Component consumes theme from context

```gherkin
Given a component that needs theme styling
When the component renders
Then it calls useTheme() to get the current theme
And it uses theme properties for styling (theme.bg, theme.text, etc.)
```

#### Scenario: Component with optional theme override

```gherkin
Given a component that supports dark mode or custom themes
When the component receives an optional theme prop
Then it calls useThemeWithOverride(themeProp)
And it uses the override if provided, otherwise falls back to context
```

### Requirement: Performance-Optimized Context Structure

The theme provider SHALL use split context pattern to minimize unnecessary re-renders.

**Acceptance Criteria:**
- Dispatch context (`ThemeDispatchContext`) holds stable `registerTheme` function
- State context (`ThemeStateContext`) holds `ThemeConfig` value directly
- `registerTheme` is memoized with `useCallback` and empty dependency array
- State updates use functional form `setTheme((current) => ...)` to avoid stale closures
- Both contexts have `displayName` set for React DevTools debugging

#### Scenario: Read-only components do not re-render on dispatch access

```gherkin
Given a component that only reads theme via useTheme()
When another component calls registerTheme(newTheme)
Then the read-only component only re-renders if the theme value actually changes
And it does not re-render due to registerTheme reference changes
```

#### Scenario: Write-only routes have stable dispatch reference

```gherkin
Given a route that calls useRegisterTheme(theme)
When the route re-renders
Then the registerTheme function reference remains stable
And no unnecessary effect re-runs occur due to dispatch changes
```
