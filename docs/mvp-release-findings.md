# MVP Release Findings

## Bottom line
The app looks **close to MVP**. The main remaining work is **release hardening and UX polish**, not major product build-out.

## What I agree with from Claude

### Real launch blockers
- **Repo health is not green**
  - `bun run test` fails (3 extension tests)
  - `bun run typecheck` fails
  - `bun run check` reports many lint/a11y issues
- **No normal CI pipeline**
  - Only Claude workflows exist in `.github/workflows`
- **No error monitoring / telemetry found**
  - No visible Sentry / PostHog / Datadog-style instrumentation
- **Billing is not launch-proven**
  - Billing domain is substantial, but paid launch still needs end-to-end validation
- **`PLAN.md` is stale**
  - It documents an extension reachability validation flow that appears already implemented

### Important ops issue
- **Worker deployment mismatch**
  - `Dockerfile.worker` healthcheck calls `localhost:3001/health`
  - `src/worker/config.ts` defaults `WORKER_HEALTH_PORT` to `3002`

## Where Claude was off / overstated

### Billing bridge hardening is already present
`src/routes/api/billing-bridge.ts` and `src/lib/domains/billing/hmac.ts` already implement:
- HMAC verification
- timestamp freshness window
- body-hash signing
- idempotency / claim flow
- duplicate and in-progress handling

So this is **not** a current blocker.

### Locked-state billing UI is not missing
There is real UI wiring for locked/unlock/paywall flows:
- `src/features/liked-songs/LikedSongsPage.tsx`
- `src/features/liked-songs/components/SongSelectionBar.tsx`
- `src/features/liked-songs/components/UnlockConfirmDialog.tsx`
- `src/features/billing/components/PaywallCTA.tsx`

Still needs polish and real-world validation, but it is not absent.

### Extension store issue is more about listing readiness than manifest alone
`extension/src/manifest.json` does not contain store-listing legal/support metadata, but Chrome Web Store readiness is mostly a **listing + legal/contact prep** problem, not just a manifest problem.

### `refactor-env-to-varlock` is hardening, not MVP-critical
The OpenSpec change is still open, but I would treat it as **posture improvement**, not a must-fix before first MVP users.

## Recommended launch posture

### Must fix before launch
1. Get repo health green
   - tests
   - typecheck
   - key lint/a11y issues in user-facing code
2. Fix worker health/deploy mismatch
3. Add basic error monitoring
4. Run one full staging rehearsal:
   - auth
   - onboarding
   - extension connect
   - sync
   - worker processing
   - matching
   - Spotify write-back

### Safer MVP scope
- Launch as **free / provider-disabled first** (`BILLING_ENABLED=false`)
- Delay full paid launch until billing path is staging-proven

## UI/UX priorities

### 1. Onboarding / extension flow
Main risk area: `src/features/onboarding/components/InstallExtensionStep.tsx`

Improve:
- clearer step states
- retry / re-check actions
- better failure copy
- clearer explanation of what happens after “allow sync”

### 2. Navigation consistency
Some signed-in empty states send users to `/` instead of the authenticated home.
Example:
- `src/features/matching/components/MatchingEmptyState.tsx`

Prefer sending signed-in users to `/dashboard`.

### 3. Empty / loading / recovery states
Polish the functional-but-bare states in:
- `src/features/playlists/PlaylistsScreen.tsx`
- dashboard no-results cases
- onboarding stalled-sync cases

### 4. Responsive pass
The authenticated shell is desktop-first:
- `src/routes/_authenticated/-components/Sidebar.tsx`

At minimum, verify laptop and smaller-screen usability.

### 5. Billing UX consistency
Example issue:
- `src/features/settings/components/BillingSection.tsx` shows **“Buy song packs”** with no visible action

If launching free-first, hide or simplify unfinished paid affordances.

### 6. Accessibility cleanup
Biome reports real user-facing issues. Prioritize:
- buttons / semantics
- keyboard interactions
- focus behavior
- SVG accessibility

## Suggested priority order
1. Repo health
2. Worker deploy correctness
3. Error monitoring
4. End-to-end staging validation
5. Onboarding / extension UX
6. Empty-state / navigation polish
7. Responsive + accessibility pass
8. Billing UX cleanup
