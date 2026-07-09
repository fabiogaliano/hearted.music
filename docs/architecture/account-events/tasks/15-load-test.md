---
status: proposed
updated: 2026-07-08
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
- [ ] Measure on the target droplet: memory/fd per connection, heartbeat
      integrity at full load, publish→browser-delivery latency, publisher
      batch latency, NOTIFY volume
- [ ] Test reconnect storms (mass drop + full-jitter recovery) and a deploy
      drain under load
- [ ] Write results to this initiative folder (per repo convention, analysis
      notes could start in `claudedocs/` but the durable record lives here)

## Acceptance gate

- [ ] Target-tab count sustained with heartbeats intact and no fd/memory
      exhaustion
- [ ] Publish→delivery latency at target load is recorded and acceptable to
      the owner
- [ ] Reconnect storm recovers without lockstep retry spikes
- [ ] Results doc committed; open decision 1 in contract.md updated/closed

## Guardrails

- Anchor on tabs per user, not accounts — phase 1 is one stream per tab
  (contract §5.2).
- Spike figures (16 KB/conn, 10k comfortable, ~1k NOTIFY/sec) are hypotheses
  to test, never commitments to assume.
- Load-test against a staging DB, not production data.
