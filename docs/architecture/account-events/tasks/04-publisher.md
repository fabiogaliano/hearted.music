---
status: done
updated: 2026-07-08
depends_on: ["02"]
---

# 04 — Single-writer publisher

The publish-order step that assigns `publish_id` after commit visibility —
the chosen mitigation for BIGSERIAL out-of-order-commit replay gaps.
Proposal §5.1 publisher behavior, §11.2.

## Steps

- [x] New worker-family module (sibling of `src/worker/*` loops) with a
      `LISTEN account_event_inserted` connection plus a short fallback poll
      (missed notifications only add latency)
- [x] Publish batch, all on **one** connection in **one** transaction:
      `pg_try_advisory_xact_lock(...)` (skip the cycle if not acquired), claim
      `WHERE publish_id IS NULL` with `FOR UPDATE SKIP LOCKED ORDER BY id`,
      assign `publish_id = nextval('account_event_publish_seq')` and
      `published_at = clock_timestamp()`, commit
- [x] After commit, emit coalesced `NOTIFY account_event_wake`: at most one per
      100–250 ms window regardless of dirty account count; payload empty or a
      tiny `{minPublishId,maxPublishId}` hint
- [x] Restart safety: on boot, any candidate simply resumes from
      `publish_id IS NULL` rows — no state handoff
- [x] Wire the publisher's connections (LISTEN + publish txn) as direct or
      session-pooled, never transaction-pooled
- [x] Tests: two staged out-of-order commits get monotonically increasing
      `publish_id`s with no skips; two concurrent publisher candidates produce
      no duplicate or missing `publish_id`; wake NOTIFYs coalesce

## Acceptance gate

- [x] `bun run test` passes, including the out-of-order-commit scenario
- [x] `publish_id` order matches producer `id` order within a batch and is
      gapless per assignment run
- [x] Killing a publisher mid-batch leaves rows claimable by another candidate
      (verified in test via txn abort)
- [x] Wake channel emits ≤ 1 NOTIFY per debounce window under a burst of inserts

## Guardrails

- The advisory lock must be transaction-scoped **on the same connection** as
  the publish transaction; a session lock on another connection reintroduces
  the skip bug on `publish_id` (proposal §5.1).
- `try`-lock, not blocking lock: idle candidates skip, they don't queue.
- Never put event bodies in NOTIFY payloads (8000-byte hard limit; hint only).
- Do not build the safety-lag alternative "just in case" — single-writer is
  the decided mitigation.
