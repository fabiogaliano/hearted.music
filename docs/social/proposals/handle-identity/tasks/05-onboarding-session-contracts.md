# Task 05 — Onboarding session contracts (domain module)

**Plan:** §6.0, §7.2 items 4–5 & 8–15 (type imports) · **Recommended order:** step 7 · **Status:** [x]

## Goal

Cut a real ownership boundary: move the core onboarding session contracts into a
route-agnostic domain module, and reduce `step-resolver.ts` to thin route-mapping.
This stops the new server/shared modules from importing `src/features/...` and
gives both onboarding loaders one shared session vocabulary.

This is an ownership cut, **not** a soft alias layer — do **not** leave
compatibility re-exports for `OnboardingSession` / `WalkthroughSong` / `sessionMode`
behind in `step-resolver.ts`.

## Checklist

### New domain module `src/lib/domains/library/accounts/onboarding-session.ts`

- [ ] Move `WalkthroughSongAnalysis`, `WalkthroughSong`, `OnboardingSession`, `OnboardingAuthPayload`, `sessionMode(...)` here
- [ ] Add `| { status: "claim-handle" }` to the `OnboardingSession` union
- [ ] Fix `OnboardingAuthPayload` shape: `{ session: OnboardingSession; theme: ThemeColor | null }`
- [ ] May import `ThemeColor` from `src/lib/theme/types`; must **not** own route-path strings or router helpers (no `AllowedPath`, no `resolveSession`)
- [ ] Reference `AnalysisContent` from the lib module created in Task 04

### Slim `src/features/onboarding/step-resolver.ts` to route-mapping only

- [ ] Stop defining/exporting `OnboardingSession`, `WalkthroughSong`, `sessionMode(...)`
- [ ] Import `OnboardingSession` from the new domain module
- [ ] Widen `AllowedPath` to include `"/dashboard"` and export it
- [ ] Keep unfinished non-walkthrough steps (incl. `claim-handle`) resolving to `/onboarding`
- [ ] Change `resolveSession({ status: "complete" })` → `{ allowedPath: "/dashboard" }` (removes the old `complete → /liked-songs` split)
- [ ] Export only `AllowedPath`, `resolveSession`, `isPathAllowed`
- [ ] `resolveSession()` becomes the single navigation authority for onboarding/session redirects

### Repoint type importers (§7.2 items 8–15)

- [ ] `src/routes/_authenticated/route.tsx` — `sessionMode` from domain module
- [ ] `src/routes/_authenticated/match.tsx` — `sessionMode` from domain module
- [ ] `src/features/onboarding/components/PickDemoSongStep.tsx` — `OnboardingAuthPayload` from domain module
- [ ] `src/features/liked-songs/LikedSongsPage.tsx` — `OnboardingSession`, `WalkthroughSong`
- [ ] `src/features/liked-songs/hooks/useLikedSongsCollection.ts` — `WalkthroughSong`
- [ ] `src/features/liked-songs/hooks/useLikedSongsPageData.ts` — `WalkthroughSong`
- [ ] `src/features/matching/WalkthroughMatchContent.tsx` — `WalkthroughSong`
- [ ] `src/__mocks__/onboarding.functions.stub.ts` — import the shared `OnboardingAuthPayload`/`OnboardingSession`/`WalkthroughSong`; stop locally redefining `OnboardingAuthPayload`
- [ ] `src/features/devtools/workflow-panel/DevWorkflowPanel.tsx` — `OnboardingAuthPayload` from domain module (rest of its behavior in Task 08)

## Import-ownership rule after the split

- `onboarding-session.ts` is the **only** source for `OnboardingAuthPayload`, `OnboardingSession`, `WalkthroughSong`, `sessionMode`.
- `step-resolver.ts` is route/path resolution only.
- Non-routing consumers must not import session types from `step-resolver.ts`.

## Dependencies

Task 04 (`AnalysisContent` relocation). Unblocks Tasks 06, 07, 09.

## Related tests

Task 15 → §14.1 (onboarding-session domain + route-mapping behavior).
