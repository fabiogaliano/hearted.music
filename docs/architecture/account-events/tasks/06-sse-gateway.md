---
status: proposed
updated: 2026-07-08
depends_on: ["01", "02", "04", "05"]
---

# 06 — Bun fetch-SSE gateway

`GET /account-events/stream` in the always-on Bun runtime family. Contract §1,
§3, §4.1, §4.3; proposal §5.2.

## Steps

- [ ] New gateway module (own port/route ownership; may share the worker
      container) serving `text/event-stream` with `Cache-Control: no-cache`
      and `X-Accel-Buffering: no`
- [ ] Auth: verify bearer signature + `exp` locally; connect-time `ver` check
      against the session's current version; response matrix per contract §4.1
      (401 / 403 / 429 concurrent-stream cap / 503 draining)
- [ ] Cursor: read `Last-Event-ID` header; replay
      `WHERE account_id = :sub AND publish_id > :cursor ORDER BY publish_id`
      with the envelope from contract §1.1 (`id:` = `publish_id` on durable
      frames only)
- [ ] On connect and after replay, send `active_jobs_snapshot` (no `id:`)
- [ ] `LISTEN account_event_wake` (one direct/session-pooled connection per
      instance) → per-account catch-up query for connected local clients
- [ ] Heartbeat comment frame `: ping\n\n` every 20 s
- [ ] Disable Bun's per-connection idle timeout on each stream
      (`server.timeout(req, 0)`, or a value well above the heartbeat) — `Bun.serve`
      closes idle sockets after ~10 s by default and a quiet SSE stream counts as
      idle, so this must be set *before* heartbeats can matter
- [ ] Flush each frame immediately: use `ReadableStream` direct mode
      (`controller.write()` + `controller.flush()`), not batched `enqueue`, so
      frames don't buffer inside Bun regardless of the `X-Accel-Buffering: no`
      proxy hint
- [ ] Mid-stream `exp`: send `event: token_expiring` with
      `{"reason":"token_expired"}`, then close; terminal errors send
      `event: error` with `{"code":...}` then close
- [ ] Bounded per-connection buffer; on overflow, close or force snapshot
      repair — never accumulate unbounded deltas
- [ ] Revoke path: listen on the internal revoke channel and close matching
      connections (proposal §6.2)
- [ ] Integration tests: auth matrix, replay ordering, durable-vs-live `id:`
      discipline, heartbeat cadence, expiry close, overflow behavior

## Acceptance gate

- [ ] `bun run test` passes for the full auth matrix and replay tests
- [ ] Reconnect with a cursor replays every durable event after it, in
      `publish_id` order, each frame carrying `id:`
- [ ] Live frames (snapshot/progress/control) never carry `id:`
- [ ] A stream is provably scoped to `token.sub` — no code path accepts an
      account id from the client
- [ ] Token expiry mid-stream produces `token_expiring` then a clean close
- [ ] A stream idling on heartbeats alone survives past Bun's default socket
      timeout (proves `server.timeout` was disabled), and `curl -N` shows each
      frame flushing individually, not in batches

## Guardrails

- The `account_id` filter in the replay query is non-optional and derived only
  from the verified token (contract §4.3 invariant 1).
- Connect-time-only `exp` validation is explicitly rejected — enforce mid-stream.
- The gateway lives in the Bun world; no part of connection fanout moves to
  the Cloudflare tier.
- Delivery is at-least-once: duplicates are fine, skips are bugs.
