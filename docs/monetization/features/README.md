# Monetization Feature Briefs

> Feature-level planning artifacts that sit between [implementation phases](../IMPLEMENTATION_PHASES.md) and PR-sized stories. Each brief defines scope, ownership, dependencies, and downstream story splits.

## Dependency graph

```
01 Billing Schema Foundation
 └─▸ 02 App Billing Domain
      └─▸ 03 Pipeline Gating & Entitlement Enforcement
           └─▸ 04 Billing Service & App Bridge
                ├─▸ 05 Onboarding Monetization    ─┐
                └─▸ 06 Public Billing UI           ─┤ (parallel after 04)
                                                    │
                     07 Hardening & Launch Validation◀┘ (after 01–06)
```

**Serial spine:** 01 → 02 → 03 is non-negotiable. Each defines contracts consumed by everything downstream.

**First split point:** After 03, the app is entitlement-safe. Feature 04 (billing service) can target stable contracts.

**Second split point:** After 04's bridge contracts land, Features 05 (onboarding) and 06 (public UI) can run in parallel on separate branches.

## Feature index

| # | Feature | Why it exists |
|---|---|---|
| [01](./01-billing-schema-foundation.md) | **Billing Schema Foundation** | Creates the database contracts (tables, RPCs, RLS) that every later feature targets. Without canonical billing facts and atomic write paths, nothing has a stable foundation. |
| [02](./02-app-billing-domain.md) | **App Billing Domain** | Establishes the TypeScript billing boundary, shared entitlement types (`BillingState`, `SongDisplayState`), env config, account provisioning, queue-band mapping, and control-plane change variants. Prevents every downstream feature from independently inventing billing semantics. |
| [03](./03-pipeline-gating-and-entitlement-enforcement.md) | **Pipeline Gating & Entitlement Enforcement** | Makes the app billing-safe: Phase B/C only runs for entitled songs, content activation is account-scoped, and every read model filters by entitlement. Addresses the repo's highest-risk current-state problems (ungated processing + value-leaking loaders). Must complete before purchase surfaces are shippable. |
| [04](./04-billing-service-and-bridge.md) | **Billing Service & App Bridge** | Connects Stripe-backed billing to the already-safe app: builds the `v1_hearted_brand/` service (checkout, portal, webhooks) and the authenticated bridge so purchase events trigger canonical control-plane reactions. Ships after enforcement to target stable app contracts. |
| [05](./05-onboarding-monetization.md) | **Onboarding Monetization** | Integrates monetization into the first-user experience: demo showcase, plan selection, free allocation, and per-plan onboarding branches. Has unique sequencing and demo-path requirements that don't map to the general commerce flow. |
| [06](./06-public-billing-ui.md) | **Public Billing UI** | Exposes day-to-day monetization surfaces after onboarding: plan/balance in the shell, song selection for pack users, paywall/upgrade CTAs, and subscription management in settings. Separate from onboarding because the touchpoints, design constraints, and review loops are different. |
| [07](./07-hardening-launch-validation.md) | **Hardening & Launch Validation** | Proves the integrated system is correct under retries, reversals, race conditions, and fresh-account flows. Moves the implementation from "works in happy path" to "safe to launch." |

## Source documents

- [`docs/MONETIZATION_V2_PLAN.md`](../../MONETIZATION_V2_PLAN.md) — canonical target-state plan
- [`docs/monetization/CURRENT_STATE_AUDIT.md`](../CURRENT_STATE_AUDIT.md) — grounded snapshot of current repo state
- [`docs/monetization/TERMINOLOGY.md`](../TERMINOLOGY.md) — frozen naming conventions
- [`docs/monetization/DECISIONS.md`](../DECISIONS.md) — locked invariants
- [`docs/monetization/IMPLEMENTATION_PHASES.md`](../IMPLEMENTATION_PHASES.md) — phase sequencing
