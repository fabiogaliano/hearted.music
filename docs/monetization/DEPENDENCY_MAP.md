# Monetization Dependency Map

> **Purpose:** Identify serial dependencies, safe parallel groups, hot files, and recommended implementation waves for AI agents working in separate branches/worktrees.
>
> **Source:** `STORY_INDEX.md`, `IMPLEMENTATION_PHASES.md`, `DECISIONS.md`, individual story files in `stories/`.

---

## 1. Full Story Dependency Graph

```
S1-01 ──┬── S1-02 ──┬── S1-05 ── S1-06
        │           └── S1-08
        ├── S1-03
        ├── S1-04 ──┬── S1-05
        │           └── S1-11
        ├── S1-09
        └── S1-10 ──┬── S1-06
                    └── S1-07
                         │
        All S1-* ───── S1-12
                         │
                       S2-01 ──┬── S2-02 ──┬── S2-04
                               │           ├── S2-06
                               ├── S2-03 ──┤── S2-07
                               │           └── S5-07
                               └── S2-05 ──┬── S2-06
                                           ├── S3-06
                                           └── S4-08
                                                │
S3 Workflow track:   S3-01 → S3-02 → S3-03 → S3-04
                     S3-05 (independent after S1-11)
                     S3-06 (needs S2-05, S2-04)

S3 Read-model track: S3-07 → S3-08 → S3-11
                      S3-09 (independent after S2-01)
                      S3-10 (independent after S2-01)

S3 Validation:        S3-12 (after all S3-*)

S4 Service:  S4-01 ──┬── S4-02
                      ├── S4-03
                      ├── S4-04
                      └── S4-05 ──┬── S4-06
                                  └── S4-07
S4 App:      S4-08 ── S4-09 (needs S3-06, S1-03)
             S4-10 (needs S4-01, S2-01)

S5:  S5-01 ──┬── S5-02
              ├── S5-03
              ├── S5-04 ──┬── S5-05 (needs S2-06)
              │           └── S5-06 (needs S4-10, S2-02)
              └── S5-07 (needs S2-03)

S6:  S6-01 ──┬── S6-02 (needs S4-10)
              └── S6-03 ── S6-04 ── S6-05 (needs S4-10)

S7:  S7-01 ─┐
     S7-02  ─┤
     S7-03  ─┼── S7-06
     S7-04  ─┤
     S7-05  ─┘
```

---

## 2. Critical Path

The longest dependency chain determines minimum calendar time:

```
S1-01 → S1-02 → S1-05 → S1-06 → S1-12
  → S2-01 → S2-02 → S2-06
    → S3-01 → S3-02 → S3-03 → S3-04
      → S3-12
        → S5-01 → S5-04 → S5-06
          → S7-01 → S7-06
```

**~20 stories on the critical path.** Every delay on this chain delays everything.

Secondary critical path (service side):
```
S4-01 → S4-05 → S4-06/S4-07 → S4-09
```

The service path runs in a separate repo (`v1_hearted_brand/`) and only merges into the critical path at S4-09 (bridge handlers) and S4-10 (checkout server functions), which gate Phases 5–6 checkout flows.

---

## 3. Shared-Contract Stories — Must Land First

These stories define types, schemas, predicates, and interfaces consumed by many downstream stories. Landing them early prevents drift and rework.

| Story | What it freezes | Downstream consumers |
|---|---|---|
| **S1-01** | Core billing tables | Every S1-* story, all later phases |
| **S1-04** | Entitlement predicate RPC | S1-05, S1-11, S3-07, S3-08, S3-09, S3-10 |
| **S1-11** | Billing-aware selector RPCs | S3-01, S3-05 |
| **S1-12** | `database.types.ts` | All TS code touching billing tables |
| **S2-01** | `BillingState`, `SongDisplayState`, env flags | Every Phase 2–7 story in `v1_hearted/` |
| **S2-05** | `LibraryProcessingChange` billing variants, bridge event shapes | S3-06, S4-08, S4-09 |
| **S5-01** | Onboarding step enum | S5-02 through S5-07 |

**Rule:** No parallel work should begin on a phase until that phase's contract stories have merged to the shared base branch.

