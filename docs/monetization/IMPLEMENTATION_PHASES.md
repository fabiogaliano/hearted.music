# Monetization Implementation Phases

> This plan reorganizes the monetization work into implementation dependencies, not source-doc sections. The goal is to create a clean branch/PR/parallel-work spine for `v1_hearted/` and `v1_hearted_brand/`.
>
> Source of truth:
> - `docs/MONETIZATION_V2_PLAN.md`
> - `docs/monetization/CURRENT_STATE_AUDIT.md`
> - `docs/monetization/TERMINOLOGY.md`
> - `docs/monetization/DECISIONS.md`

## Recommended execution order

| Order | Phase | Depends on | Serial vs parallel | Why it comes here |
| --- | --- | --- | --- | --- |
| 1 | Billing contracts and bootstrap foundation | Docs only | Mostly serial | Creates the schema, RPC, env, provisioning, and domain boundaries every later phase needs. |
| 2 | Shared entitlement contracts | Phase 1 | Serial | Freezes the shared app/SQL contracts before multiple teams touch workflows, loaders, and UI. |
| 3 | Entitlement enforcement in workflows and read models | Phase 2 | Partially parallel inside the phase | Removes the current value-leak risk and makes the app safe before hosted checkout exists. |
| 4 | Hosted billing service and bridge integration | Phases 1–3 | Partially parallel inside the phase | Stripe integration should target already-stable schema, RPCs, bridge events, and app change contracts. |
| 5 | Onboarding monetization path | Phases 3–4 | Partially parallel with Phase 6 after bridge contracts land | Fresh-user monetization depends on safe entitlement behavior and working checkout/activation flows. |
| 6 | Post-onboarding monetization UX | Phases 3–4 | Partially parallel with Phase 5 | In-app paywalls, pack selection, and subscription management should build on the same stable billing primitives. |
| 7 | Hardening and launch validation | Phases 1–6 | Mostly serial | Final correctness pass for races, refunds, replay protection, and operational readiness. |

## Serial vs partially parallel

- **Serial spine:** Phases **1 → 2 → 3** should be treated as the non-negotiable dependency chain.
- **First major split point:** After **Phase 2** lands, workflow, read-model, and UI consumers can all build against the same entitlement contracts.
- **Second major split point:** After **Phase 4** lands its bridge and checkout contracts, **Phase 5** and **Phase 6** can run in parallel on separate branches.
- **Do not reorder:** Provider-enabled purchase surfaces should **not** ship before Phase 3. The current repo leaks paid value through ungated read models and ungated Phase B/C processing; that must be fixed first.

## Sequencing changes vs the original monetization plan

The source plan's delivery phases are directionally right, but implementation should make these sequencing rules explicit:

1. **Shared-contract work needs its own phase.**
   - `BillingState`, `SongDisplayState`, queue-band mapping, control-plane change variants, bridge event shapes, and billing-aware selector contracts should be frozen before parallel implementation starts.
2. **Entitlement-safe reads and workflow gating must land before hosted billing UX.**
   - Today the repo exposes `song_analysis` and match data without entitlement checks and runs all enrichment stages unconditionally. Checkout and paywall work should not outrun enforcement.
3. **Provider-disabled / self-hosted behavior should land early, not late.**
   - `BILLING_ENABLED=false` is the fastest way to validate the app-side entitlement model before the Stripe path is finished.
4. **Onboarding and post-onboarding UX should split after bridge contracts exist.**
   - They share billing primitives, but they do not need to block each other once checkout/portal/activation plumbing is stable.

---

## Phase 1 — Billing contracts and bootstrap foundation

### Goal
Create the durable billing foundation in `v1_hearted/`: schema, RPCs, env flags, account provisioning, and billing domain boundaries.

### Why this phase exists
Nothing else has a stable target until the repo has canonical billing facts and write paths. This phase creates the contracts that later phases can depend on without re-litigating names, ownership, or deployment-mode behavior.

### Inputs / dependencies
- `docs/MONETIZATION_V2_PLAN.md`
- `docs/monetization/TERMINOLOGY.md`
- `docs/monetization/DECISIONS.md`
- Current repo state from `docs/monetization/CURRENT_STATE_AUDIT.md`

