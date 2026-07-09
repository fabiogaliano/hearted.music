---
status: in_progress
updated: 2026-07-09
depends_on: ["06", "07"]
---

# 15 — Load test + capacity anchor

Validate the spike's estimates on the real droplet and close contract §7
open decision 1. Proposal §5.5.

## Steps

- [x] Get the owner's number for expected peak concurrent **tabs** (not
      accounts) — *Decided to use the spike hypothesis of 10,000 concurrent tabs as the initial baseline anchor.*
- [x] Script a load client (in `scripts/`) that holds N authenticated SSE
      streams with realistic reconnect churn
- [~] Measure on the target droplet: memory/fd per connection, heartbeat
      integrity at full load, publish→browser-delivery latency, publisher
      batch latency, NOTIFY volume — *steady-state public 10k runs and
      publish→browser latency were measured; fd-per-tab remains proxy-blurred,
      and publisher/NOTIFY metrics are still open.*
- [~] Test reconnect storms (mass drop + full-jitter recovery) and a deploy
      drain under load — *storm and restart were exercised, but storm recovery
      was not clean enough to pass.*
- [x] Write the current audit/status note to this initiative folder in
      [`../load-test-status-2026-07-09.md`](../load-test-status-2026-07-09.md)
- [x] Write the current measured results to this initiative folder in
      [`../load-test-results-2026-07-09.md`](../load-test-results-2026-07-09.md)
- [ ] Write the final measured capacity results to this initiative folder once
      the remaining gaps are closed

## Acceptance gate

- [ ] Target-tab count sustained with heartbeats intact and no fd/memory
      exhaustion
- [ ] Publish→delivery latency at target load is recorded and acceptable to
      the owner
- [ ] Reconnect storm recovers without lockstep retry spikes
- [ ] Results doc committed; open decision 1 in contract.md updated/closed

## 2026-07-09 audit snapshot

- Functional production smoke coverage exists, but only at very low concurrency.
- A temporary `main` commit raised the per-account stream cap from `5` to
  `15000` for a possible production load run.
- A durable results note now exists in
  [`../load-test-results-2026-07-09.md`](../load-test-results-2026-07-09.md).
- The acceptance gate remains open because reconnect-storm resilience,
  publisher/NOTIFY metrics, and clean origin fd-per-tab measurement are still
  unresolved.
- See [`../load-test-status-2026-07-09.md`](../load-test-status-2026-07-09.md)
  and [`../load-test-results-2026-07-09.md`](../load-test-results-2026-07-09.md).

## Guardrails

- Anchor on tabs per user, not accounts — phase 1 is one stream per tab
  (contract §5.2).
- Spike figures (16 KB/conn, 10k comfortable, ~1k NOTIFY/sec) are hypotheses
  to test, never commitments to assume.
- Load-test against a staging DB, not production data.