---

## 4. Hot Files / Merge-Risk Zones

### High conflict risk (touched by multiple serial stories)

| File | Stories | Strategy |
|---|---|---|
| `supabase/migrations/` | S1-01 through S1-11 | Timestamp-ordered migrations avoid content conflicts, but parallel branches creating migrations risk ordering collisions. **Merge Phase 1 migrations sequentially.** |
| `src/lib/data/database.types.ts` | S1-12 (generates), every later TS story (reads) | **S1-12 is a gate.** Regenerate once after all S1-* land. Do not regenerate in parallel branches. |
| `enrichment-pipeline/orchestrator.ts` | S3-02, S3-03, S3-04 | **Strictly serial.** Each rewrites orchestrator logic the next depends on. |
| `liked-songs.functions.ts` | S3-07, S3-08 | Serial within pair; no conflict with other tracks. |
| `billing.functions.ts` | S2-02, S2-06, S4-10 | S2-02 first (creates file); S2-06 and S4-10 add exports (low conflict if additive). |
| `library-processing/types.ts` | S2-05, S3-06 | S2-05 first (adds union variants); S3-06 consumes. |
| `library-processing/service.ts` | S2-04, S3-06 | S2-04 first (queue band); S3-06 adds routing. |
| `PlanSelectionStep.tsx` | S5-04, S5-06 | Serial: S5-04 creates, S5-06 adds checkout. |

### Medium conflict risk (shared by separate tracks)

| File | Stories | Risk |
|---|---|---|
| `src/env.ts` | S2-01 | One-time addition of 4 env vars. Low risk if S2-01 merges before parallel work. |
| `route.tsx` (authenticated) | S6-01 | Adds billing state to loader. Must merge before S6-02+. Coordinate with any non-billing work on this layout. |
| `Sidebar.tsx` | S6-01 | Same as above. |
| `Onboarding.tsx` | S5-01, S5-02, S5-03, S5-04, S5-07 | S5-01 is the gate. Later stories add components to the step config — additive but touches same switch/config block. |
| `onboarding.functions.ts` | S5-01, S5-03, S5-05, S5-07 | Multiple stories add server functions. Additive but needs coordination. |
| `src/features/liked-songs/*` | S3-11, S6-03, S6-04, S6-05 | S3-11 migrates types first; S6-03+ builds on new types. |

### Generated artifact risk

| Artifact | Risk | Mitigation |
|---|---|---|
| `database.types.ts` | Regenerated by `supabase gen types`. Two branches regenerating independently will produce unresolvable conflicts. | Regenerate exactly once (S1-12). Later migrations in Phase 3+ should regenerate on their own branch and rebase before merge. |
| Supabase migration timestamps | Two branches creating migrations at the same logical point will have colliding or out-of-order timestamps. | Number migrations within a phase. Merge phase-internal migration stories sequentially. |

---

## 5. Parallelizable Story Groups

Stories within each group can safely run in parallel (no shared file writes, no data dependency).

### Group A — Phase 1 parallel after S1-01

After S1-01 lands:
- **Agent 1:** S1-02, then S1-08
- **Agent 2:** S1-03
- **Agent 3:** S1-04, then S1-11
- **Agent 4:** S1-09
- **Agent 5:** S1-10

Then S1-05 (needs S1-01, S1-02, S1-04) → S1-06 (needs S1-05, S1-10) and S1-07 (needs S1-01, S1-10).

S1-12 waits for all.

### Group B — Phase 2 parallel after S2-01

After S2-01 lands:
- **Agent 1:** S2-02 → S2-04
- **Agent 2:** S2-03 → S2-07
- **Agent 3:** S2-05

Then S2-06 (needs S2-02, S2-05).

### Group C — Phase 3 workflow vs read-model split

After Phase 2 lands:
- **Agent 1 (workflow):** S3-01 → S3-02 → S3-03 → S3-04
- **Agent 2 (read-model):** S3-07 → S3-08 → S3-11
- **Agent 3 (read-model):** S3-09
- **Agent 4 (read-model):** S3-10
- **Agent 5 (workflow):** S3-05
- **Agent 6 (workflow):** S3-06

