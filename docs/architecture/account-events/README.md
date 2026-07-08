# Account events

Portable, account-scoped browser-push system that replaces polling for
background-job freshness, keeping Postgres as the source of truth and avoiding a
hard dependency on Supabase Realtime.

**Status: proposed** — validated by the transport/host spike, hardened for build,
not yet implemented.

## Documents

| Doc | Status | What it is |
| --- | --- | --- |
| [`research.md`](./research.md) | research | Transport (SSE vs WS) + gateway-host (Bun-on-VPS vs Durable Objects vs managed pub/sub) decision spike, with cited cost/scale thresholds |
| [`proposal.md`](./proposal.md) | proposed | The build-ready design: `account_event` outbox, single-writer `publish_id` cursor, coalesced `NOTIFY`, Bun fetch-SSE gateway, rollout plan |
| [`tasks/`](./tasks/README.md) | proposed | Build breakdown: 16 ordered tasks with per-task acceptance gates, guardrails, and a parallelization/wave map |

## Reading order

Start with `proposal.md` for the decision and the plan; drop into `research.md`
when you want the evidence behind a specific choice (it carries the `[spike Qn]`
/ `[spike Sn]` references cited throughout the proposal).

## Lifecycle

When this work is accepted and built, add a short `decision.md` (an ADR: what was
decided and why) and flip this folder's status to `accepted`. Keep `research.md`
and `proposal.md` as the historical record — don't delete them.
