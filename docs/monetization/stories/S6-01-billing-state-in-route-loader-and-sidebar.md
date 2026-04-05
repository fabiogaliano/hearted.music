# S6-01 · Billing State in Route Loader + Sidebar

## Goal

Load `BillingState` in the authenticated route loader and replace the hardcoded sidebar plan label with a dynamic one.

## Why

The sidebar currently shows `"Free Plan"` for everyone. The authenticated layout needs billing state in its context so all child routes and shell components can access it.

## Depends on

- S2-02 (`getBillingState` server function)
- S2-01 (`BillingState` type)

## Blocks

- S6-02, S6-03, S6-04 (shell/account track stories consume billing state from context)

## Scope

- Update `src/routes/_authenticated/route.tsx`:
  - Call `getBillingState(accountId)` in the route loader
  - Add billing state to the route context
  - Pass dynamic plan label to Sidebar

- Update `src/routes/_authenticated/-components/Sidebar.tsx`:
  - Replace hardcoded `"Free Plan"` with plan derived from `BillingState`
  - Plan labels: "Free Plan", "Pack (X songs to explore)", "3-Month Unlimited", "Backstage Pass"
  - Provider-disabled: "Unlimited" or similar

- Add balance display to sidebar (provider-enabled only):
  - Show songs-to-explore count when user has finite balance
  - Hide for unlimited and provider-disabled users

## Out of scope

- Settings billing section (S6-02)
- Locked song rendering (S6-03)
- Song selection UI (S6-04)

## Likely touchpoints

| Area | Files |
|---|---|
| Route | `src/routes/_authenticated/route.tsx` |
| Sidebar | `src/routes/_authenticated/-components/Sidebar.tsx` |

## Constraints / decisions to honor

- `BillingState` is the single canonical billing read model
- Balance display hidden for unlimited and provider-disabled
- Self-hosted may show "Unlimited" without songs-to-explore count

## Acceptance criteria

- [ ] Billing state available in authenticated route context
- [ ] Sidebar shows dynamic plan label from billing state
- [ ] Balance shown for pack users in provider-enabled mode
- [ ] Balance hidden for unlimited and provider-disabled users
- [ ] No hardcoded `"Free Plan"` remaining
- [ ] Project compiles

## Verification

- Manual: free, pack, unlimited, self-hosted → correct sidebar labels
- `bun run test` passes

## Parallelization notes

- **Hot file**: `route.tsx` — coordinate with any other stories modifying the authenticated layout
- Should merge early in Phase 6 since other stories depend on billing state in context

## Suggested PR title

`feat(billing): load billing state in route loader, dynamic sidebar plan + balance`
