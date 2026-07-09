---
status: partial
updated: 2026-07-09
relates_to: ["tasks/15-load-test.md"]
---

# Account events load-test status — 2026-07-09

This note records what is actually verified today for Task 15 and what is still
unproven.

## Audit evidence

- `scripts/ops/load-test-account-events.ts` exists and can open many authenticated
  SSE streams with reconnect churn.
- `main` currently includes commit `e8a8f0c5` (`temp: bypass stream limit for load test`),
  which temporarily changes `src/worker/account-events-gateway.ts` from a per-account
  cap of `5` concurrent streams to `15000`.
- At audit start, the repo contained no committed load-test results, no saved
  run log, and no durable metrics capture for a 10k run.
- No local `load-test-account-events` process was running at audit time.
- Since then, measured run results have been written to
  [`./load-test-results-2026-07-09.md`](./load-test-results-2026-07-09.md).
- Task 15 still does not have a full pass because some acceptance items remain
  open.

## Verified

- Functional auth path works in production for real account-event tokens.
- The gateway can verify the JWT, verify the backing session, and hold open SSE
  connections without immediate errors.
- A small smoke check already succeeded with 4 concurrent connections over a
  10-second window.
- The code path for a larger client-side load test is present.

## Not yet proven

- Clean memory and file-descriptor cost **per origin connection** on the target
  droplet, without proxy-layer multiplexing/termination distorting the count.
- Heartbeat integrity accounting at target load.
- Publisher batch latency and cluster `NOTIFY` volume at target load.
- Reconnect-storm behavior that recovers cleanly enough to pass.
- Deploy drain behavior captured through the exact production deployment path.

## Why Task 15 remains open

Task 15 requires measured capacity evidence, not just functional smoke coverage.
The existing evidence proves correctness of the auth + stream path, but not the
capacity claims from the spike.

## Required next run to close Task 15

Run the scripted load test in an environment where we can safely:

- sustain the 10,000 concurrent-tab anchor,
- measure fd count, memory, heartbeat survival, publish latency, batch latency,
  and `NOTIFY` volume,
- trigger a reconnect storm and a deploy drain,
- and save the results in this folder.

## Important caveat

Task 15's guardrail says to load-test against a staging DB, not production data.
A temporary production bypass of the per-account stream cap is not, by itself,
a completed or acceptable Task 15 result.