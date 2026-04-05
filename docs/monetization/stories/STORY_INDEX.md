# Monetization Story Index

> PR-sized implementation stories derived from the monetization planning artifacts. Each story is independently reviewable and sized for one branch/PR.
>
> **Source docs:** `MONETIZATION_V2_PLAN.md`, `CURRENT_STATE_AUDIT.md`, `TERMINOLOGY.md`, `DECISIONS.md`, `IMPLEMENTATION_PHASES.md`, `features/*`

---

## Dependency spine

```
Phase 1 (schema + RPCs) → Phase 2 (app contracts) → Phase 3 (enforcement)
                                                         ↓
                                                    Phase 4 (billing service + bridge)
                                                         ↓
                                              ┌──────────┴──────────┐
                                          Phase 5              Phase 6
                                        (onboarding)        (post-onboarding UI)
                                              └──────────┬──────────┘
                                                         ↓
                                                    Phase 7 (hardening)
```

**First split point:** After Phase 2 — workflow and read-model tracks can parallelize.
**Second split point:** After Phase 4 bridge contracts — Phases 5 and 6 can parallelize.

---

## Phase 1 — Billing Schema & RPCs

Foundation layer. All schema, RPCs, and SQL contracts.

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S1-01](S1-01-core-billing-tables.md) | Core billing tables migration | — | `supabase/migrations/` |
| [S1-02](S1-02-pack-conversion-tables.md) | Pack & conversion tables | S1-01 | `supabase/migrations/` |
| [S1-03](S1-03-event-tables-and-measurement-columns.md) | Event/idempotency tables + measurement columns | S1-01 | `supabase/migrations/` |
| [S1-04](S1-04-entitlement-predicate-rpc.md) | Entitlement predicate RPC | S1-01 | `supabase/migrations/` |
| [S1-05](S1-05-core-unlock-rpcs.md) | Core unlock RPCs | S1-01, S1-02, S1-04 | `supabase/migrations/` |
| [S1-06](S1-06-credit-and-pack-rpcs.md) | Credit & pack RPCs | S1-05, S1-10 | `supabase/migrations/` |
| [S1-07](S1-07-subscription-lifecycle-rpcs.md) | Subscription lifecycle RPCs | S1-01, S1-10 | `supabase/migrations/` |
| [S1-08](S1-08-conversion-lifecycle-rpcs.md) | Conversion lifecycle RPCs | S1-01, S1-02 | `supabase/migrations/` |
| [S1-09](S1-09-reversal-rpcs.md) | Unlimited reversal RPC | S1-01 | `supabase/migrations/` |
| [S1-10](S1-10-queue-reprioritization-rpc.md) | Queue reprioritization RPC | S1-01 | `supabase/migrations/` |
| [S1-11](S1-11-billing-aware-selector-rpcs.md) | Billing-aware selector RPCs | S1-01, S1-04 | `supabase/migrations/` |
| [S1-12](S1-12-regenerate-types.md) | Regenerate Supabase types | S1-01–S1-11 | `database.types.ts` |

### Phase 1 parallelization

```
S1-01 ──┬── S1-02 ──┐
        ├── S1-03   │
        ├── S1-04 ──┼── S1-05 ── S1-06
        ├── S1-09   │
        └── S1-10 ──┼── S1-07
                    │
           S1-08 ───┘
           S1-11 ───┘
                    └── S1-12
```

---

## Phase 2 — App Billing Domain & Shared Contracts

TypeScript domain boundary, env config, provisioning, control-plane integration.

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S2-01](S2-01-billing-domain-types-and-env.md) | Billing domain types + env config | S1-12 | `billing/state.ts`, `env.ts` |
| [S2-02](S2-02-get-billing-state.md) | getBillingState server function + queries | S2-01 | `billing/queries.ts`, `billing.functions.ts` |
| [S2-03](S2-03-account-provisioning.md) | Account provisioning + self-hosted | S2-01 | `accounts/queries.ts` |
| [S2-04](S2-04-queue-band-implementation.md) | Queue-band implementation | S2-01, S2-02 | `queue-priority.ts`, `service.ts` |
| [S2-05](S2-05-control-plane-billing-changes.md) | Control-plane change variants + helpers | S2-01 | `types.ts`, `changes/billing.ts` |
| [S2-06](S2-06-unlock-orchestration.md) | Unlock orchestration module | S2-02, S2-05 | `billing/unlocks.ts`, `billing.functions.ts` |
| [S2-07](S2-07-devtools-reset-reseed.md) | Devtools reset/reseed for billing | S2-03 | `devtools/reset.ts`, `reseed.ts` |

### Phase 2 parallelization

```
S2-01 ──┬── S2-02 ──┬── S2-04
        ├── S2-03 ──┼── S2-07
        └── S2-05 ──┘
                    └── S2-06
```

---

## Phase 3 — Entitlement Enforcement

Pipeline gating (workflow track) and read-model enforcement (read-model track). Two parallel tracks after Phase 2.

