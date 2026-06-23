# Orchestration decision log — add-authenticated-error-boundary

Records decisions made during execution that were not fully spelled out in the
OpenSpec change (`openspec/changes/add-authenticated-error-boundary/`).

Branch: `feat/authenticated-error-boundary` (worktree off `feat/crisp-metadata-hard-filters`).

## Orchestrator-level decisions

- **Option A chosen** (route-level `errorComponent` on `_authenticated`), not A+B.
  Rationale: per the change's own audit note Option A is the prescription; the
  user scoped this run to "#1" with Option A. No `<Outlet />` wrapping (Option B)
  in this run.
- **Visual review surfaced via a dedicated Ladle story only.** Per user request:
  add the error fallback to Ladle in one specific review story; do not modify any
  existing stories.

## Implementation decisions

<!-- Subagents append below: decision + one-line rationale -->
- **1.2 — Extracted shared component** (`src/components/RouteErrorFallback.tsx`): `RootErrorComponent`'s error UI had zero root-specific concerns — every element (`roseThemeStyle`, `fonts`, `Button`, `Link`) is a reusable import — so extraction was clean. Both root and authenticated boundaries now render `<RouteErrorFallback />`. The extracted file also exports `roseThemeStyle` so `NotFoundPage` in `__root.tsx` can continue using it.
- **Fallback file location**: `src/components/RouteErrorFallback.tsx` (next to other UI components, not under `routes/` — it is presentational infrastructure, not a route-level module).
- **`__root.tsx` cleanup**: Removed the inline `ThemeTokenStyle` type alias and `roseThemeStyle` constant (moved to `RouteErrorFallback.tsx`); removed `CSSProperties` import; removed `Button` import (now inside the shared component). `roseThemeStyle` re-imported from the new file for `NotFoundPage`.
- **Test depth — unit-level**: A full TanStack Start router integration test is impractical in jsdom (server functions cannot run there). Instead the `AuthenticatedErrorComponent` is tested in isolation via RTL, mirroring the existing Sidebar idiom. The redirect-guard invariant is documented via a design-assertion test that checks the `isRedirect` marker TanStack Router uses to distinguish redirects from errors.
- **Test file location**: `src/routes/_authenticated/__tests__/AuthenticatedErrorComponent.test.tsx`, co-located with the existing `playlists.$playlistRef.test.ts` in that directory.
- **Ladle story**: `src/stories/RouteErrorFallback.stories.tsx` under `Infrastructure/RouteErrorFallback`. No existing story files were modified.
- **Post-review nit fixes**: Added `console.error("[AuthenticatedError]", error)` before `captureRouteError` in `AuthenticatedErrorComponent` to match the `RootErrorComponent` dev-console pattern; replaced a restate-code comment in the test file with a single WHY sentence explaining the inline re-implementation.
