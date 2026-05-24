## Why

The current theme utilities make the visual layer relationship implicit. `hover-border-brighten` always renders a pill on `--t-surface`, but its name only describes hover behavior. When that action is placed inside a `theme-surface-bg` container, the button and container share the same background token and the action loses contrast.

This was visible in the onboarding playlist-description reconnect state:

- Ladle external CTAs looked correct because they were `--t-surface` actions on a `--t-bg` story background.
- The onboarding reconnect CTA looked wrong because it was the same `--t-surface` action inside a `--t-surface` dialog panel.
- Changing the action to `--t-bg` made the button darker, proving the missing concept is not "button color" but parent/child surface hierarchy.

The codebase already has the raw theme tokens (`bg`, `surface`, `surfaceDim`) and CSS utilities (`theme-bg`, `theme-surface-bg`, `hover-border-brighten`), but it does not encode where each should be used. This change makes the hierarchy explicit and gives shared UI primitives/stories a single place to enforce it.

## What Changes

- Add semantic surface utilities that describe role, not implementation token:
  - page/base background
  - dialog background
  - raised panel/card background
  - dimmed nested preview background
  - bordered action surface
- Deprecate direct production use of `hover-border-brighten` in favor of a named action-surface utility and shared external-link component.
- Standardize modal/dialog panels that can contain bordered surface actions to use the dialog/base layer, so surface actions retain contrast.
- Introduce a shared external action link component for outbound CTAs such as Chrome Web Store, Spotify login, and reconnect actions.
- Add Ladle coverage that displays action surfaces in every supported parent context so layer regressions are visible before app routes are checked.
- Migrate the known affected dialogs and external CTA call sites incrementally without changing product behavior.

## Capabilities

### Modified Capabilities

- `ui-infrastructure`: theme surface layering, action surfaces, dialog panels, and visual-system stories become explicit infrastructure rather than repeated hand-rolled class combinations.

## Affected specs

- `openspec/specs/ui-infrastructure/spec.md`

No onboarding capability semantics change. The onboarding reconnect case is the motivating UI regression, but the durable contract belongs in UI infrastructure.

## Impact

- **Design system:** clarifies that `--t-bg` is the base/dialog layer and `--t-surface` is the raised/action layer.
- **App files likely touched:**
  - `src/styles.css`
  - `src/components/ui/Button.tsx`
  - `src/components/ui/ExternalActionLink.tsx` (new)
  - `src/lib/extension/SpotifyReconnectLink.tsx`
  - `src/features/onboarding/components/InstallExtensionStep.tsx`
  - `src/features/onboarding/components/OnboardingDescriptionDialog.tsx`
  - `src/features/playlists/components/DescriptionRoleDialog.tsx`
  - `src/features/playlists/components/DescriptionConflictDialog.tsx`
  - `src/features/liked-songs/components/UnlockConfirmDialog.tsx`
  - `src/features/billing/components/PaywallCTA.tsx`
  - `src/features/playlists/components/PlaylistDetailView.tsx`
  - `src/lib/keyboard/ShortcutsHelpModal.tsx`
  - `.ladle/components.tsx`
  - `src/stories/BorderRadiusShowcase.stories.tsx`
  - `src/stories/ButtonComparison.stories.tsx`
- **Tests/stories:** add focused component tests for class contracts where practical, and add Ladle surface-context stories for visual review.
- **Migration strategy:** keep existing low-level utilities as compatibility aliases during the migration; require new/modified UI code to use semantic names or shared components.
- **Verification:** visual review in Ladle for all theme colors, focused React tests for shared components, `bun run typecheck`, `bun run test`, and `openspec validate clarify-ui-surface-layering --strict --no-interactive`.