S3-12 waits for all.

### Group D — Phase 4 service vs app split

Can start after Phase 2 contracts land (S2-05 for bridge shapes). Service work is in a separate repo.

- **Agent 1 (brand repo):** S4-01 → S4-02, S4-03, S4-04 in parallel → S4-05 → S4-06, S4-07 in parallel
- **Agent 2 (app repo):** S4-08 → S4-09
- **Agent 3 (app repo):** S4-10

### Group E — Phase 5 vs Phase 6 split

After Phase 4 bridge contracts land:
- **Agent 1 (onboarding):** S5-01 → S5-02, S5-03, S5-07 in parallel → S5-04 → S5-05, S5-06 in parallel
- **Agent 2 (post-onboarding):** S6-01 → S6-02 and S6-03 in parallel → S6-04 → S6-05

### Group F — Phase 7 parallel

- **Agents 1–5:** S7-01, S7-02, S7-03, S7-04, S7-05 all in parallel
- **Gate:** S7-06 after all above

---

## 6. Stories That Must NOT Run in Parallel

| Set | Stories | Reason |
|---|---|---|
| Orchestrator chain | S3-02 → S3-03 → S3-04 | All rewrite `orchestrator.ts`. Each depends on the prior's structure. |
| Liked songs functions | S3-07 → S3-08 | Both modify `liked-songs.functions.ts` and the same SQL RPC area. |
| Feature type gate | S3-07/S3-08 → S3-11 → S6-03 | S3-11 replaces the type system S6-03 consumes. |
| Migration authoring | Any two S1-* stories creating migrations | Timestamp ordering. Merge sequentially even if developed in parallel. |
| Type regeneration | S1-12 vs any TS work | S1-12 must land before any TS code imports billing types. |
| Onboarding state machine | S5-01 → S5-02/S5-03/S5-04/S5-07 | S5-01 changes the step enum everything else depends on. |
| Plan selection chain | S5-04 → S5-05, S5-06 | Both add logic to the same step and completion handler. |
| Billing service scaffold | S4-01 → all S4-02 through S4-07 | Scaffold provides routing, auth, and deploy config. |
| Authenticated layout | S6-01 → S6-02, S6-03, S6-04, S6-05 | S6-01 adds billing state to route context. |

---

## 7. Recommended Implementation Waves

### Wave 1 — Schema Foundation
**Goal:** All billing tables, RPCs, and generated types exist.
**Agent count:** 1–2 (migration ordering risk limits parallelism)
**Duration estimate:** Shortest; mostly SQL.

| Serial spine | Parallel after S1-01 |
|---|---|
| S1-01 (must be first) | S1-02, S1-03, S1-04, S1-09, S1-10 |
| S1-05 (after S1-01, S1-02, S1-04) | S1-08 (after S1-01, S1-02) |
| S1-06 (after S1-05, S1-10) | S1-07 (after S1-01, S1-10) |
| S1-11 (after S1-01, S1-04) | |
| S1-12 (after all) | |

**Merge strategy:** Develop S1-02/S1-03/S1-04/S1-09/S1-10 in parallel branches, but merge to main sequentially to avoid migration timestamp conflicts. S1-12 is the final gate.

**Exit gate:** `database.types.ts` regenerated, `bun run test` passes, fresh `supabase db reset` clean.

---

### Wave 2 — App Contracts + Service Scaffold
**Goal:** Freeze TS types, entitlement predicate, queue bands, control-plane changes, billing domain boundary. Simultaneously scaffold the billing service.
**Agent count:** 2–3

| Agent 1 (app contracts) | Agent 2 (app contracts) | Agent 3 (service — separate repo) |
|---|---|---|
| S2-01 | — | S4-01 |
| S2-02 → S2-04 | S2-03 → S2-07 | S4-02, S4-03, S4-04 (after S4-01) |
| S2-05 | — | — |
| S2-06 (after S2-02 + S2-05) | — | — |

S4-01 has no dependency on Phase 1/2 — it's pure service scaffolding in a separate repo. Start it as soon as Wave 1 begins.

