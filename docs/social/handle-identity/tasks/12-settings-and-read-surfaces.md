# Task 12 — Settings & authenticated read surfaces

**Plan:** §9.1, §9.2, §9.4 · **Recommended order:** step 14 · **Status:** [x]

## Goal

Switch the current authenticated identity surfaces to handle-first display, and
add the one client-side cache patch that lets a freshly claimed handle show
without a reload. The handle is the displayed identity on every surface touched
here; `display_name` stays a passive prefill source, never the public-facing name.

If `handle` is unexpectedly null, every surface stays non-throwing and **omits**
the identity line — no fallback to `display_name`/`email`, no placeholder.

## Checklist

### Settings (§9.1)

- [ ] `src/routes/_authenticated/settings.tsx` passes `handle`, `email`, `imageUrl` into `SettingsPage`
- [ ] `SettingsPage` treats `@handle` as the primary identity line; `email` as the secondary line
- [ ] `UserAvatar` called as `name={handle}` / `imageUrl={imageUrl}` (initials derive from handle)
- [ ] Do **not** render `account.display_name` as the displayed name
- [ ] Null handle → omit the `@handle` line, stay non-throwing
- [ ] Add **no** edit control, copy button, rename UI, or confirm dialog

### Sidebar + Dashboard (§9.2)

- [ ] Rename props away from provider-name semantics: `SidebarProps.handle`, `DashboardProps.handle`, `DashboardHeaderProps.handle` (exact shapes in §9.2)
- [ ] `src/routes/_authenticated/route.tsx` passes `account?.handle ?? null` into `Sidebar`
- [ ] `src/routes/_authenticated/dashboard.tsx` passes `account?.handle ?? null` into `Dashboard`
- [ ] `Sidebar` calls `UserAvatar` as `name={handle}` / `imageUrl={userImageUrl}` and renders `@${handle}` as its identity line
- [ ] `DashboardHeader` renders `@${handle}` as the heading
- [ ] Null handle on any surface → omit identity line/heading, non-throwing, no `display_name`/`email` fallback
- [ ] Update `Sidebar.stories.tsx`, `src/features/dashboard/types.ts`, `src/stories/fixtures/build-fixtures.ts` to the renamed `handle` contract

### Auth/account cache plumbing (§9.4)

- [ ] Confirm `account.handle` flows into authenticated route context after `gen:types` (account queries already `select("*")`)
- [ ] `ClaimHandleStep` patches both `["auth","onboarding-session"]` and `["auth","session"]` after successful claim and after availability-time/submit-time `already_owned` recovery (implemented in Task 11 — verify here it satisfies the Settings/sidebar/Dashboard read path)
- [ ] The `["auth","session"]` patch updates **only** `account.handle` (must not drop `session`/`identity`/other `account` fields)
- [ ] No separate settings-only fetch needed once the patch is in place

## Why the cache patch matters

`/_authenticated/route.tsx` caches `["auth","session"]` for 5 minutes and Settings
reads `account` from that cached route context. Without the patch, same-session
navigation to Settings/sidebar/Dashboard would show a stale `account.handle` until
reload or cache expiry.

## Dependencies

Task 02 (`account.handle` + `gen:types`), Task 11 (the cache patches live in
`ClaimHandleStep`).

## Related tests

Task 15 → §14.7 (Settings/sidebar/Dashboard show `@handle` without reload; no
`display_name`/`email` fallback).
