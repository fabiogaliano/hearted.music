---
status: done
updated: 2026-07-08
depends_on: ["01", "02"]
---

# 03 — Event-write helper

A small typed helper producers call inside their own transactions to write a
durable `account_event` row (with `publish_id` NULL) and wake the publisher.
Proposal §5.4.

## Steps

- [x] `writeAccountEvent(tx, { accountId, type, payload })`, generic over
      `AccountEventType` so `payload` typechecks against `AccountEventPayloadMap`
- [x] Insert the row with `publish_id = NULL` inside the caller's transaction
- [x] Emit empty `NOTIFY account_event_inserted` in the **same** transaction
      (channel name constant from task 01)
- [x] Make it callable from both the Bun worker and app-tier DB paths (billing
      later writes from the app tier); keep it dependency-light
- [x] Unit/integration test in `tests/` covering insert-within-txn and rollback
      (rolled-back txn leaves no row and no notify)

## Acceptance gate

- [x] `bun run test` passes with the new tests
- [x] A wrong payload shape for a given `type` is a compile error
- [x] Row lands with `publish_id IS NULL` and `payload` matching the contract
- [x] Rollback of the caller's transaction emits no notification (NOTIFY is
      transactional)

## Guardrails

- Never assign `publish_id` here — that is exclusively the publisher's job.
- NOTIFY payload stays empty: it is a wake-up hint, never an event body.
- `accountId` goes in the `account_id` column only, never inside `payload`.
