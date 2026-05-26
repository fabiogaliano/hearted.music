# Tasks

> Placeholder. Refine (and split per the chosen option) when picked up.

## 1. Decide approach

- [ ] 1.1 Choose Option A (route `errorComponent`) vs A+B (also wrap the content `<Outlet />`).
- [ ] 1.2 Decide whether to extract a shared route-error fallback from `RootErrorComponent` in `src/routes/__root.tsx`.

## 2. Implement

- [ ] 2.1 Add `errorComponent` to `src/routes/_authenticated/route.tsx`, calling `captureRouteError(error, { route: "_authenticated" })`.
- [ ] 2.2 (If B) Wrap the content `<Outlet />` in `AuthenticatedShell` with a React error boundary that preserves the sidebar.

## 3. Verify

- [ ] 3.1 Test: a thrown error in a child route renders the scoped boundary, not the root one.
- [ ] 3.2 Test: `throw redirect(...)` guards (onboarding/auth) still redirect and are not caught as errors.
- [ ] 3.3 Confirm Sentry receives the captured route error with `route` context.