### Outputs
- Billing schema migrations for:
  - `account_billing`
  - `account_song_unlock`
  - `pack_credit_lot`
  - `subscription_credit_conversion`
  - `subscription_credit_conversion_allocation`
  - `credit_transaction`
  - `billing_webhook_event`
  - `billing_activation`
  - `billing_bridge_event`
- `song_analysis` measurement columns
- RLS + service-role-only access for new tables
- Billing RPCs with pinned `search_path = public`
- New `src/lib/domains/billing/` boundary with at least the core read/write modules scaffolded
- `BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`, `QUARTERLY_PLAN_ENABLED` added to config
- Account provisioning that always creates `account_billing`, and provisions `self_hosted` unlimited access when `BILLING_ENABLED=false`
- Reset/reseed/dev bootstrap updated for the new billing state
- Regenerated Supabase types

### Key touchpoints
- `supabase/migrations/*`
- `src/lib/domains/billing/*` *(new)*
- `src/env.ts`
- `.env.example`
- `src/lib/data/database.types.ts`
- `src/lib/domains/library/accounts/queries.ts`
- `src/lib/workflows/library-processing/devtools/reset.ts`
- `src/lib/workflows/library-processing/devtools/reseed.ts`
- `scripts/reset-onboarding.ts`

### Risks
- Locking in the wrong RPC signatures and table semantics too early
- Accidentally treating a missing billing row as a valid mode signal
- Forgetting `search_path` hardening or RLS on new RPC/table work
- Test/dev reset paths becoming incomplete once billing tables exist

### What can be parallelized within the phase
After the schema and naming contract is agreed, these tracks can split:
- schema + RPC implementation
- TS billing domain scaffolding
- env/config wiring
- account bootstrap and devtools updates
- generated type refresh and compile-fix pass

### Exit criteria
- Fresh account creation always results in an `account_billing` row
- `BILLING_ENABLED=false` accounts receive explicit `self_hosted` unlimited access
- Billing RPC names and table names match the source docs
- DB types regenerate cleanly
- Local reset/reseed paths leave billing state consistent

---

## Phase 2 — Shared entitlement contracts

### Goal
Freeze the shared contracts that workflows, loaders, routes, and UI will all consume: entitlement predicate, display-state model, queue-band mapping, and billing-triggered control-plane changes.

### Why this phase exists
This is the main branch-splitting phase. Without it, different implementations will invent different meanings for `locked`, `pending`, queue priority, bridge events, or selector outputs.

### Inputs / dependencies
- Phase 1 complete
- Frozen terminology from `docs/monetization/TERMINOLOGY.md`
- Architecture and workflow invariants from `docs/monetization/DECISIONS.md`

### Outputs
- Canonical app read model for:
  - `BillingPlan`
  - `UnlimitedAccess`
  - `BillingState`
  - `SongDisplayState`
- Subscription-status normalization rules implemented in one place
- One canonical effective-entitlement predicate available to SQL/app consumers
- Queue-band mapping derived from billing state instead of the current hardcoded `low`
- Billing control-plane changes added:
  - `songs_unlocked`
  - `unlimited_activated`
  - `candidate_access_revoked`
- `BillingChanges.*` helpers introduced
- Billing-aware selector contracts finalized:
  - `select_liked_song_ids_needing_enrichment_work`
  - `select_entitled_data_enriched_liked_song_ids`
  - `is_account_song_entitled`
- Stable bridge event shapes for pack fulfillment, unlimited activation, and revocation outcomes

### Key touchpoints
- `src/lib/domains/billing/state.ts`
- `src/lib/domains/billing/offers.ts`
- `src/lib/domains/billing/queries.ts`
- `src/lib/workflows/library-processing/types.ts`
- `src/lib/workflows/library-processing/changes/` *(add `billing.ts`)*
- `src/lib/workflows/library-processing/queue-priority.ts`
- `supabase/migrations/*` for selector/predicate RPCs

### Risks
- TS and SQL implementations drifting on entitlement semantics
- `SongDisplayState` and matching-state rules becoming inconsistent across pages
- Bridge payloads changing after service work starts
- Queue-band rules being duplicated instead of centralized

### What can be parallelized within the phase
This phase is mostly contract-setting, but once the interfaces are agreed, work can split into:
- SQL selector/predicate work
- TS read-model + queue-band work
- control-plane type/helper work
- bridge payload definition work

