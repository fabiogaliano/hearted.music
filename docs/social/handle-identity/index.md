# Handle Identity — Task Index

Tracking index for the **handle identity** feature. The authoritative spec is
[`../handle-identity-implementation-plan.md`](../handle-identity-implementation-plan.md);
the files in this folder break that plan into independently trackable tasks.

Where a task file and the plan disagree, **the plan wins**. Plan §15 ("Resolved
decisions") is the scannable decision index; each normative section (§3–§14) is
the source of truth for its area.

## What this feature does

Build a single app-owned public identity — `account.handle` — once, then reuse it
across Settings, the authenticated shell sidebar, the Dashboard header, and a
minimal public `/@handle` route. V0 scope: add the column + atomic claim RPC,
make handle claim a required onboarding step right after `syncing`, switch the
authenticated identity surfaces to handle-first display, and keep the handle
immutable after claim. This is identity infrastructure, not a standalone social
feature.

## Status legend

- `[ ]` not started
- `[~]` in progress (note it in the task file)
- `[x]` done & verified

## Tasks

Ordered by dependency (mirrors plan §13.2 "Recommended order", with §7's large
onboarding-machine work split so each task stays reviewable).

| # | Task | Status | Plan §§ |
|---|------|--------|---------|
| 01 | [Public app-origin config](./01-public-app-origin-config.md) | [x] | §10 |
| 02 | [Schema & migrations](./02-schema-and-migrations.md) | [x] | §4 |
| 03 | [Handle domain rules & modules](./03-handle-domain-rules.md) | [x] | §5 |
| 04 | [Relocate `AnalysisContent` type](./04-analysis-content-relocation.md) | [ ] | §6.0 |
| 05 | [Onboarding session contracts](./05-onboarding-session-contracts.md) | [ ] | §6.0, §7.2 |
| 06 | [Onboarding session server primitives](./06-onboarding-session-server.md) | [ ] | §6.0, §7.2 |
| 07 | [Onboarding loader + claim-handle seed](./07-onboarding-loader-and-seed.md) | [ ] | §7.3 |
| 08 | [Onboarding step machine + wiring](./08-onboarding-step-machine.md) | [ ] | §7.1, §7.2 |
| 09 | [Handle server contracts](./09-handle-server-contracts.md) | [ ] | §6.0–§6.3 |
| 10 | [Onboarding completion gate](./10-onboarding-completion-gate.md) | [ ] | §6.4, §7.2 |
| 11 | [`ClaimHandleStep` UI](./11-claim-handle-step.md) | [ ] | §8 |
| 12 | [Settings & authenticated read surfaces](./12-settings-and-read-surfaces.md) | [ ] | §9.1, §9.2, §9.4 |
| 13 | [Public `/@handle` route](./13-public-handle-route.md) | [ ] | §9.3 |
| 14 | [`reset-onboarding` script](./14-reset-onboarding-script.md) | [ ] | §13.3 |
| 15 | [Tests & verification](./15-tests-and-verification.md) | [ ] | §14, §13.2 |

## Dependency notes

- **02** (migrations + `gen:types`) gates everything that reads `account.handle`.
- **04 → 05 → 06** is a hard chain: the type relocation unblocks the session
  contracts module, which unblocks the server session primitives.
- **03, 05, 06** all feed **07** (loader/seed) and **09** (handle server contracts).
- **08** (step machine) adds the order helpers (`isOnboardingStepBefore`, etc.)
  that **09** consumes, so do 08 before 09 even though plan §13.2 lists
  `account-handle.functions.ts` first. **10** is also sequenced after 08, but via
  a different coupling: `DevWorkflowPanel`'s `complete` navigation calls 10's
  `markOnboardingComplete()`, so 08 and 10 are co-edited (not an order-helper
  dependency).
- **11** (`ClaimHandleStep`) needs 03, 07, 08, 09, and 01 (preview URL helper).
- **15** (tests) is written alongside each task in practice; the consolidated
  checklist lives there and ends with `bun run test` + `bun run typecheck`.

## Out of scope in v0 (do not build)

Feature flag, handle-specific rate limiting, handle-specific analytics,
self-serve rename, generated-suggestion system, public liked-songs/jukebox data
on the `/@handle` page, runtime `analysisContentSchema` boundary parser.
