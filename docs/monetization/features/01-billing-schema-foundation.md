# Feature: Billing Schema Foundation

> **Feature 01** · Dependency: none (first in chain)

## Goal

Create the durable database foundation — tables, RPCs, RLS policies, and measurement columns — that every later monetization feature depends on.

## Why it exists

Nothing in the repo can safely read, write, or enforce billing state until canonical schema and atomic RPCs exist. This feature produces the stable data contracts that the app billing domain, pipeline gating, billing service, and UI features all target. Shipping it first prevents downstream churn on names, column semantics, and RPC signatures.

## What this feature owns

- **Schema migrations** for all new billing tables:
  - `account_billing`
  - `account_song_unlock`
  - `pack_credit_lot`
  - `subscription_credit_conversion`
  - `subscription_credit_conversion_allocation`
  - `credit_transaction`
  - `billing_webhook_event`
  - `billing_activation`
  - `billing_bridge_event`
- **`song_analysis` measurement columns** (`provider`, `input_tokens`, `output_tokens`, `cost_usd`)
- **RLS policies**: enable RLS, deny-all for anon/authenticated, service-role bypass — matching the existing repo pattern
- **Billing RPCs** (all `SECURITY DEFINER`, pinned `search_path = public`):
  - `unlock_songs_for_account`
  - `insert_song_unlocks_without_charge`
  - `activate_unlimited_songs`
  - `grant_credits`
  - `fulfill_pack_purchase`
  - `reverse_pack_entitlement`
  - `reverse_unlimited_period_entitlement`
  - `prepare_subscription_upgrade_conversion`
  - `link_subscription_upgrade_checkout`
  - `release_subscription_upgrade_conversion`
  - `apply_subscription_upgrade_conversion`
  - `reverse_subscription_upgrade_conversion`
  - `activate_subscription`
  - `deactivate_subscription`
  - `update_subscription_state`
  - `reprioritize_pending_jobs_for_account`
- **Billing-aware selector RPCs** (new or replacement):
  - `select_liked_song_ids_needing_enrichment_work` (replaces current pipeline selector)
  - `select_entitled_data_enriched_liked_song_ids` (replaces current match refresh selector)
  - `is_account_song_entitled` (entitlement predicate)
- **Regenerated Supabase types** (`src/lib/data/database.types.ts`)

## What it does not own

- TypeScript billing domain module (`src/lib/domains/billing/*`) — that is Feature 02
- Env config (`BILLING_ENABLED`, etc.) — Feature 02
- Account provisioning hook changes — Feature 02
- Devtools reset/reseed updates — Feature 02
- Enrichment orchestrator or read-model changes — Feature 03
- Stripe integration or webhook handling — Feature 04
- Any UI work — Features 05–06

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/*` (new migration files) |
| Generated types | `src/lib/data/database.types.ts` |

## Dependencies

- Frozen terminology from `docs/monetization/TERMINOLOGY.md`
- Frozen invariants from `docs/monetization/DECISIONS.md`
- Schema and RPC definitions from `docs/MONETIZATION_V2_PLAN.md`

## Downstream stories this feature should split into

1. **Schema migration: core billing tables** — `account_billing`, `account_song_unlock`, `credit_transaction`
2. **Schema migration: pack and conversion tables** — `pack_credit_lot`, `subscription_credit_conversion`, `subscription_credit_conversion_allocation`
3. **Schema migration: event/idempotency tables** — `billing_webhook_event`, `billing_activation`, `billing_bridge_event`
4. **Schema migration: `song_analysis` measurement columns**
5. **RLS policies for all new billing tables**
6. **Core unlock RPCs** — `unlock_songs_for_account`, `insert_song_unlocks_without_charge`, `activate_unlimited_songs`
7. **Credit and pack RPCs** — `grant_credits`, `fulfill_pack_purchase`, `reverse_pack_entitlement`
8. **Subscription lifecycle RPCs** — `activate_subscription`, `deactivate_subscription`, `update_subscription_state`
9. **Conversion lifecycle RPCs** — `prepare_subscription_upgrade_conversion`, `link_subscription_upgrade_checkout`, `release_subscription_upgrade_conversion`, `apply_subscription_upgrade_conversion`, `reverse_subscription_upgrade_conversion`
10. **Unlimited reversal RPC** — `reverse_unlimited_period_entitlement`
11. **Queue reprioritization RPC** — `reprioritize_pending_jobs_for_account`
12. **Billing-aware selector RPCs** — `select_liked_song_ids_needing_enrichment_work`, `select_entitled_data_enriched_liked_song_ids`, `is_account_song_entitled`
13. **Regenerate Supabase types + compile-fix pass**

## Definition of done

- All billing tables exist in Supabase with correct constraints, indexes, and CHECK values
- RLS enabled on all new tables; direct anon/authenticated access denied
- All RPCs are `SECURITY DEFINER` with `SET search_path = public`
- Balance-mutating RPCs use `SELECT ... FOR UPDATE` on `account_billing`
- `credit_transaction` ledger row is written for every balance mutation
- Pack fulfillment is idempotent on `stripe_event_id`
- Conversion lifecycle transitions enforce the at-most-one-pending invariant
- `reprioritize_pending_jobs_for_account` is called as the final step in every queue-band-affecting RPC
- Selector RPCs return per-song stage flags and respect the canonical entitlement predicate
- `database.types.ts` regenerated and project compiles cleanly
- RPC unit/integration tests validate happy paths and edge cases (duplicate delivery, insufficient balance, concurrent unlock)
