# Task 11 — `ClaimHandleStep` UX, state machine & copy

**Plan:** §8 (§8.1–§8.9) · **Recommended order:** step 12 · **Status:** [ ]

## Goal

Build `src/features/onboarding/components/ClaimHandleStep.tsx` — a semantic
`<form>` (the exception to the other steps' `useShortcut("enter")` pattern,
because the global keyboard provider ignores shortcuts while focus is in an
`<input>`). Continue is **actionable-only**: it stays disabled unless the current
value is claimable right now.

## Checklist

### Layout & form (§8.1)

- [ ] Standard centered onboarding treatment (closer to `PickColorStep` than `FlagPlaylistsStep`); not full-bleed
- [ ] Real semantic `<form>` with a `type="submit"` button; no global `useShortcut("enter")`

### Copy (§8.2)

- [ ] Heading `Claim your @handle`
- [ ] CTA label `Continue` in every non-submit state; `Saving...` while saving; no separate `Checking...` button label/spinner
- [ ] Static helper block (`claim-handle-helper`): `Enter just the name — we'll add the @ in your public URL. Use letters, numbers, periods, or underscores. Periods can't start, end, or appear twice in a row.`

### Input behavior (§8.3)

- [ ] Visible `<label>` `Handle`; single bare input (no visual `@` prefix)
- [ ] **No** HTML `maxLength` (overlength must stay visible for `too_long`)
- [ ] placeholder `fabio`; `autoFocus`; `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`, `autoComplete="off"`
- [ ] Seed from `claimHandleSeed`: `owned`/`suggested` prefill, `blank` empty
- [ ] Live-lowercase typing; preserve other characters exactly (no slugification/stripping of spaces/`@`/hyphens/overlength)
- [ ] Edited-away owned value → keep editable, disable Continue, render inline `Use @${claimHandleSeed.handle}` restore button
- [ ] During submit: input `readOnly` (not `disabled`) so value stays frozen + focus stays

### Three concepts + gating (§8.4)

- [ ] Track: local format validity, latest server availability result, owned-handle state
- [ ] Empty field → static helper visible, dynamic region empty, Continue disabled (neutral, **not** the `empty` error)
- [ ] Owned-handle state → owned inline status, skip availability, Continue enabled when not submitting
- [ ] Owned seed edited away → owned reminder, Continue disabled, no availability checks; Enter is a no-op
- [ ] `suggested`/`blank`: format-invalid → specific inline error + disabled; locally reserved → `reserved` inline + disabled, no availability; only non-empty + format-valid + not reserved runs availability
- [ ] Continue enables only when: format valid + not locally reserved + latest verdict `available` + not submitting
- [ ] Editing clears the prior verdict immediately → neutral debounce gap (helper visible, dynamic region empty, Continue disabled)
- [ ] `onSubmit` always `preventDefault()` and routes through one explicit submit-state branch (§8.8)

### Availability cadence (§8.5)

- [ ] 250ms debounce via React Query
- [ ] `suggested` + valid + not reserved → immediate mount check; on mount-time `error` keep value visible, show error, hide preview, disable Continue, allow edit/`Check again` recovery
- [ ] `blank` → wait for typing; `owned` → no availability on mount and none for edited alternatives
- [ ] Query key `['onboarding', 'handle-availability', accountId, ownedHandleSnapshot, debouncedHandle]` (`ownedHandleSnapshot` = `claimHandleSeed.handle` for `owned`, else `null`)
- [ ] Query config: `retry: false`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `gcTime: 0`
- [ ] Only the current debounced handle drives UI; stale in-flight results never overwrite current status/CTA
- [ ] Edit-away-then-back forces a fresh live check (no cached verdict reuse); no checks for invalid/reserved values
- [ ] Explicit retry bypasses debounce; unchecked-value submit does **not** bypass debounce

### Inline feedback (§8.6)

- [ ] Two rows: always-visible static helper + separate dynamic status region (single source of truth for feedback)
- [ ] Owned: `Using your current handle.`; owned-edited-away: `Your handle is already @${handle}.` + `Use @${handle}` reset action
- [ ] Reason → copy map (exact strings in §8.6): `empty`, `contains_at_sign`, `invalid_chars`, `leading_period`, `trailing_period`, `consecutive_periods`, `too_long`, `reserved`, `profanity`, `taken`
- [ ] Availability: `Checking availability…` (dynamic region only), `Available.`, error `Couldn't check that handle — try again.` + `Check again`
- [ ] Expected submit failures reuse the inline region (no toast); operational submit failures toast + stay on step
- [ ] `already_owned` (availability- and submit-time) = authoritative recovery branch, not an inline error

### Live preview (§8.7)

- [ ] Show muted full-host preview only for actionable values (owned-equal, or `available`); hide for empty/invalid/reserved/checking/taken/profanity/error/edited-away-owned
- [ ] Label `Public URL`, value `${publicAppOrigin}/@${handle}`, display-only (no anchor/button/copy/keyboard)
- [ ] `publicAppOrigin` from `buildPublicHandleUrl` / shared public config (Task 01), **not** loader data

### Submit path (§8.8)

- [ ] Snapshot the visible value; branch by submit-state (owned-actionable / `available` → claim; edited-away-owned / unchecked / checking / error / blank-invalid-reserved → no-op)
- [ ] Only the real claim branch flips input to `readOnly` + captures the request-owned handle + suspends rechecks
- [ ] Call `claimHandleAndAdvance({ handle })`, then handle each result:
  - [ ] `not_ready` → patch `["auth","onboarding-session"]` only, navigate via `resolveSession()`, no `["auth","session"]` patch, no toast
  - [ ] `already_owned` → patch both `["auth","onboarding-session"]` and `["auth","session"]` (only `account.handle`), navigate immediately, no toast
  - [ ] `claimed` → patch both caches (preserve `session`/`identity`, replace only `account.handle` with returned `ownedHandle`), navigate via `resolveSession()` (`complete` → `/dashboard`)
- [ ] Any on-step outcome restores editability, keeps value, returns focus with caret at end
- [ ] Do **not** call `saveOnboardingStep()`/`goToStep()` after; do **not** hardcode `flag-playlists`

### Accessibility (§8.9)

- [ ] `<form>` + submit button; visible `<label>`; helper + status via `aria-describedby` with stable ids (`claim-handle-helper`, `claim-handle-status`)
- [ ] `aria-live="polite"` only on the dynamic status region
- [ ] Reset/retry actions Tab-reachable + Enter/Space-activatable; focused retry activates retry, not form submit
- [ ] Focus returns to input (caret at end) after reset, after retry settles, and after any on-step submit outcome
- [ ] Disabled button state reflects real gating

## Dependencies

Tasks 01 (preview URL), 03 (rules), 07 (seed/`accountId`), 08 (`STEP_CONFIG`),
09 (`checkHandleAvailability`/`claimHandleAndAdvance`).

## Related tests

Task 15 → §14.6 (component tests).
