# UI Infrastructure

Theme management, semantic surface layering, and shared UI primitives.

## ADDED Requirements

### Requirement: Semantic Theme Surface Layers

The UI theme system SHALL expose semantic CSS utilities for common visual layers so components choose backgrounds by role rather than by raw token names.

**Acceptance Criteria:**
- `theme-page-bg` maps to `var(--t-bg)`.
- `theme-dialog-bg` maps to `var(--t-bg)`.
- `theme-panel-bg` maps to `var(--t-surface)`.
- `theme-panel-dim-bg` maps to `var(--t-surface-dim)`.
- `theme-action-surface` renders a bordered action surface using `var(--t-surface)`, `var(--t-border)`, and `var(--t-text)`.
- `theme-dialog-panel` renders the standard dialog panel background and border using the dialog/base layer.
- Existing raw utility names MAY remain as compatibility aliases, but new or modified production UI SHOULD use semantic layer utilities.

#### Scenario: Action surface contrasts on dialog background
- **GIVEN** a dialog panel that contains an external or surface-style action
- **WHEN** the dialog panel uses `theme-dialog-panel` or `theme-dialog-bg`
- **THEN** the action using `theme-action-surface` SHALL sit on a different background layer
- **AND** its border SHALL remain visible against the parent surface

#### Scenario: Raised panel remains distinct from page background
- **GIVEN** a card, preview, or raised panel placed on a page background
- **WHEN** it uses `theme-panel-bg`
- **THEN** it SHALL render with `var(--t-surface)`
- **AND** it SHALL visually lift from the page/base background

#### Scenario: Nested preview uses dim layer
- **GIVEN** a non-interactive preview nested inside a dialog or panel
- **WHEN** the preview should be quieter than the primary content
- **THEN** it SHALL use `theme-panel-dim-bg`
- **AND** it SHALL not compete visually with primary actions

### Requirement: Standard Dialog Surface Hierarchy

Dialogs SHALL use the dialog/base layer by default so nested panels and surface-style actions retain contrast.

**Acceptance Criteria:**
- Dialog content containers that may contain `theme-action-surface` controls use `theme-dialog-panel`.
- `dialog-content` remains animation-only and SHALL NOT imply a background layer.
- Nested examples, mirrors, previews, and cards inside dialogs use `theme-panel-bg` or `theme-panel-dim-bg` when they need a raised or quieter surface.
- Dialogs MAY intentionally use `theme-panel-bg` only when they do not contain same-token action surfaces and the choice is documented by the local design context.

#### Scenario: Reconnect action inside onboarding dialog
- **GIVEN** the onboarding playlist-description dialog is in reconnect-required state
- **WHEN** it renders the reconnect Spotify action
- **THEN** the dialog container SHALL use the dialog/base layer
- **AND** the reconnect action SHALL use the action-surface layer
- **AND** the action SHALL visually match the external CTA hierarchy shown in Ladle

#### Scenario: Dialog animation is independent of surface choice
- **GIVEN** a dialog container uses `dialog-content`
- **WHEN** its background utility changes between semantic layers
- **THEN** the mount animation SHALL remain unchanged
- **AND** the surface utility SHALL be responsible only for color/border styling

### Requirement: Shared External Action Link

Outbound pill CTAs SHALL be rendered through a shared external action link component rather than duplicated class strings.

**Acceptance Criteria:**
- A shared component exists at `src/components/ui/ExternalActionLink.tsx`.
- The component renders an anchor with the standard external CTA visual treatment.
- The component uses `theme-action-surface` for its background, text, border, and hover-border behavior.
- The component renders a trailing external-link glyph.
- The component supports click and auxiliary-click handlers for reconnect/auth flows.
- External links open safely with `target="_blank"` and `rel="noopener noreferrer"` unless a call site explicitly opts out for an internal link.

#### Scenario: Spotify reconnect link uses shared external action
- **GIVEN** Spotify reconnect is required
- **WHEN** `SpotifyReconnectLink` renders
- **THEN** it SHALL delegate visual rendering to the shared external action link
- **AND** it SHALL preserve reconnect arming on click and auxiliary click

#### Scenario: Install extension links share CTA treatment
- **GIVEN** the install-extension onboarding step renders Chrome Web Store or Spotify login links
- **WHEN** those links are displayed
- **THEN** they SHALL use the shared external action link treatment
- **AND** their appearance SHALL match the external CTAs in the design-system story

### Requirement: Surface Variant Uses Semantic Action Surface

The shared `Button` component's surface variant SHALL use the semantic action-surface utility.

**Acceptance Criteria:**
- `Button variant="surface"` uses `theme-action-surface`.
- `Button variant="surface"` does not depend directly on the legacy `hover-border-brighten` class.
- Button actions that need the external/surface CTA look use `variant="surface"`; anchor actions use `ExternalActionLink`.

#### Scenario: Surface button remains visually compatible
- **GIVEN** a surface button rendered on a page or dialog background
- **WHEN** the user compares it to the existing external CTA style
- **THEN** it SHALL retain the same background, border, text color, hover-border, and active-scale behavior

### Requirement: Surface Context Visual Coverage

The design-system stories SHALL show action surfaces in supported and unsupported parent surface contexts.

**Acceptance Criteria:**
- Ladle includes a surface hierarchy story or section.
- The story renders base/dialog, panel, and dim preview contexts.
- The story shows the approved action treatment for each context.
- The story documents that action surfaces are designed for page/base or dialog/base backgrounds, not same-token panel nesting by default.
- The story can be reviewed under all configured theme colors.

#### Scenario: Same-surface nesting is visible in story review
- **GIVEN** a developer changes action-surface or dialog background styling
- **WHEN** they open the surface hierarchy story
- **THEN** they can see whether action surfaces still contrast on page and dialog backgrounds
- **AND** they can see whether same-surface panel nesting has been intentionally avoided or handled with an alternate treatment

## MODIFIED Requirements

### Requirement: Theme Context Provider

The application SHALL provide active theme configuration to all components via React Context and render-time CSS custom properties.

**Acceptance Criteria:**
- The root and authenticated theme providers render a `ThemeHueProvider` with the active `ThemeConfig`.
- Components consume theme using `useTheme()`.
- Components with optional overrides use `useThemeWithOverride(prop?)`.
- `ThemeHueProvider` emits `--theme-hue` and all `--t-*` CSS custom properties during render.
- Theme CSS utilities read from those `--t-*` properties rather than hard-coded palette values.

#### Scenario: Provider emits theme variables during render
- **GIVEN** a route renders inside `ThemeHueProvider`
- **WHEN** the active theme is known
- **THEN** the provider SHALL emit `--theme-hue`, `--t-bg`, `--t-surface`, `--t-surface-dim`, `--t-border`, `--t-text`, `--t-text-muted`, `--t-text-on-primary`, `--t-primary`, and `--t-primary-hover`
- **AND** semantic surface utilities SHALL resolve against those emitted values

#### Scenario: Component consumes theme from context
- **GIVEN** a component that needs theme configuration in JavaScript
- **WHEN** the component renders inside `ThemeHueProvider`
- **THEN** it SHALL call `useTheme()` to get the current theme
- **AND** it SHALL avoid duplicating theme constants outside the theme modules

#### Scenario: Component with optional theme override
- **GIVEN** a component that supports a custom theme override
- **WHEN** the component receives an optional theme prop
- **THEN** it SHALL call `useThemeWithOverride(themeProp)`
- **AND** it SHALL use the override if provided, otherwise fall back to context
