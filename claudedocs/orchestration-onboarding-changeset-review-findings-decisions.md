# Orchestration decision log — onboarding-changeset-review-findings

Plan: `claudedocs/onboarding-changeset-review-findings.md`
Driver: `/orchestrate` (orchestrator coordinates; fresh subagents implement/review/patch).

## Ground-truth reconciliation (before any work)

The plan was compiled from a **working-tree diff vs HEAD**, but that work has since been
**fully committed** (commits `00c3eae`…`b20281a`). At run start the working tree held only two
uncommitted doc changes (the findings doc itself + a deletion of `onboarding-restructure.md`).
Consequences:

- **Task 1a (split `match-review-queue` out) — already satisfied.** The race-guard fix is its own
  commit `00c3eae`, ordered *before* the three onboarding feature commits; none of those onboarding
  commits (`14fed1b`, `174bc47`, `b20281a`) touch any `match-review-queue` file. At commit
  granularity it is already isolated. Per orchestrate rules (never push/PR) the commit split *is* the
  deliverable. Only "tests green in isolation" remains, covered by Task 1b's re-pointed suite.
- All other findings describe **already-committed** code; the work below lands as new commits on top.

## User decisions (asked up front)

| Item | Decision | Action |
|---|---|---|
| 2a — SpotlightPanel intent editor collapse-until-target in prod | **Keep in prod** | No gating. Add a WHY comment marking it a deliberate prod UX choice. |
| 2b — TargetToggle rewrite in prod | **Keep in prod** | No work. |
| 2c — DescriptionExamplesShuffle `xpl-reveal` in prod | **Onboarding-only** | Scope `xpl-reveal` to the guided variant; prod loses the reveal. |
| 4b — `REQUIRED_FLAGGED_COUNT` 3→2 | **Keep 2** | No change; leave at 2. |
| 1b — extract rollover module | **Do it** (deep refactor) | Plan-scoped deep extraction; not a wider service.ts pass. |
| 3 — consolidate guided flags | **Do the prop-collapse** | One cohesive `guided` prop; do NOT extract a full seam (one caller). |
| Working-tree docs (restructure.md deletion + findings edits) | **Leave untouched** | Stage only files changed per task. |

General preference (stated by user): **prefer clean/deep refactors over small patches** — applies
across all tasks, not 1b specifically.

## Per-task deviations from the plan

(Subagents report deviations in their final reports; orchestrator records them here to avoid
concurrent-write races on this file.)

### Task 1b — pass-advance/rollover extraction
- New module `pass-advance.ts` exposes `advanceActiveSession` returning a discriminated
  `PassAdvanceResult` (`resumed-in-place` | `appended-while-seeding` | `rolled-over-and-created`).
- **DI over circular import**: `appendLatestSnapshot`, `hasSessionBeenSeeded`,
  `createQueueFromLatestSnapshot` are injected into `advanceActiveSession` rather than imported,
  because they're private to `service.ts` (which imports `pass-advance.ts`). Avoids a cycle and makes
  the module testable with plain functions. `completeSession` is imported directly from `./queries`
  (no cycle there). Rationale: keep the deep module self-contained without restructuring `service.ts`.
- `countUnresolvedItems` kept in `service.ts` (still used by `getQueueSummary`).
- Patch round (1 of allowed 2): removed two restate-code comments flagged by review (WHY-only rule)
  and restored a dropped `insertQueueItems` song-identity assertion in the `syncActiveQueue` adapter
  test. Suite: 66/66.
- Review verdict: APPROVE-WITH-NITS; behavior-preserving, invariant preserved + tested once,
  coverage net-positive (deletion test passes).

### Task 3 — guided prop consolidation
- Single `guided?: GuidedPlaylistsConfig` object in `explorations/types.ts`; presence = guided mode,
  absence = production defaults (verified byte-identical per-prop by review).
- `closable` folded as inverted `locked`; `guidedIntent`, `hideUnmatchableWarning`,
  `hideTracksEmptyState`, `hideRailAdd` derived from `guided != null`; `showSearch` derived from
  `guided == null`. Verified the lone guided caller's old per-prop values all reproduce.
- `examples` / `matchingEmptyAction` are required-but-nullable fields (reviewer nit): chosen to force
  the caller to be explicit rather than silently omit; accepted, not a rule violation, no behavior
  change. No full seam extracted (plan boundary respected — one guided caller).
- WHY comment added at the `isTarget`-driven intent-editor collapse marking it a deliberate prod UX
  choice (decision 2a). Review verdict: APPROVE-WITH-NITS, no required fixes.

### Task 2c — scope xpl-reveal to guided
- One-line className gate in `DescriptionExamplesShuffle.tsx`: `xpl-reveal` (+ the `guided` modifier)
  now applied only when `variant === "guided"`. Prod path renders `DescriptionExamplesShuffle` with
  the default variant (SpotlightPanel.tsx:259), so prod loses the reveal; the guided instance
  (SpotlightPanel.tsx:234, `variant="guided"`) keeps it. No new prop, no CSS change.
- **Review approach deviation**: verified by the orchestrator directly (exact diff + both call sites +
  caller-variant grep) rather than a separate fresh-context review subagent — proportionate for a
  one-line gate. Logged here per the standing rule.

## Orchestration notes

- **Deviation log written by the orchestrator** (collecting subagent final-report deviations) rather
  than subagents appending concurrently — avoids write races on this file while two implementers ran
  in parallel.
- **Adjacent finding, left untouched (out of scope):** `WritingSurface.tsx:195` applies `xpl-reveal`
  to the genres block unconditionally (prod-reachable). Traced to commit `2aff5eed` and already
  present at `7a18bce` (before this changeset) — i.e. **pre-existing prod behavior, not introduced by
  the onboarding changeset**, which is why the leakage pass didn't flag it. Not a regression; not
  changed. Mentioned only for completeness.
- **End-of-run typecheck flake:** `tsgo` intermittently reported `TS2307: Cannot find module
  '@gsap/react'` in the untouched `src/features/landing/` feature, despite the package being declared
  in `package.json` and installed in `node_modules`. A clean re-run returned exit 0 with no errors.
  Transient resolution flake, unrelated to this run's files; no action.
