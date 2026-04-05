# S2-01 · Billing Domain Types + Env Config

## Goal

Create the `src/lib/domains/billing/` module with canonical types (`BillingState`, `BillingPlan`, `UnlimitedAccess`, `SongDisplayState`) and add billing env vars to the app config.

## Why

Every downstream consumer (workflows, loaders, routes, UI) needs a single authoritative set of billing types and deployment-mode flags. Creating these first prevents parallel work from independently inventing billing state shapes.

## Depends on

- S1-12 (generated types available)

## Blocks

- S2-02 (getBillingState needs these types)
- S2-04 (queue-band mapping needs BillingState)
- S2-05 (control-plane changes reference these types)
- All Phase 3 stories (consume SongDisplayState)
- All Phase 6 stories (consume BillingState)

## Scope

### `src/lib/domains/billing/state.ts`
- `BillingPlan` type: `"free" | "quarterly" | "yearly"`
- `UnlimitedAccess` discriminated union: `{ kind: "none" } | { kind: "subscription" } | { kind: "self_hosted" }`
- `BillingState` interface with: `plan`, `creditBalance`, `subscriptionStatus` (normalized), `cancelAtPeriodEnd`, `unlimitedAccess`, `queueBand`
- `SongDisplayState` type: `"locked" | "pending" | "analyzing" | "analyzed" | "failed"`
- Subscription-status normalization mapping (Stripe statuses → app `"none" | "active" | "ending" | "past_due"`)
- `hasUnlimitedAccess` derived helper

### `src/lib/domains/billing/offers.ts`
- Internal offer ID constants: `SONG_PACK_500`, `UNLIMITED_QUARTERLY`, `UNLIMITED_YEARLY`
- No Stripe price IDs

### Env config
- Add to `src/env.ts`: `BILLING_ENABLED` (boolean, default false), `BILLING_SERVICE_URL` (string, optional), `BILLING_SHARED_SECRET` (string, optional), `QUARTERLY_PLAN_ENABLED` (boolean, default false)
- Add entries to `.env.example`

## Out of scope

- `queries.ts`, `unlocks.ts` (S2-02, later stories)
- Account provisioning (S2-03)
- Queue-band resolution logic (S2-04)
- Control-plane types (S2-05)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing domain | `src/lib/domains/billing/state.ts` *(new)*, `src/lib/domains/billing/offers.ts` *(new)* |
| Env | `src/env.ts`, `.env.example` |

## Constraints / decisions to honor

- All type names and values are frozen per TERMINOLOGY.md
- `subscriptionStatus` in BillingState uses normalized values, not raw Stripe values
- No barrel exports (per project convention)
- `BILLING_SERVICE_URL` and `BILLING_SHARED_SECRET` are optional (only needed when `BILLING_ENABLED=true`)

## Acceptance criteria

- [ ] `BillingState`, `BillingPlan`, `UnlimitedAccess`, `SongDisplayState` exported from `state.ts`
- [ ] Subscription-status normalization covers all Stripe statuses in the CHECK constraint
- [ ] Offer IDs exported from `offers.ts` — no Stripe price IDs
- [ ] Env vars validated by Zod schema in `src/env.ts`
- [ ] `.env.example` updated
- [ ] Project compiles

## Verification

- `tsc --noEmit` passes
- Env validation works with `BILLING_ENABLED=false` and without billing-specific vars

## Parallelization notes

- First Phase 2 story; blocks most subsequent Phase 2 work
- Quick to implement — pure types and config

## Suggested PR title

`feat(billing): billing domain types, SongDisplayState, and env config`
