# S1-05 · Core Unlock RPCs

## Goal

Implement the three RPCs that grant per-song access: `unlock_songs_for_account`, `insert_song_unlocks_without_charge`, and `activate_unlimited_songs`.

## Why

These are the write paths for all unlock operations — pack selection, free allocation, pack bonus unlocks, self-hosted provisioning, and unlimited content activation. Every fulfillment and activation flow depends on them.

## Depends on

- S1-01 (core tables)
- S1-02 (pack_credit_lot for FIFO lot consumption in `unlock_songs_for_account`)
- S1-04 (entitlement predicate — used for dedup logic)

## Blocks

- S1-06 (fulfill_pack_purchase calls insert_song_unlocks_without_charge)
- Phase 2 (unlock orchestration in billing domain)
- Phase 3 (content activation calls activate_unlimited_songs)

## Scope

### `unlock_songs_for_account`
- Validates ownership (song must be currently liked by account)
- Dedupes input; identifies already-unlocked songs
- Checks spendable balance (excluding reserved conversion credits)
- Deducts: operational balance first, then FIFO from `pack_credit_lot`
- Inserts `account_song_unlock` rows with `source='pack'`
- Writes `credit_transaction` ledger row
- All-or-nothing for net-new unlocks
- `SELECT ... FOR UPDATE` on `account_billing`
- Input cap: max 500 song IDs per request

### `insert_song_unlocks_without_charge`
- Inserts unlock rows without deducting balance
- Valid sources: `free_auto`, `pack`, `self_hosted`, `admin`
- Handles re-unlock of previously revoked songs (clear revocation, update source)
- No balance mutation

### `activate_unlimited_songs`
- Upserts `item_status` for account-visible songs
- Inserts missing unlock rows with `source='unlimited'` and subscription provenance (`granted_stripe_subscription_id`, `granted_subscription_period_end`)
- No balance deduction

All three: `SECURITY DEFINER`, `SET search_path = public`

## Out of scope

- Pack fulfillment orchestration (S1-06)
- Conversion-aware spendable balance (S1-08 wires conversion exclusion)
- TypeScript wrappers
- Control-plane change emission (Phase 2)

## Likely touchpoints

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/{timestamp}_core_unlock_rpcs.sql` |

## Constraints / decisions to honor

- `UNIQUE(account_id, song_id)` on `account_song_unlock` — handle conflicts gracefully
- Re-unlock of revoked songs reuses existing row (clear `revoked_at`/`revoked_reason`, update `source`)
- Spendable balance = `credit_balance` minus reserved conversion amounts
- FIFO lot consumption: `ORDER BY created_at ASC, id ASC`
- Reject malformed UUIDs, non-owned songs, or songs no longer currently liked (fail whole request)
- Duplicate song IDs in input deduped silently

## Acceptance criteria

- [ ] `unlock_songs_for_account` deducts correct balance and creates unlock rows for net-new songs only
- [ ] Already-unlocked songs returned separately without double-charge
- [ ] Insufficient balance returns error, no partial fulfillment
- [ ] `insert_song_unlocks_without_charge` creates unlock rows without touching `credit_balance`
- [ ] Re-unlock of revoked song clears revocation and updates source
- [ ] `activate_unlimited_songs` persists unlimited unlock rows with subscription provenance
- [ ] All RPCs write `credit_transaction` row when balance changes
- [ ] `SELECT ... FOR UPDATE` on `account_billing` for balance-mutating paths

## Verification

- SQL tests: happy path, insufficient balance, duplicate songs, revoked re-unlock, concurrent calls
- `supabase db reset` completes

## Parallelization notes

- Depends on S1-01, S1-02, S1-04 (must wait for all three)
- Can run in parallel with S1-03

## Suggested PR title

`feat(billing): core unlock RPCs — unlock_songs, insert_unlocks, activate_unlimited`
