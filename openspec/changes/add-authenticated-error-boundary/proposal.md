# Add error boundary below `__root` for authenticated routes

> **Status: rough draft / placeholder.** Captures the problem and the leading
> options from the 2026-05-25 prod-readiness audit (item H8). Details, tasks,
> and the spec delta are intentionally thin and will be refined when this is
> picked up.

## Why

The only route-level error boundary in the app is on `__root`
(`src/routes/__root.tsx` — `errorComponent: RootErrorComponent`). Nothing sits
below it. As a result, any error thrown while a logged-in user is on the app —
either in the `_authenticated` layout's `beforeLoad`
(`src/routes/_authenticated/route.tsx`, e.g. `throw billingStateResult.error`)
or while rendering any child route (`match`, `dashboard`, `liked-songs`,
`playlists*`, `settings`, `checkout`) — bubbles all the way to the root
boundary and replaces the entire page with the global "a wrong note" screen.

The blast radius is the whole app, not the thing that actually failed. A
transient failure in one panel takes down the user's entire session view.

## What Changes

> Leading options (decide during refinement):
>
> - **Option A (audit's prescription):** Add an `errorComponent` to
>   `src/routes/_authenticated/route.tsx`, reusing
>   `captureRouteError(error, { route: "_authenticated" })` and the existing
>   themed error styling. Catches both the layout's own `beforeLoad` throw and
>   descendant-route render errors, scoped to the authenticated area. Trade-off:
>   when it fires it replaces the whole `_authenticated` subtree (sidebar/shell
>   disappears in the error state).
> - **Option B (shell-preserving):** Additionally wrap the content `<Outlet />`
>   inside `AuthenticatedShell` in a React error boundary, so a content-area
>   crash keeps the sidebar/nav usable. Does NOT catch the layout's own
>   `beforeLoad` throw (still needs A for that). More code.

Likely scope: at minimum A; consider layering B for content-area resilience.
Reuse the existing Sentry capture + themed fallback rather than introducing a
new error UI.

## Capabilities

### Modified Capabilities

- `ui-infrastructure`: introduce a reusable, scoped route error-boundary
  pattern so error containment is explicit infrastructure rather than relying
  on the single root boundary.

## Affected specs

- `openspec/specs/ui-infrastructure/spec.md` (delta TBD during refinement)

## Notes / open questions

- Should there be a shared route-error fallback component (extracted from
  `RootErrorComponent`) to avoid duplicating the themed error JSX?
- Do we want a "reset on navigation" affordance, or is reload enough?
- Confirm `throw redirect(...)` paths (onboarding/auth guards) are unaffected —
  redirects are not errors and must keep working.
