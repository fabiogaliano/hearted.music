# Task 15 — Tests & verification

**Plan:** §14 (§14.1–§14.8), §13.2 steps 16–17 · **Status:** [x]

## Goal

The consolidated test checklist for the feature. In practice each suite is written
alongside its implementation task, but they're tracked here so coverage is visible
in one place. Tests go in `tests/` or `__tests__/` (per project conventions) and
run via `bun run test` (Vitest). The feature isn't done until the full suite and
typecheck pass.

## Test suites

### §14.1 — Shared rule tests (Task 03, 05, 06, 08)

- [ ] Lowercase-without-trim normalization; valid + invalid example tables (§14.1)
- [ ] `isReservedHandle` after successful format validation
- [ ] Stable failure precedence (`@help`→`contains_at_sign`, `help.`→`trailing_period`, `.help`→`leading_period`, `foo..`→`consecutive_periods`, `foo .`→`invalid_chars`, `.help.`→`leading_period`)
- [ ] `contains_at_sign` for `@` anywhere
- [ ] Onboarding-step helpers (`compareOnboardingSteps`, `isOnboardingStepBefore`, prev/next, `getNextOnboardingStep("plan-selection")==="complete"`, etc.)
- [ ] `SAVEABLE_ONBOARDING_STEP_VALUES` excludes `complete`, includes both walkthroughs; `SAVEABLE_ONBOARDING_STEPS.safeParse("complete")` fails
- [ ] `clearsSyncPhaseJobIds` (incl. `claim-handle`→true, pre-sync→false)
- [ ] `sessionMode` categorizes `claim-handle` as `"steps"`; missing handle collapses pre-completion later tokens to `claim-handle` but `onboarding_completed_at` stays authoritative → `complete`
- [ ] `step-resolver` route mapping: unfinished→`/onboarding`, `song-walkthrough`→`/liked-songs`, `match-walkthrough`→`/match`, `complete`→`/dashboard`

### §14.2 — Passive prefill tests (Task 03)

- [ ] `Fábio Galiano`→`fabio_galiano`; punctuation→`_` collapse; edge underscore trim; 30-char truncation; empty→blank; existing `account.handle` wins over prefill

### §14.3 — Profanity tests (Task 03)

- [ ] Plain blocked words; `.`/`_` separator-obfuscated forms; non-profane examples pass under built-in behavior

### §14.4 — Server contract tests (Task 09, 10)

- [ ] `checkHandleAvailability`: `available`, self-owned exact match (skips reserved/profanity/taken), `empty`, `contains_at_sign`, `invalid_chars` (whitespace), `taken`, `reserved`, `profanity`, `already_owned` recovery, `error`
- [ ] `claimHandleAndAdvance`: success uses fresh `ownedHandle` (not stale context); format precedence; reserved only after format + grandfathered self-owned; `empty`; first-claim-from-earlier-step→`not_ready`; canonicalize premature later step (incl. `complete`-without-timestamp)→`flag-playlists` + clear `phase_job_ids`; invalid/unknown token→`not_ready`; same-handle re-entry from `claim-handle`→advance; same-handle bypass reserved/profanity; same-handle after later step keeps later payload; whitespace→`invalid_chars` before `already_owned`; pre-RPC mismatch→`already_owned`; RPC `already_owned`/`not_ready` row mapping; `taken` on race; malformed/missing RPC data throws; non-`23505` throws
- [ ] `markOnboardingComplete`: `plan-selection`+handle→`completed_now` (session `complete`); stale/earlier→`not_ready` (no complete); handle-less later-step row collapsed to `claim-handle`→`not_ready`; already-complete→`already_complete` (no rerun); operational throws; post-mutation reconstruction not from stale middleware handle

### §14.5 — RPC / DB integration tests (Task 02)

- [ ] First claim writes both tables; `welcome`/`pick-color`/`install-extension`/`syncing`→`not_ready`; `pick-demo-song`→`claimed` + rewrite to `flag-playlists` + clear `phase_job_ids`; `complete`-without-timestamp→same; completion-stamped + missing handle→`claimed` + preserve timestamp + no step rewrite; invalid/unknown token→`not_ready`
- [ ] Same-handle rerun on `claim-handle`→`claimed` idempotent; same-handle rerun after `pick-demo-song`→`claimed`, step unchanged; different handle→`already_owned`
- [ ] Unique index on canonical `handle`; DB rejects uppercase/whitespace/leading-trailing/consecutive-period writes; concurrent cross-account claims → exactly one wins; missing `user_preferences`/`account` row → raise + rollback

### §14.6 — Component tests (Task 11)

- [ ] All `ClaimHandleStep` behaviors in §14.6 (seed mount variants, actionable-only gating across every non-actionable state, owned/edited-away, inline messages, debounce, overlapping-request isolation, retry + focus return, `readOnly`-during-submit, late-result suppression, `not_ready`/`already_owned`/`claimed` cache-patch + navigation, preview visibility, a11y wiring, native-Enter submit)

### §14.7 — Guard, navigation-hook & settings tests (Task 06, 08, 10, 12)

- [ ] `useOnboardingNavigation()` `transitioned`/`transition_failed` (no internal toast); per-step failure copy for Welcome/PickColor/InstallExtension/FlagPlaylists; sync→`claim-handle` (no router-state `syncStats`); `SyncingStep` failure copy + no auto-retry
- [ ] Handle-less pinning to `claim-handle` over later tokens; completion-stamped stays `complete`; `getOnboardingSession()`/`getOnboardingData()` agree
- [ ] `/onboarding` skip-ahead uses helper semantics; devtools prev/next + `complete`→`markOnboardingComplete()` + walkthrough-without-`demo_song_id` fails + rewind clears timestamp
- [ ] `saveOnboardingStep` rejects `complete` + walkthrough-without-`demo_song_id`; `PickDemoSongStep` first-entry via `commitDemoSongAndEnterWalkthrough`
- [ ] `PlanSelectionStep` patches cache + `resolveSession()` (no hardcoded `/dashboard`); analytics only on `completed_now`; `not_ready` navigates without toast
- [ ] Post-claim: guard allows `flag-playlists`; Settings/sidebar/Dashboard show `@handle` without reload; Settings/sidebar/Dashboard don't fall back to `display_name`/`email`; stale same-handle re-entry doesn't rewind

### §14.8 — Public `@handle` route tests (Task 13)

- [ ] Resolves without auth; mixed-case redirects to lowercase; completed owner→coming-soon page; not-yet-complete→`notFound()`; live only after completion; null `imageUrl` degrades (initials from handle); no `display_name` line; missing handle→`notFound()`; lookup failure throws (not coerced to `notFound()`); no `/settings` or `/login` redirect; loader calls `getPublicHandleIdentity` (not admin query); only `handle`+`image_url` exposed with `image_url`→`imageUrl` mapping

## Final verification (§13.2 steps 16–17)

- [ ] `bun run test`
- [ ] `bun run typecheck`

## Dependencies

Every implementation task. Written incrementally alongside each.
