---
status: proposed
updated: 2026-07-08
depends_on: ["06"]
---

# 07 — Gateway ops provisioning

The operational constraints that are part of the architecture, not post-build
tuning. Proposal §5.5.

## Steps

- [x] Set `LimitNOFILE=65535+` in the gateway's systemd unit / container spec
      (a shell `ulimit -n` does not persist for the service)
- [x] Configure the proxy in front of the gateway: `proxy_buffering off`,
      read-timeout compatible with the 20 s heartbeat
- [x] Verify the actual proxy chain (Coolify/nginx, and whether Cloudflare
      fronts the gateway host at all) and confirm 20 s sits under the shortest
      idle timeout; adjust within 15–25 s if needed
- [x] Document the Postgres connection budget: gateway LISTEN (1/instance) +
      publisher candidates + worker and app pools vs `max_connections`
- [x] Confirm gateway and publisher connections bypass transaction pooling
      (direct or PgBouncer session mode)
- [x] Graceful drain on deploy: stop accepting new streams, let clients
      reconnect with cursors (503 per contract §4.1)

## Acceptance gate

- [x] `cat /proc/<gateway-pid>/limits` shows the raised fd limit on the
      running service
- [x] `curl -N` through the full proxy chain shows frames flushing immediately
      and a stream idling past 60 s without a proxy kill
- [x] Connection budget is written down in this initiative folder
- [x] A deploy while a client is connected results in reconnect + cursor
      replay, not lost events

## Guardrails

- Never route `LISTEN` connections through transaction pooling — it silently
  breaks notification semantics.
- Heartbeat stays a comment frame (`: ping`), never a data event.
- Don't tune buffers/timeouts beyond what the verified proxy chain requires.