**Exit gate:** `BillingState`, `SongDisplayState`, `resolveQueuePriority()`, and `BillingChanges.*` are importable. Service scaffold deployed to staging.

---

### Wave 3 — Enforcement + Service Fulfillment
**Goal:** App is billing-safe. Service can fulfill purchases. This is the largest parallelizable wave.
**Agent count:** 3–5

| Agent 1 (workflow) | Agent 2 (read-model) | Agent 3 (read-model) | Agent 4 (service) | Agent 5 (app bridge) |
|---|---|---|---|---|
| S3-01 → S3-02 → S3-03 → S3-04 | S3-07 → S3-08 → S3-11 | S3-09, S3-10 | S4-05 → S4-06, S4-07 | S4-08 → S4-09 |
| S3-05, S3-06 (after S3-04 or parallel) | — | — | — | S4-10 |

**Merge strategy:**
- Workflow agent is strictly serial (orchestrator chain).
- Read-model agents can merge independently — they touch different server function files.
- Service agent works in `v1_hearted_brand/` — no merge conflict with app agents.
- App bridge agent creates new files — low conflict risk.
- S3-12 (provider-disabled validation) runs after all S3-* merge.

**Exit gate:** Locked songs are invisible. Phase B/C gated. Bridge ingress tested. `bun run test` passes.

---

### Wave 4 — Product Surfaces
**Goal:** Onboarding monetization and post-onboarding UX.
**Agent count:** 2

| Agent 1 (onboarding) | Agent 2 (post-onboarding) |
|---|---|
| S5-01 | S6-01 |
| S5-02, S5-03, S5-07 (parallel after S5-01) | S6-02, S6-03 (parallel after S6-01) |
| S5-04 | S6-04 |
| S5-05, S5-06 (parallel after S5-04) | S6-05 |

These two agents touch completely separate file trees (`onboarding/*` vs `liked-songs/*`, `settings/*`, `route.tsx`). Safe to run fully in parallel.

**Exit gate:** Fresh user can complete onboarding into free/pack/unlimited. Existing user can see plan, unlock songs, manage subscription.

---

### Wave 5 — Hardening
**Goal:** End-to-end correctness, idempotency, race conditions, launch readiness.
**Agent count:** 3–5 (all parallel)

| Parallel | |
|---|---|
| S7-01 (free + pack e2e) | S7-04 (idempotency + concurrency) |
| S7-02 (unlimited e2e) | S7-05 (reprioritization + bootstrap) |
| S7-03 (refund/chargeback e2e) | |

S7-06 (measurement + launch checklist) after all above.

**Exit gate:** All e2e flows pass. Launch checklist complete.

---

## 8. Safe Parallel Work Plan — Summary

```
Wave 1:  [1-2 agents]  Schema + RPCs           ───── merge sequentially
Wave 2:  [2-3 agents]  App contracts ║ Service scaffold  ── S4-01 starts early
Wave 3:  [3-5 agents]  Workflow ║ Read-models ║ Service fulfillment ║ App bridge
Wave 4:  [2 agents]    Onboarding ║ Post-onboarding UI
Wave 5:  [3-5 agents]  All e2e/hardening stories in parallel
```

**Maximum useful parallelism:** 5 agents in Wave 3.
**Minimum serial path:** Waves 1–5, with ~20 stories on the critical path.

### Key rules for safe parallel execution

1. **Never regenerate `database.types.ts` in two branches.** One branch regenerates; others rebase.
2. **Never create Supabase migrations in two branches targeting the same merge point.** Develop in parallel, merge sequentially.
3. **`orchestrator.ts` is a single-agent file.** S3-02 → S3-03 → S3-04 is one agent's serial work.
4. **Service work (`v1_hearted_brand/`) is always safe to parallelize** with app work — separate repo.
5. **New files are safe.** Stories that only create new files (S4-08, S4-09, S4-10, S5-02, S5-03, S6-02) have minimal merge risk.
6. **Contract stories are gates.** S1-12, S2-01, S2-05, S5-01, S6-01 must merge before their dependents start.
7. **Read-model stories in Phase 3 touch separate `.functions.ts` files** — `liked-songs`, `dashboard`, `matching` — and can safely parallelize across agents.