### Exit criteria
- There is one canonical entitlement predicate, not ad hoc per feature
- `SongDisplayState` is frozen and replaces the old status assumptions
- `resolveQueuePriority()` no longer returns a constant
- Billing change variants and helper names are stable enough for downstream branches
- Selector output shapes are agreed and implemented

---

## Phase 3 — Entitlement enforcement in workflows and read models

### Goal
Make the app billing-safe: Phase B/C only runs for entitled songs, and paid value is only exposed at read time for entitled songs.

### Why this phase exists
This addresses the repo's highest-risk current-state problems:
- all enrichment stages run for all songs today
- `song_analysis` and match data are exposed without entitlement checks
- missing `item_status` is incorrectly treated as `pending` instead of sometimes `locked`

This phase should complete before hosted checkout/paywall work is considered shippable.

### Inputs / dependencies
- Phase 2 shared contracts complete
- Existing workflow touchpoints from `docs/monetization/CURRENT_STATE_AUDIT.md`

### Outputs
- Enrichment pipeline updated to use per-song stage flags
- Content activation stage added as the account-scoped activation boundary
- `item_status` semantics changed from generic pipeline completion to account-visible activation
- Match snapshot refresh candidate selection filters by entitlement
- Billing-aware read models for:
  - liked songs page
  - liked songs stats
  - dashboard stats
  - match previews
  - song suggestions
  - song matches
  - matching session detail
- Locked vs pending/analyzing/analyzed/failed states correctly represented in server and feature types
- Queue-band effects correctly applied to newly created work
- Tests updated or added around selectors, loaders, and workflow behavior

