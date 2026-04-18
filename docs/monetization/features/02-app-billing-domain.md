# Feature: App Billing Domain

> **Feature 02** · Dependency: Feature 01 (Billing Schema Foundation)

## Goal

Establish the TypeScript billing domain boundary, shared entitlement contracts, env configuration, account provisioning, and devtools support so that all downstream features have a stable app-layer foundation to build on.

## Why it exists

The repo currently has no billing domain, no env flags, no billing-aware account creation, and no shared types for entitlement or display state. This feature creates the single authoritative app-layer surface that workflows, loaders, routes, and UI all consume — preventing every downstream feature from independently inventing entitlement semantics, queue-band rules, or billing state shapes.

## What this feature owns

- **`src/lib/domains/billing/` module** with at least:
  - `state.ts` — `BillingState`, `BillingPlan`, `UnlimitedAccess`, `SongDisplayState` types; subscription-status normalization; derived access flags
  - `queries.ts` — Supabase reads/writes for billing state
  - `unlocks.ts` — unlock request orchestration (calls RPCs, emits control-plane changes)
  - `offers.ts` — internal offer IDs (`song_pack_500`, `unlimited_quarterly`, `unlimited_yearly`); no Stripe price IDs
- **Env configuration**: `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED` added to `src/env.ts` and `.env.example`
- **Account provisioning**: `createAccountForBetterAuthUser()` always creates `account_billing` row; when `BILLING_ENABLED=false`, provisions `unlimited_access_source = 'self_hosted'`
- **Billing state server function**: `getBillingState(accountId)` with self-healing row creation fallback
- **Queue-band mapping**: `resolveQueuePriority()` derives band from `BillingState` instead of returning constant `"low"`
- **Control-plane integration**:
  - `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked` variants added to `LibraryProcessingChange`
  - `BillingChanges.*` helper group (`songsUnlocked`, `unlimitedActivated`, `candidateAccessRevoked`)
  - `src/lib/workflows/library-processing/changes/billing.ts`
- **Bridge event type definitions**: stable payload shapes for pack fulfillment, unlimited activation, and revocation outcomes
- **Devtools updates**: reset/reseed paths updated for billing tables; `reset.ts` clears billing state; `reseed.ts` seeds billing state for test accounts; `scripts/reset-onboarding.ts` handles billing state reset

## What it does not own

- SQL schema and RPCs — Feature 01
- Enrichment orchestrator or selector integration — Feature 03
- Read-model / loader enforcement — Feature 03
- Billing service HTTP endpoints or Stripe SDK — Feature 04
- Bridge ingress endpoint (HTTP route) — Feature 04
- Onboarding step changes — Feature 05
- Any user-facing UI — Features 05–06

## Likely touchpoints

| Area | Files |
|---|---|
| Billing domain | `src/lib/domains/billing/*` *(new)* |
| Env | `src/env.ts`, `.env.example` |
| Account provisioning | `src/lib/domains/library/accounts/queries.ts` |
| Auth hook | `src/lib/platform/auth/auth.server.ts` (or wherever `databaseHooks.user.create.after` lives) |
| Control-plane types | `src/lib/workflows/library-processing/types.ts` |
| Change helpers | `src/lib/workflows/library-processing/changes/billing.ts` *(new)* |
| Queue priority | `src/lib/workflows/library-processing/queue-priority.ts` |
| Devtools | `src/lib/workflows/library-processing/devtools/reset.ts`, `reseed.ts` |
| Scripts | `scripts/reset-onboarding.ts` |

## Dependencies

- Feature 01 complete (tables, RPCs, generated types)
- Frozen terminology from `docs/monetization/TERMINOLOGY.md`
- Frozen invariants from `docs/monetization/DECISIONS.md`

## Downstream stories this feature should split into

1. **Billing domain module scaffold** — create `src/lib/domains/billing/` with `state.ts`, `queries.ts`, `unlocks.ts`, `offers.ts`; implement `BillingState`, `BillingPlan`, `UnlimitedAccess`, `SongDisplayState` types and subscription-status normalization
2. **Env config** — add `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED` to `src/env.ts` and `.env.example`
3. **Account provisioning** — ensure `account_billing` row on account creation; `self_hosted` unlimited access when `BILLING_ENABLED=false`; self-healing fallback in `getBillingState`
4. **`getBillingState` server function** — reads `account_billing`, normalizes subscription status, returns `BillingState`
5. **Queue-band implementation** — `resolveQueuePriority()` reads billing state; maps free/pack/quarterly/yearly/self_hosted to correct band
6. **Control-plane change variants** — add `songs_unlocked`, `unlimited_activated`, `candidate_access_revoked` to `LibraryProcessingChange`; implement `BillingChanges.*` helpers in `changes/billing.ts`
7. **Bridge event payload types** — define stable typed shapes for pack fulfillment, unlimited activation, and revocation bridge calls
8. **Devtools reset/reseed** — update `reset.ts`, `reseed.ts`, `reset-onboarding.ts` for billing tables; seed test accounts with appropriate billing state

## Definition of done

- `src/lib/domains/billing/` exists with exported types and query functions
- `BillingState` type is the single canonical billing read model used by all consumers
- `SongDisplayState` replaces `UIAnalysisStatus` as the canonical song-state type
- Fresh account creation always produces an `account_billing` row
- `BILLING_ENABLED=false` accounts receive `self_hosted` unlimited access at provisioning
- `resolveQueuePriority()` returns correct band for all billing states (not constant `"low"`)
- `LibraryProcessingChange` union includes all three billing variants
- Devtools reset leaves billing state consistent; reseed creates valid billing test data
- Project compiles and existing tests pass
