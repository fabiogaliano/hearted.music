---
status: proposed
updated: 2026-07-09
---

# Account events — task index

Build breakdown for [`proposal.md`](../proposal.md) against
[`contract.md`](../contract.md). One file per task; each carries ordered
steps, an acceptance gate, and guardrails. Check tasks off here, steps off in
the task files.

## All tasks

- [x] [01 — Shared contract module](./01-contract-module.md)
- [x] [02 — `account_event` outbox migration](./02-outbox-migration.md)
- [x] [03 — Event-write helper](./03-event-write-helper.md) *(needs 01, 02)*
- [x] [04 — Single-writer publisher](./04-publisher.md) *(needs 02)*
- [x] [05 — Event-token mint](./05-token-mint.md) *(needs 01)*
- [x] [06 — Bun fetch-SSE gateway](./06-sse-gateway.md) *(needs 01, 02, 04, 05)*
- [x] [07 — Gateway ops provisioning](./07-ops-provisioning.md) *(needs 06)*
- [x] [08 — `useAccountEvents` client hook](./08-client-hook.md) *(needs 01, 05; integrates against 06)*
- [x] [09 — Producers: enrichment events](./09-producers-enrichment.md) *(needs 03)*
- [x] [10 — Producers: match snapshot + deck append](./10-producers-match.md) *(needs 03)*
- [x] [11 — Shell switch: `useActiveJobs` + completion effects](./11-shell-switch.md) *(needs 06, 08, 09)*
- [x] [12 — Match route switch](./12-match-route-switch.md) *(needs 10, 11)*
- [x] [13 — Liked songs switch](./13-liked-songs-switch.md) *(needs 11)*
- [x] [14 — Worker NOTIFY wake-up parity](./14-worker-notify-parity.md) *(independent — any time)*
- [ ] [15 — Load test + capacity anchor](./15-load-test.md) *(needs 06, 07)*
- [ ] [16 — Billing events](./16-billing-events.md) *(later phase — after 01–13 are stable)*

## Parallelization

Tasks in the same wave have no dependencies on each other and can run as
parallel worktrees/agents. Task 14 is fully independent and can slot into any
wave with spare capacity.

| Wave | Tasks | Notes |
| --- | --- | --- |
| 1 | 01, 02 (+14) | Contract types and migration touch disjoint files |
| 2 | 03, 04, 05 | 03/04 build on the outbox; 05 only needs the types |
| 3 | 06, 08, 09, 10 | Gateway, client hook (against a stub stream), and both producer sets are mutually independent |
| 4 | 07, 11 | Ops hardening alongside the first polling switch; 11 is also 08's real integration test |
| 5 | 12, 13 | Both hang off 11 and touch different routes/features |
| 6 | 15 | Needs the deployed gateway; closes contract open decision 1 |
| later | 16 | Explicitly deferred to rollout phase 6 |

Critical path: **02 → 04 → 06 → 11 → 12/13**. Anything that shortens or
de-risks those five tasks pays off most; 05/08/09/10 have slack.

Two ordering caveats the waves hide: 08 can be *built* in wave 3 against a
mocked stream, but its acceptance gate only fully closes once 06 is
deployable; and 12 needs both 10 (producer) and 11 (shell), so if wave 3
slips on producers, 13 can still proceed.

## Guardrails (global — apply to every task)

- **`publish_id` is the only replay cursor.** Producer `id` never crosses any
  API boundary. Durable frames carry SSE `id:`; live frames never do.
- **`accountId` lives in the `account_id` column and the token `sub` — never
  in envelopes or payloads.** Stream scope comes from the verified token only.
- **At-least-once, not at-most-once.** Duplicates are expected and deduped
  client-side; a skipped event is a correctness bug.
- **NOTIFY is a wake-up hint.** Empty/tiny payloads, coalesced; the outbox +
  catch-up query is the truth. `LISTEN` connections never go through
  transaction pooling.
- **Every replaced poll survives as a disconnected-only fallback.** Consumer
  hook contracts stay byte-identical; only the data source underneath changes.
- **Contract wins.** Where `contract.md` and `proposal.md` disagree on a
  concrete shape, `contract.md` is authoritative.
- **Scope discipline.** `job_progress_changed`, BroadcastChannel leader
  election, and billing are explicitly deferred — don't build them early.
- Repo rules apply: bun + `bun run test` (Vitest), tests in `tests/`, no
  barrel exports, no DB-derived id sets as `.in()` filters, work on `main`.
