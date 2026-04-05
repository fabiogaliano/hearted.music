# S7-06 · Measurement Instrumentation + Launch Checklist

## Goal

Verify `song_analysis` measurement columns are populated on new enrichment writes, and document the launch checklist and operational runbook.

## Why

COGS visibility requires the measurement columns to be populated. The launch checklist ensures nothing is forgotten before going live.

## Depends on

- Phases 1–6 complete
- S7-01 through S7-05 (validation stories)

## Blocks

- None (final story)

## Scope

### Measurement instrumentation
- Verify enrichment stage writes populate `song_analysis.provider`, `input_tokens`, `output_tokens`, `cost_usd`
- Update LLM analysis stage to populate these columns if not already done
- Verify existing writes are not broken by the new columns

### Launch checklist
Document in `docs/monetization/LAUNCH_CHECKLIST.md`:
- Stripe products created (test and live mode)
- Billing service deployed to `billing.hearted.music`
- Env vars configured (`BILLING_ENABLED`, `BILLING_SERVICE_URL`, `BILLING_SHARED_SECRET`)
- `QUARTERLY_PLAN_ENABLED` default confirmed
- RLS on all billing tables verified
- Legal/FAQ copy updated
- Fresh-account bootstrap validated
- All e2e flows validated
- Webhook endpoint registered in Stripe
- Monitoring/alerting recommendations

### Operational runbook
Document in `docs/monetization/RUNBOOK.md`:
- Refund procedure
- Chargeback handling
- Admin adjustment via `grant_credits`
- Manual unlock via `insert_song_unlocks_without_charge`
- Stuck conversion diagnosis and release
- Known limitations (plan switching, free abuse)

## Out of scope

- Production deployment itself
- Marketing/announcement

## Likely touchpoints

| Area | Files |
|---|---|
| Enrichment stages | `src/lib/workflows/enrichment-pipeline/stages/song-analysis.ts` |
| Docs | `docs/monetization/LAUNCH_CHECKLIST.md` *(new)*, `docs/monetization/RUNBOOK.md` *(new)* |

## Constraints / decisions to honor

- Measurement columns are for COGS, never for billing decisions
- Launch checklist must cover both provider-enabled and provider-disabled modes

## Acceptance criteria

- [ ] New `song_analysis` writes populate measurement columns
- [ ] Existing writes unbroken
- [ ] Launch checklist documented
- [ ] Operational runbook documented
- [ ] `bun run test` passes

## Verification

- Run enrichment on a test song → verify measurement columns populated
- Review checklist and runbook for completeness

## Parallelization notes

- Measurement verification can happen early; docs are the final deliverable
- Can run in parallel with other S7 stories

## Suggested PR title

`chore(billing): measurement instrumentation verification + launch checklist and runbook`
