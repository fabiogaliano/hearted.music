---
status: proposed
updated: 2026-07-08
depends_on: ["03"]
---

# 10 — Producers: match snapshot + deck append events

Emit `match_snapshot_published`, `match_snapshot_failed`, and
`match_deck_appended`. Contract §2; proposal §8.2–8.3.

## Steps

- [ ] At the library-processing change-application boundary, emit
      `match_snapshot_published` `{ orientation, snapshotId }` when a refresh
      publishes, and `match_snapshot_failed`
      `{ orientation | null, snapshotId | null, reason }` when it fails —
      each in the same transaction as the state change
- [ ] In `src/worker/poll-match-deck-jobs.ts`, `append_sessions` arm: emit
      `match_deck_appended` `{ orientation, sessionId, snapshotId, appendedCount }`
      **only** when `outcome.kind === "applied" && appendedCount > 0`
- [ ] Tests: published/failed paths; append emits on applied-with-count and is
      silent on `appendedCount === 0` and non-applied outcomes

## Acceptance gate

- [ ] `bun run test` passes
- [ ] An applied append with `appendedCount > 0` yields exactly one
      `match_deck_appended` row with the contract payload
- [ ] `appendedCount === 0` and failure outcomes emit no deck event
- [ ] Failure path captures a useful `reason` string and tolerates null
      orientation/snapshotId

## Guardrails

- `match_deck_appended` is the parked-on-`/match` signal;
  `match_snapshot_published` fires too early for an open deck — don't merge or
  reorder them.
- `orientation` values come from the match-review-queue types, not new strings.
- Same-transaction outbox writes, as in task 09.
