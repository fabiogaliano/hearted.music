# S2-02 · getBillingState Server Function + Queries

## Goal

Implement `getBillingState(accountId)` server function and the underlying `src/lib/domains/billing/queries.ts` module that reads billing state from Supabase.

## Why

This is the single read path for billing facts used by route loaders, server functions, and workflow code. It normalizes raw `account_billing` data into the canonical `BillingState` type and provides a self-healing fallback for missing rows.

## Depends on

- S2-01 (BillingState type, env config)
- S1-12 (generated types for `account_billing` table)

## Blocks

- S2-04 (queue-band resolution uses BillingState)
- Phase 3 (workflow and read-model code calls getBillingState)
- Phase 6 (route loaders call getBillingState)

## Scope

### `src/lib/domains/billing/queries.ts`
- `readBillingState(supabase, accountId): Promise<BillingState>` — reads `account_billing`, normalizes subscription status, computes `queueBand` and `unlimitedAccess`
- Self-healing: if `account_billing` row is missing, creates one via `INSERT ... ON CONFLICT DO NOTHING` and returns the default free state
- Self-healing must NOT create purchased balance or grant unlimited access

### Server function
- `getBillingState(accountId)` — TanStack Start server function wrapping `readBillingState`
- Returns `BillingState`

## Out of scope

- `unlocks.ts` orchestration (later story)
- Balance mutation queries (RPCs handle those)
- Route loader integration (Phase 6)
- Bridge or checkout server functions (Phase 4)

## Likely touchpoints

| Area | Files |
|---|---|
| Billing domain | `src/lib/domains/billing/queries.ts` *(new)* |
| Server functions | `src/lib/server/billing.functions.ts` *(new)* |

## Constraints / decisions to honor

- Missing row is a bug to repair, not a valid mode signal
- Self-healing fallback must not grant purchased balance
- Subscription-status normalization: `active` + `cancel_at_period_end=true` → `ending`; `past_due`/`unpaid` → `past_due`
- `unlimited_access_source IS NULL` → `UnlimitedAccess.kind = 'none'`
- Queue band derived from the same mapping as S1-10

## Acceptance criteria

- [ ] `readBillingState` returns correct `BillingState` for free, pack-with-balance, quarterly, yearly, self_hosted accounts
- [ ] Self-healing creates a minimal `account_billing` row if missing
- [ ] Self-healing does not grant balance or unlimited access
- [ ] Subscription-status normalization covers all Stripe states
- [ ] `getBillingState` server function is callable from route loaders
- [ ] Project compiles

## Verification

- Unit test: mock Supabase responses → correct BillingState output
- Integration test: self-healing creates row for new account
- `tsc --noEmit` passes

## Parallelization notes

- Can run in parallel with S2-03 after S2-01 merges

## Suggested PR title

`feat(billing): getBillingState server function and billing queries`
