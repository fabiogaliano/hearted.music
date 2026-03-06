# Plan: Validate Extension Sync Reachability (Post-Implementation)

## TL;DR
- **Summary:** The core reachability/config fix is already implemented. This plan now focuses on validating the active extension artifact and closing only residual runtime/deployment gaps.
- **Deliverables:** reproducible validation checklist + conditional hardening (only if issue still reproduces)
- **Effort:** Quick
- **Critical Path:** verify loaded extension build/mode → confirm CONNECT origin handshake → confirm sync POST target
- **Test Strategy:** manual onboarding run with service-worker + network verification

## Big Picture Intent

> **When facing unexpected decisions during execution, align with this intent.**

- **Validated State (already in code):**
  - Service worker resolves backend URL from `chrome.storage.local.backendUrl` with URL validation and fallback default.
  - App CONNECT flow sends `window.location.origin` to extension.
  - CONNECT handler persists `backendUrl` with `apiToken`.
  - Manifest allows `localhost` and `127.0.0.1` without port pinning.
  - Production extension build strips local origins from manifest output.
- **Reframed Problem:** If users still see `Backend unreachable` / “Waiting for extension”, the likely cause is stale extension artifact, wrong build mode for environment, or runtime state mismatch — not missing handshake logic.
- **Why This Matters:** If `/api/extension/sync` is not reached, backend cannot persist `phaseJobIds`, and onboarding remains blocked.
- **Primary Driver:** Verify and stabilize transport/runtime state with minimal change.

## Must NOT
- Do not modify `SyncingStep.tsx` progress/waiting UX for this issue.
- Do not add speculative global CORS/server middleware.
- Do not duplicate backend URL config across multiple constants/files.

## Tasks

### Task 1: Validate active runtime path end-to-end
- **Files:**
  - `extension/src/background/service-worker.ts`
  - `src/lib/extension/detect.ts`
  - `src/features/onboarding/components/InstallExtensionStep.tsx`
- **Actions:**
  - Confirm the loaded extension actually contains runtime `backendUrl` resolution and CONNECT storage behavior.
  - Confirm onboarding CONNECT sends current app origin.
  - Confirm sync POST targets the same origin and reaches `/api/extension/sync`.
- **Acceptance criteria:**
  - Service worker log shows `Connected with API token from web app (<current-origin>)`.
  - Network shows successful `POST <current-origin>/api/extension/sync`.
  - Onboarding leaves “Waiting for extension” once jobs are persisted.

### Task 2: Validate build-mode/manifest behavior (dev vs prod)
- **Files:**
  - `extension/src/manifest.json`
  - `extension/scripts/build.ts`
  - `extension/dist/manifest.json` (artifact check)
- **Actions:**
  - Verify dev workflow uses watch build when testing against localhost/127 origins.
  - Verify production build strips local origins and keeps `hearted.app` domains only.
- **Acceptance criteria:**
  - Dev artifact accepts localhost/127 origins across ports.
  - Production artifact excludes localhost/127 origins.

### Task 3: Conditional hardening (only if issue reproduces after Task 1-2)
- **Files:**
  - `extension/src/background/service-worker.ts`
- **Actions:**
  - Add explicit pre-request log of resolved backend URL in `postToBackend(...)`.
  - Ensure stale backend URL cannot survive a successful CONNECT.
- **Acceptance criteria:**
  - Active backend target is visible in logs before sync POST.
  - Repeat CONNECT always re-aligns extension target with current app origin.

## Decisions

**D1: Treat original fix as complete**
Avoid re-implementing handshake/config logic already present in source.

**D2: Prioritize artifact/runtime validation over code churn**
Most remaining failures are expected to be environment-state issues.

**D3: Keep fallback URL for deterministic behavior**
Fallback remains useful if `backendUrl` is absent before first CONNECT.

## Risks

| Risk                                                | Mitigation                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Stale extension install (old service worker bundle) | Reload extension and verify logs originate from current source behavior |
| Local testing with production build artifact        | Use watch/dev build for localhost testing                               |
| Persistent non-config failures (auth/network/token) | Use existing status code + service-worker logs to isolate root cause    |

## Validation Protocol

1. Reload extension from the intended artifact (dev/watch for local testing).
2. Run onboarding and click **allow sync →**.
3. In service-worker console, confirm:
   - `Connected with API token from web app (<current-origin>)`
   - `Backend sync result:` (and no `Backend unreachable`)
4. In network panel, confirm successful `POST /api/extension/sync` to current app origin.
5. Confirm onboarding exits “Waiting for extension” and progresses with job updates.
