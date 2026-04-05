# S1-09 · Reversal RPCs

## Goal

Implement `reverse_unlimited_period_entitlement` — the RPC that revokes unlimited-period unlock rows after a subscription refund or chargeback.

## Why

When a paid subscription period is refunded or disputed, all songs that became account-visible during that period must return to locked state. The reversal key is `(granted_stripe_subscription_id, granted_subscription_period_end)` stored on unlock rows, making this a deterministic batch revocation.

## Depends on

- S1-01 (core tables — `account_song_unlock`)

## Blocks

- Phase 4 (refund/dispute handlers in billing service)

## Scope

### `reverse_unlimited_period_entitlement`
- Revokes all active `source='unlimited'` unlock rows matching `(p_stripe_subscription_id, p_subscription_period_end)`
- Sets `revoked_at`, `revoked_reason`, `revoked_stripe_event_id`
- Never touches `free_auto`, `pack`, `self_hosted`, or `admin` unlocks
- Idempotent: already-revoked rows for this period are skipped
- Returns `revoked_song_ids`
- `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- Pack reversal (S1-06 — `reverse_pack_entitlement`)
- Conversion reversal (S1-08)
- Control-plane change emission (Phase 2/3)
- Read-model updates

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_unlimited_reversal_rpc.sql` |

## Constraints / decisions to honor

- Reversal key is `(granted_stripe_subscription_id, granted_subscription_period_end)`, NOT `granted_stripe_event_id`
- `p_stripe_event_id` is recorded as `revoked_stripe_event_id` (audit trail)
- Match snapshots are append-only; revocations do NOT delete old snapshots
- Only `source='unlimited'` rows are ever revoked by this RPC

## Acceptance criteria

- [ ] Revokes all matching `source='unlimited'` rows for the given subscription + period
- [ ] Does not touch `free_auto`, `pack`, `self_hosted`, or `admin` unlock rows
- [ ] Sets `revoked_at`, `revoked_reason`, and `revoked_stripe_event_id` correctly
- [ ] Idempotent — second call with same parameters does not re-revoke or error
- [ ] Returns the list of newly revoked song IDs

## Verification

- SQL tests: revoke one period, verify other periods/sources untouched, verify idempotency
- `supabase db reset` completes

## Parallelization notes

- Can run in parallel with all other RPC stories after S1-01

## Suggested PR title

`feat(billing): reverse_unlimited_period_entitlement RPC`