### Workflow track

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S3-01](S3-01-enrichment-selector-integration.md) | Enrichment selector integration | S1-11, S2-01 | `batch.ts` |
| [S3-02](S3-02-orchestrator-stage-subbatching.md) | Orchestrator stage sub-batching | S3-01 | ⚠️ `orchestrator.ts` |
| [S3-03](S3-03-content-activation-stage.md) | Content activation stage | S3-02, S1-05, S2-02 | ⚠️ `orchestrator.ts` |
| [S3-04](S3-04-remove-legacy-item-status-and-progress.md) | Remove legacy item_status + progress | S3-03 | ⚠️ `orchestrator.ts`, `progress.ts` |
| [S3-05](S3-05-match-refresh-candidate-filtering.md) | Match refresh candidate filtering | S1-11 | `match-snapshot-refresh/` |
| [S3-06](S3-06-reconciler-billing-changes.md) | Reconciler billing-change handling | S2-05, S2-04 | `reconciler.ts`, `service.ts` |

### Read-model track

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S3-07](S3-07-liked-songs-locked-pending-split.md) | Liked songs page locked/pending split | S1-04, S2-01 | `liked-songs.functions.ts` |
| [S3-08](S3-08-liked-songs-stats-billing-aware.md) | Liked songs stats billing-aware | S3-07 | `liked-songs.functions.ts` |
| [S3-09](S3-09-dashboard-stats-billing-aware.md) | Dashboard stats billing-aware | S1-04, S2-01 | `dashboard.functions.ts` |
| [S3-10](S3-10-match-loaders-entitlement-filtering.md) | Match/suggestion loaders filtering | S1-04, S2-01 | `matching.functions.ts` |
| [S3-11](S3-11-feature-type-migration.md) | Feature type migration (SongDisplayState) | S3-07, S3-08, S2-01 | `liked-songs/types.ts` |

### Cross-cutting

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S3-12](S3-12-provider-disabled-validation.md) | Provider-disabled validation | S3-01–S3-11 | `tests/` |

### Phase 3 parallelization

```
Workflow:     S3-01 → S3-02 → S3-03 → S3-04
              S3-05 (parallel)
              S3-06 (parallel)

Read-model:   S3-07 → S3-08
              S3-09 (parallel)
              S3-10 (parallel)
              S3-11 (after S3-07, S3-08)

Validation:   S3-12 (after all)
```

⚠️ **Hot file warning:** `orchestrator.ts` is touched by S3-02, S3-03, S3-04 — these must be serial.

---

## Phase 4 — Billing Service & App Bridge

Stripe integration in `v1_hearted_brand/` and bridge integration in `v1_hearted/`.

### Billing service (`v1_hearted_brand/`)

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S4-01](S4-01-service-scaffold.md) | Service scaffold + HMAC + deploy | — | `v1_hearted_brand/` |
| [S4-02](S4-02-pack-checkout-endpoint.md) | Pack checkout endpoint | S4-01 | `v1_hearted_brand/` |
| [S4-03](S4-03-unlimited-checkout-endpoint.md) | Unlimited checkout endpoint | S4-01, S1-08 | `v1_hearted_brand/` |
| [S4-04](S4-04-portal-session-endpoint.md) | Portal session endpoint | S4-01 | `v1_hearted_brand/` |
| [S4-05](S4-05-webhook-and-pack-fulfillment.md) | Webhook endpoint + pack fulfillment | S4-01, S1-06 | `v1_hearted_brand/` |
| [S4-06](S4-06-subscription-activation-and-lifecycle.md) | Subscription activation + lifecycle | S4-05, S1-07, S1-08 | `v1_hearted_brand/` |
| [S4-07](S4-07-refund-dispute-and-expiry-handlers.md) | Refund/dispute + checkout expiry | S4-05, S1-06, S1-08, S1-09 | `v1_hearted_brand/` |

### App bridge (`v1_hearted/`)

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S4-08](S4-08-app-bridge-ingress.md) | Bridge ingress + idempotency | S4-01, S1-03, S2-05 | new API route |
| [S4-09](S4-09-bridge-handlers.md) | Bridge handlers (pack, unlimited, revocation) | S4-08, S3-06, S1-03 | `billing/bridge-handlers.ts` |
| [S4-10](S4-10-checkout-portal-server-functions.md) | createCheckoutSession + createPortalSession | S4-01, S2-01 | `billing.functions.ts` |

### Phase 4 parallelization

```
Service:   S4-01 ──┬── S4-02
                   ├── S4-03
                   ├── S4-04
                   └── S4-05 ──┬── S4-06
                               └── S4-07

App:       S4-08 ── S4-09
           S4-10 (parallel with all)
```

---

## Phase 5 — Onboarding Monetization

