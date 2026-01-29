# Implementation Tasks

**Status**: ✅ COMPLETE (Retroactive)

## 1. Layout Route Creation

- [x] 1.1 Create `src/routes/_authenticated/route.tsx`
  - Pathless layout route with `_` prefix
  - `beforeLoad` hook calls `requireAuth()`
  - Returns `session` in route context
  - Component renders `<Outlet />`

## 2. Auth Guard Implementation

- [x] 2.1 Create `requireAuth()` function in `src/lib/auth/guards.ts`
  - Gets session from cookies
  - Validates session is not expired
  - Throws redirect to `/` if invalid
  - Returns session object if valid

## 3. Route Migration

- [x] 3.1 Move dashboard route to `_authenticated/dashboard.tsx`
- [x] 3.2 Move onboarding route to `_authenticated/onboarding.tsx`
- [x] 3.3 Update any hardcoded route references

## 4. Session Context Usage

- [x] 4.1 Update dashboard to use `Route.useRouteContext()` for session
- [x] 4.2 Update onboarding to use parent session context
- [x] 4.3 Remove redundant auth checks from child routes

## Validation

- [x] Type check passes
- [x] Unauthenticated users redirected to landing
- [x] Session available in all child route contexts
