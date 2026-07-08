---
status: proposed
updated: 2026-07-08
depends_on: ["01", "05"]
---

# 08 — `useAccountEvents` client hook

Fetch-based SSE client with cursor, dedupe, jittered backoff, and the
invalidation map. Contract §5; proposal §5.3, §6.3. Buildable against a stub
stream before the gateway (06) lands; final integration needs 06.

## Steps

- [ ] Fetch-based SSE parser (`Accept: text/event-stream`,
      `Authorization: Bearer`, explicit `Last-Event-ID` header) — no native
      `EventSource`
- [ ] Mint token via task 05's server fn, connect, parse frames into the
      contract envelope; ignore unknown `type`s and comment frames
- [ ] Cursor: in-memory only, advanced monotonically on durable frames only;
      drop `publishId <= lastSeen`
- [ ] Reconnect: full-jitter exponential backoff (base 500 ms–1 s, cap ~30 s,
      reset after stable connection); on 401/`token_expiring` re-mint then
      reconnect with cursor; on 403 stop and surface re-auth; on 429/503 back
      off with jitter
- [ ] Expose connection state so fallback polls (tasks 11–13) know when to run
- [ ] Implement the invalidation map from contract §5.6 as the single
      event→React Query dispatch point
- [ ] Clean teardown on logout / shell unmount (abort fetch, clear timers)
- [ ] Unit tests with a mocked stream: dedupe, cursor monotonicity, live
      frames not advancing the cursor, unknown-type tolerance, backoff jitter
      bounds, 403 stop

## Acceptance gate

- [ ] `bun run test` passes for all mocked-stream scenarios
- [ ] Replaying the same durable frame twice produces exactly one cache action
- [ ] A live frame arriving between durable frames never moves the cursor
- [ ] After `token_expiring`, the hook reconnects with the pre-close cursor
      and misses nothing (verified against stub replay)
- [ ] Skills check: implementation reviewed against `tanstack-start-react` and
      `react-best-practices` patterns

## Guardrails

- Cursor lives in memory for the tab's lifetime only — never `localStorage`
  (contract §5.1 rationale).
- One stream per tab; `BroadcastChannel` leader election is explicitly
  deferred — do not build it.
- `job_progress_changed` is phase 2+: tolerate the frame, but build nothing on
  it yet (contract §7.2).
- Unknown event types are ignored, never errors.