New onboarding steps and billing integration for the first-user experience.

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S5-01](S5-01-onboarding-step-enum-expansion.md) | Onboarding step enum expansion | Phase 3 | `preferences-queries.ts`, `Onboarding.tsx` |
| [S5-02](S5-02-song-showcase-step.md) | Song showcase step | S5-01 | `SongShowcaseStep.tsx` |
| [S5-03](S5-03-playlist-profiling-and-match-showcase.md) | Playlist profiling + match showcase | S5-01 | `MatchShowcaseStep.tsx` |
| [S5-04](S5-04-plan-selection-step.md) | Plan selection step | S5-01, S4-10 | `PlanSelectionStep.tsx` |
| [S5-05](S5-05-free-allocation-on-completion.md) | Free allocation on completion | S5-04, S2-06 | `onboarding.functions.ts` |
| [S5-06](S5-06-onboarding-checkout-branches.md) | Checkout branches + polling | S5-04, S4-10, S2-02 | `PlanSelectionStep.tsx` |
| [S5-07](S5-07-readystep-copy-and-provider-disabled.md) | ReadyStep copy + provider-disabled path | S5-01, S2-03 | `ReadyStep.tsx` |

### Phase 5 parallelization

```
S5-01 ──┬── S5-02
        ├── S5-03
        ├── S5-04 ──┬── S5-05
        │           └── S5-06
        └── S5-07
```

---

## Phase 6 — Post-Onboarding Monetization UX

In-app billing surfaces for ongoing use.

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S6-01](S6-01-billing-state-in-route-loader-and-sidebar.md) | Billing state in route loader + sidebar | S2-02 | ⚠️ `route.tsx`, `Sidebar.tsx` |
| [S6-02](S6-02-settings-billing-section.md) | Settings billing section + portal | S6-01, S4-10 | `SettingsPage.tsx` |
| [S6-03](S6-03-locked-song-rendering.md) | Locked song rendering | S3-07, S3-11, S6-01 | `liked-songs/*` |
| [S6-04](S6-04-song-selection-and-unlock.md) | Song selection UI + unlock | S6-03, S2-06 | `liked-songs/*` |
| [S6-05](S6-05-paywall-upgrade-ctas-and-cache.md) | Paywall + upgrade CTAs + cache invalidation | S6-04, S4-10 | `liked-songs/*`, query cache |

### Phase 6 parallelization

```
S6-01 ──┬── S6-02
        └── S6-03 ── S6-04 ── S6-05
```

⚠️ **Hot file warning:** `route.tsx` is touched by S6-01 — coordinate with any concurrent work on the authenticated layout.

---

## Phase 7 — Hardening & Launch Validation

Correctness validation across flows, edge cases, and operational readiness.

| Story | Title | Depends on | Hot files |
|---|---|---|---|
| [S7-01](S7-01-e2e-free-and-pack-flows.md) | E2E: free + pack flows | Phases 1–6 | `tests/` |
| [S7-02](S7-02-e2e-unlimited-flows.md) | E2E: unlimited activation + renewal + cancellation | Phases 1–6 | `tests/` |
| [S7-03](S7-03-e2e-refund-chargeback-flows.md) | E2E: refund/chargeback flows | Phases 1–6 | `tests/` |
| [S7-04](S7-04-idempotency-and-concurrency.md) | Idempotency + concurrency suite | Phases 1–6 | `tests/` |
| [S7-05](S7-05-reprioritization-audit-and-bootstrap.md) | Reprioritization audit + fresh-account bootstrap | Phases 1–6 | `tests/` |
| [S7-06](S7-06-measurement-and-launch-checklist.md) | Measurement + launch checklist | S7-01–S7-05 | `docs/`, stages |

### Phase 7 parallelization

```
S7-01 ─┐
S7-02 ─┤
S7-03 ─┼── S7-06
S7-04 ─┤
S7-05 ─┘
```

---

## Story count summary

| Phase | Stories | Repo |
|---|---|---|
| 1 — Schema & RPCs | 12 | `v1_hearted/` (migrations) |
| 2 — App domain | 7 | `v1_hearted/` |
| 3 — Enforcement | 12 | `v1_hearted/` |
| 4 — Billing service + bridge | 10 | `v1_hearted_brand/` + `v1_hearted/` |
| 5 — Onboarding | 7 | `v1_hearted/` |
| 6 — Post-onboarding UI | 5 | `v1_hearted/` |
| 7 — Hardening | 6 | Both |
| **Total** | **59** | |

---

## Hot file conflict map

Files touched by multiple stories that need sequential merging or coordination:

| File | Stories | Strategy |
|---|---|---|
| `orchestrator.ts` | S3-02, S3-03, S3-04 | Serial: S3-02 → S3-03 → S3-04 |
| `liked-songs.functions.ts` | S3-07, S3-08 | Serial: S3-07 → S3-08 |
| `route.tsx` | S6-01 | Merge S6-01 first; later stories read from context |
| `billing.functions.ts` | S2-02, S2-06, S4-10 | S2-02 first; S2-06 and S4-10 add functions (low conflict) |
| `types.ts` (library-processing) | S2-05, S3-06 | S2-05 first (adds types); S3-06 consumes |
| `service.ts` (library-processing) | S2-04, S3-06 | S2-04 first (queue band); S3-06 adds billing change routing |
| `PlanSelectionStep.tsx` | S5-04, S5-06 | S5-04 first; S5-06 adds checkout logic |
