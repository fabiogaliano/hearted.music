# Change: Add Authenticated Route Layout Pattern

**Status**: ✅ IMPLEMENTED (Retroactive Documentation)

## Why

As the application grew to have multiple protected routes (dashboard, onboarding), authentication logic was duplicated across each route. This pattern:

1. **Reduces duplication**: Single auth check in layout, not per-route
2. **Provides session context**: Child routes access session via route context
3. **Follows TanStack conventions**: Pathless layout routes with `_` prefix
4. **Enables clean separation**: Auth guard vs route-specific logic

## What Changed

### New Files Created

| File | Purpose |
|------|---------|
| `src/routes/_authenticated/route.tsx` | Pathless layout with auth guard |
| `src/routes/_authenticated/dashboard.tsx` | Protected dashboard route |
| `src/routes/_authenticated/onboarding.tsx` | Protected onboarding route |

### Implementation Details

```typescript
// src/routes/_authenticated/route.tsx
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    const session = await requireAuth(context)
    return { session }
  },
  component: () => <Outlet />,
})
```

**Key Features:**
- `beforeLoad` hook calls `requireAuth()` - redirects to `/` if no session
- Returns `session` in route context for child routes
- Component simply renders `<Outlet />` (no visual wrapper)
- All routes under `_authenticated/` automatically protected

### How Child Routes Access Session

```typescript
// In any child route
const { session } = Route.useRouteContext()
```

## Impact

- **No breaking changes**: Routes moved from `/dashboard` to `/_authenticated/dashboard` with same public paths
- **Cleaner auth flow**: OAuth callback redirects to `/dashboard`, auth check happens automatically
- **Scalable pattern**: New protected routes just go under `_authenticated/`

## References

- [TanStack Router Layout Routes](https://tanstack.com/router/latest/docs/framework/react/guide/route-trees#layout-routes)
- Related: `add-onboarding-frontend` change