### Key touchpoints
- `src/lib/workflows/enrichment-pipeline/batch.ts`
- `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
- `src/lib/workflows/enrichment-pipeline/progress.ts`
- `src/lib/workflows/enrichment-pipeline/stages/*`
- `src/lib/workflows/match-snapshot-refresh/orchestrator.ts`
- `src/lib/server/liked-songs.functions.ts`
- `src/lib/server/matching.functions.ts`
- `src/lib/server/dashboard.functions.ts`
- `src/features/liked-songs/types.ts`
- `src/features/matching/types.ts`
- SQL RPCs underlying liked-songs and matching loaders

### Risks
- Regressing background processing while introducing stage-level planning
- Accidentally exposing analysis or match output for locked songs through one missed loader
- Misclassifying songs when unlocks are revoked or unlimited lapses
- Progress/accounting bugs if activation and shared stages are not measured consistently

### What can be parallelized within the phase
Once Phase 2 contracts are stable, two main tracks can run in parallel:
- **workflow track:** selectors, orchestrator, activation, candidate refresh
- **read-model track:** liked songs, dashboard, matching, stats, TS state adoption

A smaller third track can handle queue-priority/test coverage.

### Exit criteria
- A locked song does not expose shared analysis text or match output anywhere in the app
- Phase B/C work requires effective entitlement
- `item_status` is written by content activation, not generic pipeline completion
- Match refresh only uses entitled candidates
- Provider-disabled accounts still behave as unlimited through the same entitlement path

---

## Phase 4 — Hosted billing service and bridge integration

### Goal
Connect Stripe-backed billing to the already-safe app foundation without leaking Stripe-specific logic into `v1_hearted/`.

### Why this phase exists
Hosted billing depends on stable schema, RPCs, bridge events, and app-side change handling. Doing it earlier would create churn in both repos and risk building on the wrong app contracts.

### Inputs / dependencies
- Phases 1–3 complete
- Internal offer IDs frozen
- Bridge event payloads frozen

### Outputs
- `v1_hearted_brand/` billing service scaffolded
- Replay-protected HMAC auth for app-to-service and service-to-app calls
- Checkout endpoints for:
  - pack purchase
  - unlimited upgrade
- Portal session endpoint
- Stripe webhook endpoint with idempotent event handling
- Upgrade-conversion reservation/apply/release flows wired
- App-side billing bridge ingress endpoint in `v1_hearted/`
- App-side server functions for checkout and portal bridging
- Hosted test flows for pack purchase and unlimited activation writing canonical billing facts and triggering app-side control-plane changes

### Key touchpoints
- `v1_hearted_brand/` billing server, webhook handlers, deploy config
- `src/lib/server/billing.functions.ts` *(new, or equivalent app-side billing bridge module)*
- app-side billing bridge route/endpoint in `v1_hearted/`
- `src/lib/domains/billing/*`
- `billing_webhook_event` and `billing_bridge_event` tables/RPC consumers

### Risks
- Fresh retries creating duplicate Stripe sessions if `checkout_attempt_id` is mishandled
- Event ordering/idempotency bugs across checkout, invoice, refund, and subscription lifecycle events
- Replayable service calls if timestamp/body-hash validation is incomplete
- Upgrade-conversion reservations getting stuck pending

### What can be parallelized within the phase
After auth and payload contracts are fixed, these tracks can split:
- pack checkout + fulfillment
- unlimited checkout + conversion lifecycle
- portal flow
- webhook/idempotency plumbing
- app-side bridge ingress and server functions

### Exit criteria
- Pack purchase can complete in Stripe test mode and update app billing state idempotently
- Unlimited checkout can reserve/apply/release conversion value correctly
- Bridge calls are authenticated, replay-protected, and idempotent on `stripe_event_id`
- `v1_hearted/` reacts to service-driven billing events through the canonical bridge path only

---

## Phase 5 — Onboarding monetization path

### Goal
Integrate monetization into the first-user experience: showcase value, choose a plan, and translate the choice into real free/pack/unlimited billing primitives.

### Why this phase exists
Onboarding has unique requirements that do not map cleanly to the general in-app purchase flow:
- new step sequencing
- demo/showcase path
- free allocation timing
- provider-disabled auto-skip behavior

It should be built on top of working entitlement enforcement and hosted checkout plumbing.

### Inputs / dependencies
- Phase 3 entitlement-safe reads/workflows complete
- Phase 4 bridge and checkout plumbing complete
- Existing onboarding route/state machine from the current repo

### Outputs
- Onboarding steps expanded to include:
  - `song-showcase`
  - `match-showcase`
  - `plan-selection`
- Dedicated showcase path for demo song and onboarding matching
- `plan-selection` auto-skip when `BILLING_ENABLED=false`
- Free allocation applied on onboarding completion for users who stay free
- Pack/unlimited onboarding branches using the real billing flows
- `ReadyStep` copy updated for free/pack/unlimited semantics
- Post-checkout/polling state for onboarding plan selection

### Key touchpoints
- `src/features/onboarding/Onboarding.tsx`
- `src/features/onboarding/types.ts`
- `src/features/onboarding/components/*`
- `src/lib/server/onboarding.functions.ts`
- `src/lib/domains/library/accounts/preferences-queries.ts`
- `src/routes/_authenticated/onboarding.tsx`
- `src/features/onboarding/components/ReadyStep.tsx`

### Risks
- Mixing demo/showcase state with real unlock state
- Free allocation being granted twice or on the wrong branch
- Onboarding getting blocked on a slow match showcase
- Provider-enabled and provider-disabled paths drifting apart

### What can be parallelized within the phase
After the step contract is settled, these tracks can run in parallel:
- onboarding step/state-machine updates
- showcase UI and matching-path work
- free allocation + completion logic
- checkout success/polling UX

### Exit criteria
- Fresh provider-enabled user can complete onboarding into free, pack, or unlimited states correctly
- Fresh provider-disabled user skips plan selection and enters self-hosted unlimited flow
- Free allocation only occurs for the free branch and uses canonical unlock logic
- Ready-state copy matches actual processing behavior

---

## Phase 6 — Post-onboarding monetization UX

### Goal
Expose the ongoing monetization surfaces users need after onboarding: plan visibility, balance, pack selection, paywall, and subscription management.

### Why this phase exists
Onboarding gets users into the system; this phase makes ongoing monetization usable in the normal product shell. It is deliberately separate from onboarding because the touchpoints and review loops are different.

### Inputs / dependencies
- Phase 3 entitlement-safe app behavior complete
- Phase 4 billing bridge/server functions complete
- Can overlap with Phase 5 once the shared billing contracts are stable

### Outputs
- Billing state loaded into the authenticated shell
- Sidebar shows plan/billing state appropriately
- Provider-enabled balance display where applicable
- Song selection and unlock flow for pack users
- In-app paywall / upgrade CTAs
- Settings/billing section with portal launch in provider-enabled deployments
- Purchase actions hidden/disabled while unlimited is active
- Provider-disabled/self-hosted UI hides checkout/portal entry points while still showing unlimited status if desired

### Key touchpoints
- `src/routes/_authenticated/route.tsx`
- `src/routes/_authenticated/-components/Sidebar.tsx`
- `src/routes/_authenticated/settings.tsx`
- `src/features/settings/SettingsPage.tsx`
- `src/routes/_authenticated/liked-songs.tsx`
- `src/features/liked-songs/*`
- `src/features/dashboard/*` for upgrade entry points if added there
- `src/lib/server/billing.functions.ts` *(or equivalent app-side billing module)*

### Risks
- Stale client cache leaving balance/plan UI out of sync after checkout or unlocks
- Surfacing purchase actions while unlimited is active or in provider-disabled mode
- Pack selection UI drifting from the actual `requestSongUnlock` contract
- UI work assuming old song states instead of the new locked/pending model

### What can be parallelized within the phase
This phase can split cleanly into two branches:
- **shell/account track:** sidebar, route loader, settings/billing, portal launch
- **library commerce track:** pack selection, paywall, unlock confirmations, post-purchase refresh

### Exit criteria
- Provider-enabled users can see plan state, buy packs, unlock songs, and manage subscription
- Unlimited users do not see pack purchase entry points
- Provider-disabled users do not see checkout/portal actions
- Post-purchase UI reflects canonical billing state rather than local optimistic assumptions

---

## Phase 7 — Hardening and launch validation

### Goal
Prove the monetization system is correct under retries, reversals, race conditions, and fresh-account flows.

### Why this phase exists
Monetization bugs are expensive and user-visible. This phase is where the repo moves from “implemented” to “safe to launch.”

### Inputs / dependencies
- Phases 1–6 complete
- Stripe test-mode environment available
- Preprod accounts reset/reseeded as needed

### Outputs
- End-to-end validation for:
  - fresh free onboarding
  - pack purchase and manual unlocks
  - unlimited activation and renewal
  - cancellation and post-period behavior
  - refund/chargeback reversal flows
  - failed payment / `past_due` handling
- Webhook and bridge idempotency verification
- Unlock race-condition validation
- Queue reprioritization validation on all relevant billing mutations
- Cost/measurement instrumentation verified
- Launch checklist and operational runbooks finalized

### Key touchpoints
- `bun run test`
- workflow, server-function, and integration test suites
- Stripe test configuration
- dev reset/reseed scripts
- operational docs/runbooks in docs or project notes

### Risks
- Passing happy-path tests while refund/retry edges remain broken
- Missing one billing mutation that should reprioritize pending jobs
- Test fixtures masking fresh-account/bootstrap bugs
- Hosted and provider-disabled modes diverging late

### What can be parallelized within the phase
- test-matrix execution
- refund/dispute runbook validation
- observability/instrumentation checks
- fresh-account bootstrap validation
- manual Stripe test-mode scripts

### Exit criteria
- Core purchase, activation, revocation, and cancellation flows are validated end to end
- Duplicate webhook/bridge deliveries are safe
- Billing state, queue band, and read-model visibility stay consistent after retries and reversals
- Fresh-account onboarding works in both provider-enabled and provider-disabled deployments

---

## Branching / PR guidance

A good branch strategy is:

1. **Phase 1 as one contract-setting stack**
   - schema/RPCs
   - billing domain/config/bootstrap
2. **Phase 2 as the contract-freeze stack**
   - entitlement/read-model/control-plane interfaces
3. **Phase 3 as two parallel tracks after Phase 2**
   - workflow gating
   - read-model enforcement
4. **Phase 4 as service/bridge tracks after Phase 3**
   - pack flow
   - unlimited flow
   - portal/webhooks/bridge
5. **Phases 5 and 6 as separate product tracks after Phase 4 contracts land**
   - onboarding monetization
   - post-onboarding monetization UX
6. **Phase 7 as integration-only cleanup**

If parallel AI work is used, the safest split point is **after Phase 2**. Before that, too many contracts are still shared and churn-prone.