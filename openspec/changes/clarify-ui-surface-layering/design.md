## Context

Current theme infrastructure:

- Theme tokens live in `src/lib/theme/colors.ts` and `src/lib/theme/types.ts`:
  - `bg`
  - `surface`
  - `surfaceDim`
  - `border`
  - `text`
  - `textMuted`
  - `textOnPrimary`
  - `primary`
  - `primaryHover`
- `ThemeHueProvider` emits those values as CSS custom properties in `src/lib/theme/ThemeHueProvider.tsx`.
- Low-level CSS utilities live in `src/styles.css`:
  - `theme-bg` → `var(--t-bg)`
  - `theme-surface-bg` → `var(--t-surface)`
  - `theme-surface-dim-bg` → `var(--t-surface-dim)`
  - `hover-border-brighten` → bordered `var(--t-surface)` action with hover border brighten
- `Button` in `src/components/ui/Button.tsx` exposes `variant="surface"`, but that variant is currently a thin wrapper around `hover-border-brighten`.

Relevant usage found during research:

- Correct action-on-base examples:
  - `src/stories/BorderRadiusShowcase.stories.tsx` external CTAs
  - `src/features/onboarding/components/InstallExtensionStep.tsx` outbound CTAs
  - `src/features/liked-songs/components/LikedSongsHeader.tsx` `Button variant="surface"`
- Dialog/panel surfaces that currently use `theme-surface-bg`:
  - `src/features/playlists/components/DescriptionRoleDialog.tsx`
  - `src/features/liked-songs/components/UnlockConfirmDialog.tsx`
  - `src/features/billing/components/PaywallCTA.tsx`
  - `src/features/playlists/components/DescriptionConflictDialog.tsx`
- Existing base/dialog surface examples:
  - `src/lib/keyboard/ShortcutsHelpModal.tsx` uses `theme-bg`
  - `src/features/onboarding/components/OnboardingDescriptionDialog.tsx` has been locally corrected to `theme-bg`

The underlying bug class is a missing design-system rule: a raised/action surface must not sit directly on another same-token raised surface unless another affordance (primary fill, outline-only, ghost text, nested dim surface, etc.) creates the contrast.

## Goals / Non-Goals

**Goals**

- Make theme layering understandable from class/component names.
- Preserve current color tokens and theme palettes.
- Give dialogs, raised panels, and action surfaces one documented hierarchy.
- Replace repeated external-CTA anchor class strings with a shared component.
- Keep low-level compatibility classes while production code migrates.
- Add visual coverage that makes context-sensitive surface bugs obvious.

**Non-Goals**

- Redesigning the color palettes in `src/lib/theme/colors.ts`.
- Introducing a full modal/focus-trap system.
- Replacing Tailwind utilities or the existing `Button` component.
- Removing every legacy utility in one change.
- Changing onboarding, billing, playlist, or matching business behavior.

## Decisions

### 1. Keep raw theme tokens, add semantic layer utilities

**Decision:** Do not rename the `ThemeConfig` fields or CSS variables. Add semantic CSS utilities in `src/styles.css` that map role names to the existing tokens.

Required utilities:

- `theme-page-bg` → `background: var(--t-bg)`
- `theme-dialog-bg` → `background: var(--t-bg)`
- `theme-panel-bg` → `background: var(--t-surface)`
- `theme-panel-dim-bg` → `background: var(--t-surface-dim)`
- `theme-action-surface` → bordered action surface using `var(--t-surface)`, `var(--t-border)`, and `var(--t-text)`
- `theme-action-surface:hover` → `border-color: var(--t-text-muted)`

`theme-bg`, `theme-surface-bg`, `theme-surface-dim-bg`, and `hover-border-brighten` stay in place as compatibility aliases during migration.

**Rationale:** `bg` and `surface` are still the correct token names. The confusion is usage context. Semantic utilities make usage context visible without creating a breaking theme-token migration.

### 2. Define the layer hierarchy explicitly

**Decision:** The supported default hierarchy is:

1. Page/base/dialog layer: `theme-page-bg` or `theme-dialog-bg` (`--t-bg`)
2. Raised panel/card/action layer: `theme-panel-bg` or `theme-action-surface` (`--t-surface`)
3. Dimmed nested preview/skeleton layer: `theme-panel-dim-bg` (`--t-surface-dim`)

Rules:

- Surface/action controls intended to look like the Ladle external CTAs SHOULD sit on `theme-page-bg` or `theme-dialog-bg`.
- Dialogs that contain `theme-action-surface` controls SHOULD use `theme-dialog-bg`, not `theme-panel-bg`.
- Nested non-interactive examples inside dialogs SHOULD use `theme-panel-bg` or `theme-panel-dim-bg` depending on desired prominence.
- If a CTA must sit inside `theme-panel-bg`, it SHOULD use a different action treatment (`primary`, `secondary`, `ghost`, or a documented nested variant), not `theme-action-surface` by default.

**Rationale:** This exactly matches the visual relationship that worked in Ladle: light action surface on darker base. It also keeps dialogs visually close to pages while allowing their internal previews/cards to lift.

### 3. Make dialog panel styling a named utility, not a remembered combination

**Decision:** Add a `theme-dialog-panel` utility that combines the standard dialog background and border. It does not replace `dialog-content`, which remains animation-only.

Expected mapping:

```css
.theme-dialog-panel {
  background: var(--t-bg);
  border: 1px solid var(--t-border);
}
```

Dialogs then use:

```tsx
className="theme-dialog-panel dialog-content relative ..."
```

instead of repeating:

