# S1-07 · Subscription Lifecycle RPCs

## Goal

Implement `activate_subscription`, `deactivate_subscription`, and `update_subscription_state`.

## Why

These RPCs manage the subscription lifecycle state on `account_billing`. The billing service calls them from webhook handlers for subscription creation, renewal, cancellation, payment failure, and deletion. Queue reprioritization is wired into each.

## Depends on

- S1-01 (core tables)
- S1-10 (reprioritize RPC — called as final step; if not yet available, wire the call site)

## Blocks

- Phase 4 (billing service subscription handlers)

## Scope

### `activate_subscription`
- Sets `plan`, `stripe_subscription_id`, `stripe_customer_id`, `subscription_status = 'active'`, `subscription_period_end`
- Sets `unlimited_access_source = 'subscription'`
- Calls `reprioritize_pending_jobs_for_account` as final step

### `deactivate_subscription`
- Reverts `plan` to `'free'`
- Clears `unlimited_access_source` when current source is `subscription`
- Does NOT restore previously converted pack value
- Calls `reprioritize_pending_jobs_for_account` as final step

### `update_subscription_state`
- Updates `subscription_status`, `subscription_period_end`, `cancel_at_period_end`
- Does NOT change `plan` or `unlimited_access_source`
- Used for: `invoice.payment_failed`, `customer.subscription.updated`, renewal period-end refresh
- Calls `reprioritize_pending_jobs_for_account` as final step

All: `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- Conversion RPCs (S1-08)
- Unlimited period reversal (S1-09)
- TypeScript wrappers or bridge handlers

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_subscription_lifecycle_rpcs.sql` |

## Constraints / decisions to honor

- `deactivate_subscription` must NOT clear `unlimited_access_source` when source is `self_hosted`
- Normal subscription end does NOT restore converted pack value
- `update_subscription_state` does not modify `unlimited_access_source` — it only updates lifecycle fields
- `cancel_at_period_end` is needed for correct UI state
- All three call `reprioritize_pending_jobs_for_account` as their final step

## Acceptance criteria

- [ ] `activate_subscription` sets all fields correctly including `unlimited_access_source = 'subscription'`
- [ ] `deactivate_subscription` reverts to free and clears `subscription`-sourced unlimited access
- [ ] `deactivate_subscription` preserves `self_hosted` unlimited access on a self-hosted account
- [ ] `update_subscription_state` updates lifecycle fields without touching plan or access source
- [ ] `reprioritize_pending_jobs_for_account` called in all three RPCs
- [ ] All RPCs are idempotent (safe to call with same state twice)

## Verification

- SQL tests: activate, deactivate (subscription vs self_hosted), cancel/uncancel, past_due transition
- `supabase db reset` completes

## Parallelization notes

- Can run in parallel with S1-05, S1-06, S1-08

## Suggested PR title

`feat(billing): subscription lifecycle RPCs — activate, deactivate, update_state`
