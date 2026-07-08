# Task 08 — Onboarding step machine + wiring

**Plan:** §7.1, §7.2 (items 1–2, 6–7, 17, 19–21), §7.4 · **Recommended order:** step 11 (runs **before** Task 09 despite the higher §13.2 number — see index dependency notes) · **Status:** [x]

## Goal

Insert `claim-handle` into the onboarding machine and centralize order logic in
`onboarding-steps.ts`. Inserting the step into the tuple alone is not enough:
`SyncingStep` must navigate to it, the mutation boundary must make `complete`
unrepresentable, and the order helpers (`isOnboardingStepBefore`, etc.) added here
are consumed by Tasks 09 and 10.

Excludes: `markOnboardingComplete` + `PlanSelectionStep` (Task 10), §7.2 item 18
(`account-handle.functions.ts`, Task 09), and the type-only import repoints
already done in Task 05.

## Checklist

### `onboarding-steps.ts` (§7.1)

- [ ] Insert `claim-handle` between `syncing` and `flag-playlists` in `ONBOARDING_STEP_VALUES`
- [ ] Export `SAVEABLE_ONBOARDING_STEP_VALUES` (excludes `complete`; **includes** `song-walkthrough`/`match-walkthrough`) + `type SaveableOnboardingStep`
- [ ] Add helpers: `compareOnboardingSteps`, `isOnboardingStepBefore`, `getPreviousOnboardingStep`, `getNextOnboardingStep`, `clearsSyncPhaseJobIds`
- [ ] `clearsSyncPhaseJobIds`: `false` for `welcome`/`pick-color`/`install-extension`/`syncing`; `true` for `claim-handle` and every later step
- [ ] `complete` stays in the ordered tuple (for prev/next reasoning) but is not a `saveOnboardingStep` target

### `preferences-queries.ts` (§7.2 item 2)

- [ ] Keep `ONBOARDING_STEPS = z.enum(ONBOARDING_STEP_VALUES)` for persisted-row parsing
- [ ] Add `SAVEABLE_ONBOARDING_STEPS = z.enum(SAVEABLE_ONBOARDING_STEP_VALUES)`; re-export `type SaveableOnboardingStep`
- [ ] Narrow `updateOnboardingStep(accountId, step)` to `step: SaveableOnboardingStep`

### Route guards & devtools (§7.2 items 6–7, §7.4)

- [ ] `src/routes/_authenticated/onboarding.tsx` — replace raw `ONBOARDING_STEP_VALUES.indexOf(...)` with `compareOnboardingSteps(...)`; keep the no-playlists skip a separate explicit branch
- [ ] `DevWorkflowPanel.tsx` — use `getPreviousOnboardingStep`/`getNextOnboardingStep`; when navigation targets `complete`, call `markOnboardingComplete()` (Task 10) and navigate via `resolveSession()` (not `saveOnboardingStep({ step: "complete" })`); non-complete targets keep using `saveOnboardingStep(...)`; reading rewind from `complete` may still use `saveOnboardingStep(...)`

### `onboarding.functions.ts` mutation boundary (§7.2 item 17)

- [ ] Import session contracts from the domain module + `deriveAuthPayloadFromPrefs`/`loadOnboardingSession` from the server session module; stop owning `OnboardingAuthPayload`
- [ ] Replace `stepInputSchema` with `saveableStepInputSchema = z.object({ step: SAVEABLE_ONBOARDING_STEPS })`
- [ ] `saveOnboardingStep` accepts only `{ step: SaveableOnboardingStep }` (rejects `complete`)
- [ ] `saveOnboardingStep` loads current prefs when `data.step` is `song-walkthrough`/`match-walkthrough`; if `demo_song_id` is null, throw and write nothing
- [ ] Thread `context.account.handle` through `getOnboardingSession()`; keep it as the wrapper over the shared loader
- [ ] `loadOnboardingData(...)` reuses `deriveAuthPayloadFromPrefs(...)` (no second step-only path) — coordinate with Task 07
- [ ] Replace the hardcoded sync-cleanup branch with `clearsSyncPhaseJobIds(data.step)` (so `claim-handle` clears `phase_job_ids`)
- [ ] `commitDemoSongAndEnterWalkthrough(...)` remains the only valid first-entry into `song-walkthrough`

### `Onboarding.tsx` step registration (§7.2 item 19)

- [ ] Add `STEP_CONFIG["claim-handle"]` rendering `<ClaimHandleStep accountId={ctx.accountId} claimHandleSeed={ctx.claimHandleSeed} />`
- [ ] Do **not** mark it `hideIndicator` or `fullBleed` — the progress indicator intentionally gains one visible step
- [ ] `ClaimHandleStep` prop contract is `{ accountId: string; claimHandleSeed: ClaimHandleSeed }` — **not** a flattened `initialHandle`

### `SyncingStep.tsx` (§7.2 item 20)

- [ ] Change sync-complete navigation to `goToStep("claim-handle")` (not `flag-playlists`)
- [ ] Do **not** pass `syncStats` through router state
- [ ] Await the `goToStep(...)` result; on `{ status: "transition_failed" }` keep the completed view, toast `Sync finished, but we couldn't continue. Refresh to keep going.`, and do not auto-retry until refresh/remount

### syncStats removal + nav-hook result contract (§7.2 item 21)

- [ ] Remove router-state `syncStats` threading from `WelcomeStep`, `PickColorStep`, `InstallExtensionStep`, `FlagPlaylistsStep`, `useOnboardingNavigation.ts`, `useStepNavigation.ts`, `types.ts`
- [ ] Stop reading `location.state?.syncStats`; remove from the `HistoryState` augmentation
- [ ] Narrow `goToStep(step, ...)` and `navigateTo(nextStep)` to `SaveableOnboardingStep`
- [ ] Export `OnboardingStepTransitionResult = { status: "transitioned" } | { status: "transition_failed" }`
- [ ] `goToStep(...)` returns `Promise<OnboardingStepTransitionResult>`; on operational failure, log + return `transition_failed` — do **not** throw or toast inside the hook
- [ ] `useStepNavigation()` keeps resultless async behavior but also narrows its target to `SaveableOnboardingStep`
- [ ] Add per-step failure copy + state-reset for `WelcomeStep` / `PickColorStep` / `InstallExtensionStep` / `FlagPlaylistsStep` (exact toast strings in §7.2 item 21)

## Dependencies

Tasks 05, 06, 07. Provides order helpers to Tasks 09, 10. Task 10 supplies
`markOnboardingComplete` referenced by `DevWorkflowPanel`.

## Related tests

Task 15 → §14.1 (helpers/tuples), §14.7 (guard, navigation-hook, mutation boundary).
