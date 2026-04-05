# S3-12 · Provider-Disabled Validation

## Goal

Verify that `self_hosted` accounts pass through the same entitlement path as paid accounts, with full library processing and no regressions from billing-unaware behavior.

## Why

Provider-disabled mode is the fastest way to validate the app-side entitlement model. If `self_hosted` accounts break after billing enforcement lands, the entire deployment model is invalid.

## Depends on

- S3-01 through S3-11 (all enforcement stories)
- S2-03 (account provisioning with `self_hosted`)

## Blocks

- None (validation story)

## Scope

- Verify end-to-end: fresh provider-disabled account → provisioned with `self_hosted` unlimited → all songs entitled → full pipeline runs → content activation writes item_status + self_hosted unlock rows → read models show all songs as analyzed → match refresh uses all enriched songs
- Verify no regressions: same behavior as pre-billing full-library processing
- Fix any issues found during validation

## Out of scope

- Provider-enabled flows (tested in Phase 4+)
- UI changes
- Performance testing

## Likely touchpoints

| Area | Files |
|---|---|
| Tests | `tests/` — integration tests for provider-disabled flow |
| Account provisioning | `src/lib/domains/library/accounts/queries.ts` |
| All enforcement touchpoints from S3-01 through S3-11 |

## Constraints / decisions to honor

- `self_hosted` uses the same canonical entitlement predicate — no bypass
- `self_hosted` accounts get `priority` queue band
- Unlock rows get `source='self_hosted'`

## Acceptance criteria

- [ ] Fresh `BILLING_ENABLED=false` account has `self_hosted` unlimited access
- [ ] All songs show as entitled through selectors
- [ ] Full pipeline runs (Phase A + B + C + activation)
- [ ] `item_status` written for all analyzed songs
- [ ] Unlock rows created with `source='self_hosted'`
- [ ] Read models show all songs as `analyzed` (not `locked`)
- [ ] Match refresh includes all enriched songs
- [ ] No regressions from current ungated behavior

## Verification

- Integration test: full flow from provisioning to analyzed state
- `bun run test` passes

## Parallelization notes

- Must wait for all Phase 3 enforcement stories
- Quick validation pass — should be a small PR

## Suggested PR title

`test(billing): validate provider-disabled self_hosted entitlement path`
