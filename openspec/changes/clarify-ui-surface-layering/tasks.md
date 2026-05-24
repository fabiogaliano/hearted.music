## 1. Semantic surface utilities

- [ ] 1.1 Update `src/styles.css` with semantic utilities: `theme-page-bg`, `theme-dialog-bg`, `theme-panel-bg`, `theme-panel-dim-bg`, `theme-action-surface`, and `theme-dialog-panel`.
- [ ] 1.2 Keep `theme-bg`, `theme-surface-bg`, `theme-surface-dim-bg`, and `hover-border-brighten` as compatibility aliases; add comments marking new production usage should prefer semantic utilities.
- [ ] 1.3 Update `src/components/ui/Button.tsx` so `variant="surface"` uses `theme-action-surface` instead of `hover-border-brighten`.
- [ ] 1.4 Add or update a focused Button test/story assertion proving the surface variant emits the semantic action-surface class.

## 2. Shared external action link

- [ ] 2.1 Create `src/components/ui/ExternalActionLink.tsx` with safe external-link defaults, trailing `↗`, font/class escape hatches, and click/aux-click handler support.
- [ ] 2.2 Add focused tests for `ExternalActionLink` covering href, target/rel defaults, label rendering, arrow rendering, and click/aux-click forwarding.
- [ ] 2.3 Refactor `src/lib/extension/SpotifyReconnectLink.tsx` to render `ExternalActionLink` while preserving `armReconnectOnActivation(SPOTIFY_LOGIN_URL)` for click and aux-click.
- [ ] 2.4 Update `src/lib/extension/__tests__/useSpotifyReconnectState.test.ts` or `src/lib/extension/__tests__/spotify-reconnect.test.ts` coverage if reconnect-link behavior needs a new assertion after the refactor.

## 3. External CTA call-site migration

- [ ] 3.1 Replace hand-rolled Chrome Web Store and Spotify login anchors in `src/features/onboarding/components/InstallExtensionStep.tsx` with `ExternalActionLink`.
- [ ] 3.2 Replace the hand-rolled external reconnect/install anchor in `src/features/playlists/components/PlaylistDetailView.tsx` with `ExternalActionLink` or `SpotifyReconnectLink`, depending on the existing activation semantics.
- [ ] 3.3 Update `src/stories/BorderRadiusShowcase.stories.tsx` and `src/stories/ButtonComparison.stories.tsx` to demonstrate `ExternalActionLink` / `theme-action-surface` instead of duplicating production class strings.
- [ ] 3.4 Search production code under `src/` for `hover-border-brighten`; migrate remaining production call sites or document why a low-level utility use remains intentional.

## 4. Dialog layer migration

- [ ] 4.1 Update `src/features/onboarding/components/OnboardingDescriptionDialog.tsx` to use `theme-dialog-panel dialog-content` for the dialog container and `theme-panel-dim-bg` / `theme-panel-bg` for nested preview areas where appropriate.
- [ ] 4.2 Update `src/features/playlists/components/DescriptionRoleDialog.tsx` to use `theme-dialog-panel dialog-content`; keep its non-interactive mirror on a nested panel/dim layer.
- [ ] 4.3 Review and migrate `src/features/playlists/components/DescriptionConflictDialog.tsx` to `theme-dialog-panel dialog-content` unless the visual review shows a primary/secondary-only dialog intentionally needs a raised panel.
- [ ] 4.4 Review and migrate `src/features/liked-songs/components/UnlockConfirmDialog.tsx` to `theme-dialog-panel dialog-content`; verify primary and secondary actions retain contrast.
- [ ] 4.5 Review and migrate the pack confirmation dialog in `src/features/billing/components/PaywallCTA.tsx` to `theme-dialog-panel dialog-content`; verify nested `PaywallCTA` card buttons still read as selectable cards.
- [ ] 4.6 Keep `src/lib/keyboard/ShortcutsHelpModal.tsx` visually aligned by replacing raw `theme-bg theme-border-color ... border` combinations with `theme-dialog-panel` where layout allows.

## 5. Surface-context Ladle coverage

- [ ] 5.1 Add a surface hierarchy section to `src/stories/BorderRadiusShowcase.stories.tsx` or create `src/stories/SurfaceHierarchy.stories.tsx` showing action surfaces on page, dialog, panel, and dim preview contexts.
- [ ] 5.2 In the story, explicitly mark action-surface-on-panel as unsupported or show the approved alternate action treatment (`primary`, `secondary`, or `ghost`).
- [ ] 5.3 Verify the story under all Ladle theme controls: blue, green, rose, and lavender.
- [ ] 5.4 Add a short story description documenting the hierarchy: base/dialog = `--t-bg`, panel/action = `--t-surface`, nested dim = `--t-surface-dim`.

## 6. Documentation and cleanup

- [ ] 6.1 Update comments in `src/styles.css` near the theme utilities to document the layer hierarchy and when to use each semantic utility.
- [ ] 6.2 If a UI/design-system doc exists by implementation time, add the hierarchy there; otherwise keep the documentation in CSS comments and Ladle story descriptions.
- [ ] 6.3 Ensure no barrel exports are introduced; import `ExternalActionLink` directly from `src/components/ui/ExternalActionLink.tsx`.
- [ ] 6.4 Remove any temporary class overrides added only to fix the onboarding reconnect button color once the dialog/action hierarchy handles it.

## 7. Verification

- [ ] 7.1 Run focused tests for `ExternalActionLink`, `SpotifyReconnectLink`, and `Button` surface variant.
- [ ] 7.2 Run `bun run typecheck`.
- [ ] 7.3 Run `bun run test`.
- [ ] 7.4 Run `openspec validate clarify-ui-surface-layering --strict --no-interactive`.
- [ ] 7.5 Perform manual visual review of:
  - `/onboarding?step=flag-playlists` reconnect-required description dialog
  - Ladle border-radius/surface hierarchy stories
  - install-extension external CTAs
  - playlist detail reconnect/install prompt
  - billing/paywall confirmation dialogs
