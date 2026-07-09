---
status: partial
updated: 2026-07-09
relates_to: ["tasks/15-load-test.md"]
---

# Account events load-test results — 2026-07-09

This records the production validation work run from the maintainer laptop plus
SSH access to the VPS.

## Environment

- Public gateway URL: `https://events.hearted.music/account-events/stream`
- Gateway host: Coolify-managed container on the VPS
- Gateway image/container observed during the run:
  `m13enxtkhj6mu08loswpdh0t:e8a8f0c5...`
- Temporary prod-only test change still active during these runs:
  per-account stream cap raised from `5` to `15000`
- Auth used: real signed event token for one real account/session

## What was exercised

### 1. Steady-state 10k tab hold

Run:

- `TARGET_TABS=10000`
- duration `30s`
- public HTTPS endpoint
- normal 5% reconnect churn from the script
- no forced mass reconnect
- no restart during this run

Observed result:

- ramp-up reached `10000` active clients
- run completed with `0` errors
- total reconnects: `246`
- total messages received: `560`

Representative script output:

- `Elapsed 0s: Active 10000, Errors 0`
- `Elapsed 25s: Active 10195, Errors 0`
- final: `Total Errors: 0`

## 2. Publish → browser delivery latency

Measured by holding a real SSE stream open, inserting an
`active_jobs_changed` outbox row directly, and timing until the stream received
that event.

### Baseline (no 10k background load)

- insert at `T0=1783618914154`
- event seen at `T1=1783618915380`
- measured latency: **`1226 ms`**

### During 10k public load

Background run:

- `TARGET_TABS=10000`
- duration `20s`

Latency probe during that run:

- insert at `T0=1783618944421`
- event seen at `T1=1783618945235`
- measured latency: **`814 ms`**

## 3. Reconnect storm

Run:

- `TARGET_TABS=10000`
- duration `55s`
- forced mass reconnect at `15s`

Observed result:

- `Elapsed 15s: Active 10123, Errors 0`
- immediately after storm: `Elapsed 20s: Active 9918, Errors 44`
- by `25s`: `Active 8420, Errors 3518`
- final: `Total Errors: 3518`

This shows the public path does **not** currently absorb a 10k all-at-once
reconnect storm cleanly.

## 4. Restart / drain behavior under load

A gateway container restart was triggered during load validation. Container logs
showed clean stop/start transitions:

- `gateway-shutdown-initiated`
- `gateway-stopped`
- `gateway-starting`

Timestamped examples from container logs:

- `2026-07-09T17:27:22.496Z gateway-shutdown-initiated`
- `2026-07-09T17:27:22.579Z gateway-stopped`
- `2026-07-09T17:27:23.755Z gateway-starting`
- `2026-07-09T17:29:30.662Z gateway-shutdown-initiated`
- `2026-07-09T17:29:30.721Z gateway-stopped`
- `2026-07-09T17:29:31.905Z gateway-starting`

On the public path, restart/drain combined with reconnect pressure produced
transient `502`, `503`, and `504` responses.

## 5. Origin memory / fd observations

During a steady-state 10k public run, sampled gateway-container metrics were:

| Timestamp | FDs | RSS | CPU | Docker memory |
| --- | ---: | ---: | ---: | ---: |
| start sample | 28 | 163424 kB | 51.08% | 140.3 MiB |
| mid-run samples | 347–355 | 185764–188268 kB | 0.36–1.50% | 141.2–143.8 MiB |

Raw samples captured:

```csv
ts,fd_count,rss_kb,established_3003,cpu_perc,mem_usage
2026-07-09T18:39:52+01:00,28,163424,,51.08%,140.3MiB / 7.568GiB
2026-07-09T18:40:00+01:00,347,188268,,0.39%,143.8MiB / 7.568GiB
2026-07-09T18:40:08+01:00,350,185764,,0.42%,141.3MiB / 7.568GiB
2026-07-09T18:40:15+01:00,348,185800,,0.36%,141.3MiB / 7.568GiB
2026-07-09T18:40:23+01:00,354,185988,,0.40%,141.2MiB / 7.568GiB
2026-07-09T18:40:30+01:00,355,185952,,1.50%,141.3MiB / 7.568GiB
2026-07-09T18:40:37+01:00,347,185916,,0.50%,141.2MiB / 7.568GiB
```

## Interpretation caveat

These origin-side fd numbers did **not** scale anywhere near 1:1 with 10,000
public clients. The most likely explanation is the production proxy chain
(Cloudflare + VPS proxying) terminates or multiplexes many client connections
before they reach the Bun gateway container.

That means this run **does validate the public end-to-end path at 10k tabs**,
but it does **not** yet prove per-tab file-descriptor cost on the Bun gateway
itself in the way Task 15 originally intended.

## What is now verified

- The public production path sustained **10,000 concurrent tabs for 20–30s**
  with **zero steady-state errors**.
- The gateway can still deliver account events during that load.
- Observed publish → browser latency was about **0.8–1.2s** in the runs above.
- Forced reconnect storms are a real weak point and currently generate many
  transient failures.
- Restart/drain behavior is visible and does interrupt some public requests.

## What is still not closed

The following Task 15 items are still open or only partially answered:

- clean per-connection fd cost on the Bun gateway itself
- exact heartbeat integrity accounting at target load
- publisher batch latency measurement
- `NOTIFY` volume measurement
- a reconnect-storm run that recovers cleanly
- a durable deploy-drain result with the exact production deployment path

## Bottom line

This is strong **partial** validation, not a full Task 15 closeout.

- **Steady-state 10k public-tab support:** validated
- **Reconnect-storm resilience:** not validated
- **Origin fd-per-tab capacity anchor:** not validated cleanly because of proxy
  termination/multiplexing in front of the gateway
