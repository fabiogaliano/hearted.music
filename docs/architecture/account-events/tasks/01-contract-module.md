---
status: proposed
updated: 2026-07-08
depends_on: []
---

# 01 — Shared contract module

Create `src/lib/account-events/contract.ts` exporting the TypeScript contract
from [`contract.md`](../contract.md) so producers, publisher, gateway, and the
client hook all import one source of truth and cannot drift.

## Steps

- [ ] Confirm `src/lib/account-events/contract.ts` against module-boundary rules
      (contract.md §7.3 open decision); pick the final location before writing code
- [ ] Define `AccountEventType`, `AccountEventPayloadMap`, and
      `AccountEventEnvelope<T>` exactly as contract.md §1.1 / §2
- [ ] Re-export `ActiveJobsSnapshot` as a type alias of `ActiveJobs` from
      `src/lib/server/jobs.functions.ts` (type-only import — do not fork the shape)
- [ ] Reuse `MatchOrientation` from the match-review-queue types (type-only import),
      not a fresh union
- [ ] Define `EventTokenClaims` (contract.md §4.2)
- [ ] Define live-frame types (`active_jobs_snapshot`, `job_progress_changed`) and
      control-frame payloads (`token_expiring`, `error`) per contract.md §3
- [ ] Export shared constants: NOTIFY channel names (`account_event_inserted`,
      `account_event_wake`), heartbeat interval, cursor header name

## Acceptance gate

- [ ] `bun run typecheck` (or the project's check script) passes
- [ ] The module is importable from client code without pulling in server-only
      runtime deps (all cross-boundary imports are `import type`)
- [ ] `accountId` appears in **no** envelope or payload type
- [ ] No barrel export added

## Guardrails

- Types and constants only — no runtime logic lives here.
- Where contract.md and proposal.md disagree, contract.md wins (e.g. no inline
  `accountId` from proposal §8.3).
- `v` stays literal `1`; do not build a versioning framework.