```tsx
className="theme-bg theme-border-color dialog-content ... border ..."
```

or:

```tsx
className="theme-surface-bg theme-border-color dialog-content ... border ..."
```

**Rationale:** The surface bug happened because every dialog chooses its own background. A named dialog-panel utility makes the design rule hard to miss while avoiding a full modal abstraction.

### 4. Replace hand-rolled external CTA anchors with `ExternalActionLink`

**Decision:** Create `src/components/ui/ExternalActionLink.tsx` as the shared anchor for outbound pill CTAs.

Responsibilities:

- Render an `<a>` with `target="_blank"` and safe `rel` defaults when external.
- Use `theme-action-surface` for visual styling.
- Preserve the existing pill language:
  - `inline-flex`
  - `rounded-full`
  - uppercase/tracking
  - active scale
  - trailing `↗` glyph with muted opacity
- Accept event handlers needed by reconnect flows (`onClick`, `onAuxClick`).
- Accept size/className escape hatches only where existing call sites require them.

Initial consumers:

- `src/lib/extension/SpotifyReconnectLink.tsx`
- `src/features/onboarding/components/InstallExtensionStep.tsx`
- `src/features/playlists/components/PlaylistDetailView.tsx`
- Ladle showcase stories

**Rationale:** The same external CTA class string is duplicated in multiple places. A shared component prevents future drift and gives the design system one place to update arrow spacing, target behavior, and surface classes.

### 5. Keep `Button variant="surface"`, but back it with semantic action-surface styling

**Decision:** Update the `surface` variant in `src/components/ui/Button.tsx` to use `theme-action-surface` rather than `hover-border-brighten`.

The variant remains valid for button actions that intentionally use the external/surface CTA treatment, such as `LikedSongsHeader` unlock action. New production code SHOULD prefer `Button variant="surface"` for button elements and `ExternalActionLink` for anchors.

**Rationale:** The component API is already in place. The bug is not the variant but the opaque class name it uses.

### 6. Add surface-context stories for visual QA

**Decision:** Extend `src/stories/BorderRadiusShowcase.stories.tsx` or add a sibling story that renders the same action patterns in these contexts:

- page/base background
- dialog/base panel
- raised panel/card background
- dim nested preview background

For each theme color in Ladle, visual review should confirm:

- action surface contrasts correctly on page/base and dialog/base backgrounds;
- action surface on raised panel is either absent, marked unsupported, or shown with an alternate treatment;
- dialog panel + nested preview + action hierarchy reads as distinct layers.

**Rationale:** Static stories are the cheapest way to catch this class of bug. The existing story showed only the happy path, so it could not reveal same-surface nesting.

### 7. Migrate in two passes to avoid broad UI churn

**Decision:** Split implementation into compatibility additions first, then call-site migration.

Pass 1:

- Add utilities and component.
- Update `Button variant="surface"` and `SpotifyReconnectLink`.
- Add stories/tests.

Pass 2:

- Migrate dialogs and external links.
- Replace production `hover-border-brighten` class strings with `theme-action-surface` or shared components.
- Leave story-only direct examples where they intentionally demonstrate the low-level utility.

**Rationale:** This keeps the change safe and reviewable. It also avoids changing every visual surface before the new story coverage exists.

## Migration Plan

1. Add semantic utilities to `src/styles.css`, keeping old utilities intact.
2. Add `src/components/ui/ExternalActionLink.tsx` with focused tests if test harness patterns already support simple component rendering.
3. Update `Button` surface variant to `theme-action-surface`.
4. Update `SpotifyReconnectLink` to delegate to `ExternalActionLink` while preserving reconnect arming behavior.
5. Migrate outbound CTA anchors in install extension and playlist detail to `ExternalActionLink`.
6. Add or update Ladle stories to cover surface context matrix.
7. Migrate dialog panel class names to `theme-dialog-panel dialog-content` where the dialog may contain action surfaces or nested previews.
8. Replace nested preview classes with `theme-panel-bg` / `theme-panel-dim-bg` where touched.
9. Search for remaining production `hover-border-brighten`; either migrate, document as intentional, or leave only in story/demo code.
10. Run focused visual review across blue, green, rose, and lavender themes.
11. Run `bun run typecheck`, `bun run test`, and `openspec validate clarify-ui-surface-layering --strict --no-interactive`.

## Testing Strategy

- Unit/component tests:
  - `ExternalActionLink` renders href, target/rel, label, arrow, and forwards activation handlers.
  - `SpotifyReconnectLink` still arms reconnect on click and auxiliary click.
  - `Button variant="surface"` includes the semantic action-surface class.
- Visual/story checks:
  - Ladle surface-context matrix for all themes.
  - Onboarding description reconnect state: action surface on dialog background.
  - Install extension outbound links.
  - Playlist detail reconnect/install prompt.
- Regression search:
  - `hover-border-brighten` should not appear in production call sites except compatibility utility definitions or explicitly documented exceptions.
  - Dialogs using `dialog-content` should not pair with `theme-surface-bg` unless they intentionally avoid surface actions and nested surface ambiguity.

## Open Questions

1. Should `theme-dialog-panel` include padding/max-width defaults, or only color/border?
   - Recommendation: only color/border. Keep layout per dialog.
2. Should legacy utility names get comments marking them deprecated?
   - Recommendation: yes. Keep comments in `src/styles.css` so future edits know which names are compatibility aliases.
3. Should story files import `ExternalActionLink` or keep raw markup for documentation?
   - Recommendation: use `ExternalActionLink` in the primary showcase and keep one low-level utility example only if needed for design-system documentation.
