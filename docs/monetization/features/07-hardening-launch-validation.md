# Feature: Hardening & Launch Validation

> **Feature 07** · Dependency: Features 01–06

## Goal

Prove the monetization system is correct under retries, reversals, race conditions, and fresh-account flows — moving the implementation from "works in happy path" to "safe to launch."

## Why it exists

Monetization bugs are expensive and highly visible. Individual features are built and tested in relative isolation; this feature validates the full integrated system across the scenarios that matter for launch confidence:

- Concurrent operations and race conditions
- Webhook/bridge duplicate delivery and idempotency
- Refund/chargeback reversal correctness
- Fresh-account bootstrap (not just reseeded test data)
- Provider-enabled and provider-disabled mode parity
- Queue reprioritization after all billing state transitions

## What this feature owns

- **End-to-end flow validation** for:
  - Fresh free onboarding → free allocation → processing → results
  - Pack purchase → manual unlock → processing → results
  - Unlimited activation → full-library processing → subscription renewal
  - Cancellation → access through period end → post-period behavior
  - Refund/chargeback: pack reversal (balance + bonus unlocks)
  - Refund/chargeback: unlimited period reversal (songs revoked, conversion restored if initial invoice)
  - Failed payment → `past_due` → recovery or deletion
  - Uncancel before period end
- **Idempotency verification**:
  - Duplicate webhook delivery → safe via `billing_webhook_event`
  - Duplicate bridge delivery → safe via `billing_bridge_event`
  - Duplicate unlock requests → no double-charge via `UNIQUE(account_id, song_id)`
- **Race condition validation**:
  - Concurrent unlock requests for overlapping song sets
  - Concurrent pack purchase + unlimited checkout
  - Content activation during unlimited deactivation window
  - Bridge delivery during subscription lifecycle transitions
- **Queue reprioritization coverage** — verify every billing mutation that changes queue band correctly invokes `reprioritize_pending_jobs_for_account`
- **Cost/measurement instrumentation** — verify `song_analysis` measurement columns (`provider`, `input_tokens`, `output_tokens`, `cost_usd`) are populated by enrichment writes
- **Fresh-account bootstrap validation** — test from truly empty account (no seeded data); verify billing row creation, provisioning, onboarding, and first purchase
- **Provider mode parity** — same test scenarios in provider-enabled and provider-disabled modes; verify no entitlement leaks or UI regressions in either mode
- **Operational readiness** — launch checklist; refund/dispute runbook; monitoring/alerting recommendations

## What it does not own

- New feature development — all features should be code-complete before this
- Stripe product catalog creation (setup task)
- Production deployment (separate launch activity)

## Likely touchpoints

| Area | Files |
|---|---|
| Test suites | `tests/` — integration and workflow tests |
| Stripe test config | Stripe dashboard test-mode setup |
| Devtools | `src/lib/workflows/library-processing/devtools/reset.ts`, `reseed.ts` |
| Scripts | `scripts/reset-onboarding.ts` |
| Operational docs | `docs/` — launch checklist, runbooks |
| All billing RPCs | `supabase/migrations/*` — validated under concurrent/retry conditions |
| All billing server fns | `src/lib/server/billing.functions.ts`, `liked-songs.functions.ts`, etc. |

## Dependencies

- Features 01–06 code-complete
- Stripe test-mode environment available
- Preprod accounts resettable/reseedable

## Downstream stories this feature should split into

1. **E2E: free onboarding flow** — fresh account through onboarding to free allocation to processed results
2. **E2E: pack purchase flow** — purchase → bonus unlocks → manual selection → processing → results
3. **E2E: unlimited activation + renewal** — checkout → activation → full-library processing → renewal period
4. **E2E: cancellation + post-period** — cancel → access through period → deactivation → locked state for new songs
5. **E2E: pack refund/chargeback** — reversal → balance subtracted → newest unlocks revoked → control-plane notification
6. **E2E: unlimited period refund** — reversal → period songs revoked → conversion restored (if initial invoice) → control-plane notification
7. **E2E: failed payment + recovery** — `past_due` → no new unlimited work → recovery payment → access restored
8. **Idempotency test suite** — duplicate webhooks, duplicate bridge calls, duplicate unlock requests all safe
9. **Concurrency test suite** — overlapping unlocks, simultaneous checkout + purchase, activation during deactivation
10. **Queue reprioritization audit** — verify every queue-band-affecting billing mutation calls `reprioritize_pending_jobs_for_account`; test each transition
11. **Fresh-account bootstrap validation** — empty account in both provider modes through onboarding to first results
12. **Measurement instrumentation verification** — `song_analysis` cost columns populated on new writes
13. **Launch checklist + operational runbook** — document launch prerequisites, monitoring, refund procedure, known limitations

## Definition of done

- All core purchase, activation, revocation, and cancellation flows validated end to end in Stripe test mode
- Duplicate webhook and bridge deliveries are provably safe (no double-charges, no duplicate control-plane effects)
- Concurrent unlock/purchase/activation operations do not corrupt billing state
- Queue band stays correct after all billing state transitions (tested for each mutation path)
- Fresh empty account completes onboarding and first purchase in both provider-enabled and provider-disabled modes
- `song_analysis` measurement columns populated on new enrichment writes
- Billing state, read-model visibility, and queue priority remain consistent after retries and reversals
- Launch checklist and refund/dispute runbook documented
- `bun run test` passes with no skipped or disabled tests
