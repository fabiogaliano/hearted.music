---
status: research
updated: 2026-07-08
---

# Account events — transport & gateway-host decision spike

Status: **research spike** (decision-support input).
Consumes: none. Feeds: revision pass on `./proposal.md`.
Author role: distributed-systems / edge-infra research.
Compiled: 2026-07-08. Every quantitative claim carries an inline citation to the Sources section; figures that are derived or unverified are labeled **[EST]** (estimate/assumption) vs **[CITED]** (from a dated primary source).

This document does **not** modify the plan. It validates or refutes the plan's transport (SSE) and host (Bun-on-VPS) hypotheses with numbers, and gives explicit thresholds at which a different host would win.

---

## TL;DR recommendation

- **The evidence supports the plan's Bun + Postgres SSE gateway.** For a one-way, reconnect-with-cursor, server→browser feed it is the cheapest and most portable option, and it is the *only* option that satisfies the portability constraint without adding a second stateful control plane. Confidence: high on transport (SSE), high on host at the app's realistic scale.
- **SSE is the correct transport, not WebSockets.** SSE is plain HTTP (`text/event-stream`), rides HTTP/2 multiplexing (~100 concurrent streams/connection vs the HTTP/1.1 ~6-connection-per-origin cap), and has native reconnect + `Last-Event-ID` cursor replay built into the browser [S7][S9][S4]. WebSockets are only justified for bidirectional / low-latency-client→server / binary workloads — none of which this feed has [S7]. Use **fetch-based SSE, not native `EventSource`**, because `EventSource` cannot set an `Authorization` header (only `withCredentials` cookies) [S8], and header auth avoids putting the token in the URL, which RFC 9700 says clients **MUST NOT** do [S16].
- **Cost break-even vs Cloudflare Durable Objects:** a Bun VPS holding 10k concurrent connections costs **~$24–48/mo** [S28][EST]. Durable Objects **without** the Hibernation API cost **~$56/hr ≈ $40k/mo** at 10k connections held continuously — a ~1000× penalty driven by wall-clock GB-s duration billing [S5][S6]. **With** Hibernation, DO cost collapses to **cents/hr** because billing tracks message events, not idle connection wall-clock [S6]. So DOs only become cost-competitive *if* Hibernation is used — and even then they fail the portability constraint. **There is no connection-count threshold at which DOs beat the VPS on the fixed constraints;** the switch trigger is operational (see below), not cost.
- **Cost break-even vs managed pub/sub (Ably/Pusher):** self-hosting is **1–2 orders of magnitude cheaper** at 10k connections — **~$24–48/mo VPS** vs **~$499/mo Pusher flat** or **~$331–1,541/mo Ably** (Ably's connection-*minute* metering dominates even at low message rates) [S28][S31][S32]. Managed pub/sub also fails portability (vendor lock-in) except self-hosted Centrifugo/NATS, which are just "the VPS option with a different binary" [S33][S34].
- **When to switch off Bun-on-VPS:** the real ceilings are not cost, they are (a) **LISTEN/NOTIFY throughput** — a Postgres-global commit-serialization lock convoy has been observed in production at high NOTIFY write rates, with ~1s lock holds and 200+ backends queued [S12]; and (b) **single-box connection limits** — file-descriptor tuning and CPU/GC, not RAM. Concrete break-even guidance is in [§Break-even thresholds](#break-even-thresholds). Short version: switch the *fanout host* only above ~50k–100k concurrent connections **or** if you need multi-region edge-local latency; switch the *NOTIFY wake path* (not the whole design) if sustained event-write rate approaches ~hundreds–1k/sec cluster-wide.

---

## Constraints restated (fixed — the plan reasons within these)

1. **App tier:** TanStack Start on Cloudflare Workers. Stateless, no shared memory across isolates/instances.
2. **Job/worker tier:** always-on Bun process on a Coolify VPS, talks to Postgres directly.
3. **Database:** self-hosted Supabase (Postgres) on the same Coolify VPS (`supabase.hearted.music`) — **not** Supabase Cloud. Supabase Realtime is deliberately avoided for portability; infra cost is VPS-bound, not per-Supabase-usage.
4. **Portability:** the browser-push path must depend only on Postgres + `LISTEN`/`NOTIFY`, plain HTTP SSE, and app-issued tokens. No Supabase publications / RLS / JWT coupling in the core path.
5. **Push is one-way** (server→browser). Durable semantic events live in a Postgres `account_event` outbox; `NOTIFY` is a wake-up hint only, never the source of truth.
6. **Plan's current host hypothesis:** a Bun-hosted SSE gateway on the VPS. This spike treats that as a hypothesis to validate, not a given.

---

## Comparison tables

### Table 1 — Transport (one-way, reconnect-with-cursor)

| Dimension                     | SSE (fetch-based)                                       | SSE (native `EventSource`)                                   | WebSocket                                                               | Long-poll              |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------- |
| Wire protocol                 | Plain HTTP `text/event-stream` [S7]                     | Plain HTTP                                                   | HTTP Upgrade (RFC 6455); RFC 8441 for HTTP/2, partial support [S6a][S7] | Plain HTTP             |
| Proxy/CDN compatibility       | High                                                    | High                                                         | Variable — needs Upgrade at every hop [S7]                              | Highest                |
| HTTP/1.1 ~6-conn/origin cap   | Yes (1 slot/stream)                                     | Yes                                                          | N/A (own conn)                                                          | Less sticky (req/poll) |
| HTTP/2 multiplexing           | Yes — ~100 streams/conn (RFC 7540 §6.5.2 min 100) [S10] | Yes                                                          | **No** by default; needs extended CONNECT, inconsistent support [S6a]   | Yes                    |
| Native reconnect + cursor     | Manual (reimplement)                                    | **Yes** — auto-reconnect, `retry:`, `Last-Event-ID` [S7][S9] | Manual                                                                  | Manual                 |
| Custom `Authorization` header | **Yes** [S8]                                            | **No** — only `withCredentials`/cookies [S8]                 | No native header API in browser ctor                                    | Yes                    |
| Bidirectional / client→server | No                                                      | No                                                           | **Yes**                                                                 | No                     |
| Binary framing                | No (text)                                               | No                                                           | Yes                                                                     | No                     |
| Fit for this workload         | **Best**                                                | Good but blocked by header-auth need                         | Overkill / unjustified                                                  | Fallback only          |

**Verdict:** fetch n-based SSE. It keeps SSE's cursor-replay ergonomics conceptually (implemented manually) while enabling header auth, which native `EventSource` cannot do [S8]. This matches the plan's §6.1 choice.

### Table 2 — Gateway host

| Option | Portability constraint | Stateful coordination it forces | ~$/10k conns held 1 hr | ~$/10k conns/mo | Ops complexity | Wake→deliver latency |
|---|---|---|---|---|---|---|
| **Bun-on-VPS SSE gateway** | **Satisfied** (Postgres + HTTP + app tokens only) | None beyond Postgres; 1 LISTEN conn/instance, in-process fanout [S26] | ~$0.03–0.07 [S28][EST] | **~$24–48** [S28][EST] | Medium — you own fd/ulimit, drain, fanout | p50 low-ms (LISTEN → local write) [EST] |
| **CF Workers + Durable Objects** | **Fails** (couples fanout to CF DO control plane) | DO instances own connection state + fanout; a 2nd stateful plane beside Postgres | Naive: **~$56**; Hibernation: **~$0.009** [S5][S6] | Naive: **~$40k**; Hibernation: **cents** [S5][S6][EST] | High — DO lifecycle, hibernation correctness, CF↔Bun bridge | Edge-local, sub-ms fanout once event reaches DO [EST] |
| **Managed pub/sub — Ably** | **Fails** (vendor lock-in) | Vendor owns connection + fanout | — | **~$331–1,541** (conn-minute metered) [S31][EST] | Low (managed) | Vendor SLA (low, unpublished exact) |
| **Managed pub/sub — Pusher** | **Fails** (vendor lock-in) | Vendor owns connection + fanout | — | **~$499 flat** (Premium, 10k conns) [S32] | Low (managed) | Vendor SLA |
| **Centrifugo / NATS (self-hosted)** | **Satisfied** (OSS, self-hostable) | Same as VPS (its own binary + optional Redis for multi-node) | ~VPS cost | ~VPS cost [S33][S34] | Medium-high — another service to run | Low-ms [EST] |

Notes: DO "naive" = `accept()` bills GB-s for the entire connection lifetime [S6]; "Hibernation" = billing only on message events, idle-but-open connections stop accruing GB-s [S6]. Ably's cost is dominated by **connection-minutes** ($1/M list, $0.20/M floor) independent of message volume — 10k conns × 43,200 min/mo = 432M conn-min [S31].

### Table 3 — Postgres single-box connection economics

| RAM | @5 KB/conn (uWS, cited floor) [S23] | @16 KB/conn [EST] | @52 KB/conn (Socket.IO, cited) [S23] |
|---|---|---|---|
| 1 GB | 209,715 | 65,536 | 20,165 |
| 2 GB | 419,430 | 131,072 | 40,330 |
| 4 GB | 838,860 | 262,144 | 80,660 |

These are **memory-only upper bounds**. In practice CPU (serialization, event-loop wakeups, GC) and file-descriptor limits bind first — treat as ceilings, not targets. Each SSE connection = 1 fd; default soft `ulimit -n` is often **1024** and must be raised to 65535+ via systemd `LimitNOFILE` or `limits.conf` (a bare `ulimit -n` shell command does not persist for a service) [S22]. Postgres `LISTEN` cost is **O(gateway instances)**, not O(browser connections): one dedicated session-mode LISTEN connection per instance fans out in-process to all local clients; `max_connections` default is 100 [S26][S27]. LISTEN is **not** poolable through PgBouncer transaction mode [S25].

---

## Per-question findings

### Q1 — Transport: SSE vs WebSockets vs long-poll

- **Proxy/CDN compatibility.** SSE and long-poll are plain HTTP and pass through virtually any HTTP/1.1- or HTTP/2-aware intermediary with no protocol upgrade. WebSockets require `Connection: Upgrade` (RFC 6455) and need explicit support at every hop; some proxies/CDNs still mishandle it [S7].
- **HTTP/2 & HTTP/3 multiplexing.** Under HTTP/1.1 browsers cap concurrent connections per origin at ~6, so each open `EventSource` consumes one of those slots and a few tabs can starve other requests [S7]. HTTP/2 multiplexes all streams over one TCP connection; RFC 7540 §6.5.2 recommends `SETTINGS_MAX_CONCURRENT_STREAMS` ≥ 100, so dozens-to-hundreds of concurrent SSE streams per origin are fine [S10]. **WebSockets do not ride HTTP/2 multiplexing by default** — RFC 8441 "extended CONNECT" exists but intermediary support is inconsistent, so WS commonly falls back to its own HTTP/1.1 connection [S6a]. This is a real point in SSE's favor for a browser app: the multiplexing story is strictly better.
- **Reconnect/replay ergonomics.** SSE has this in the platform: the browser auto-reconnects, honors a server-sent `retry:` delay (ms), and re-sends the `Last-Event-ID` header carrying the last-seen id so the server resumes [S7][S9]. Long-poll and WS have no native cursor/reconnect concept — the app implements it. (For fetch-based SSE you also implement it manually, but the *protocol shape* — `id:` field + resume header — is standardized, so the client and server contract is well-trodden.)
- **Header-based auth.** Native `EventSource` accepts only `withCredentials` — **no** custom headers [S8]; the browser `WebSocket` constructor likewise has no header API. Fetch-based SSE (`fetch()` + `ReadableStream` parse of `text/event-stream`) can set `Authorization`, at the cost of reimplementing reconnect/backoff/Last-Event-ID [S8]. This is the decisive reason the plan's fetch-SSE choice (§6.1) is correct given header-token auth.
- **Per-connection overhead.** SSE/long-poll add minimal text framing over HTTP chunked transfer; WS adds a small binary frame header per message but enables binary + bidirectional. At the OS/socket level idle memory is dominated by TCP+TLS state, so SSE and WS are roughly equivalent per idle connection [S23][EST].
- **When WS is actually justified.** Genuinely bidirectional low-latency interaction (collaborative editing keystrokes, multiplayer state, voice/video signaling), binary payloads, or sub-frame round-trip latency [S7]. **None apply** to a server→browser cursor-replay feed. WS here would add handshake/proxy fragility and lose native reconnect for zero benefit.

### Q2 — Gateway host: Bun-on-VPS vs CF DO vs managed pub/sub

- **Bun-on-VPS.** Satisfies portability by construction — depends only on Postgres, HTTP, and app-issued tokens. Coordination stays in the one substrate that already exists (Postgres): each gateway instance holds one LISTEN connection and fans out in-process; no cross-instance in-memory coordination [S26]. This is the plan's §11 horizontal-scale story and it holds up.
- **CF Workers + Durable Objects.** Workers *can* stream SSE with no hard wall-clock cap on HTTP-triggered requests [S1], but the stateless app tier cannot *own* long-lived connection coordination — that is exactly what Durable Objects add, and adopting them introduces a **second stateful control plane beside Postgres** [plan §3]. That directly violates the portability constraint (fanout now depends on a CF-proprietary primitive) and is the architectural cost the plan already flags. DO can be made cheap *only* with the Hibernation API (Q3).
- **Managed pub/sub.** Ably/Pusher are turnkey and low-ops but fail portability (lock-in) and cost 1–2 orders of magnitude more than the VPS (Q3). **Centrifugo** and **NATS** are self-hostable OSS and *do* satisfy portability — but they are effectively "the VPS option with an extra binary + optional Redis for multi-node fanout" [S33][S34]. They become interesting only if you outgrow a single Bun process and want a purpose-built fanout tier rather than hand-rolling one; they are not warranted at the app's current scale.

### Q3 — Cost (central)

**Cloudflare Workers (streaming relevance).** HTTP-triggered requests have **no hard wall-clock duration cap** on free or paid — an SSE stream can stay open indefinitely [S1]. CPU billing **excludes I/O wait**, so an idle-streaming Worker costs ~0 CPU-ms; only serialization/encoding counts [S1][S2]. The "6 simultaneous connections" limit is **not** a concurrent-stream cap — as of the 2026-04-09 changelog it only limits outbound connections *awaiting response headers*, freed the instant headers arrive [S3]. Subrequests: 50 (free) / 10,000 (paid) per invocation [S1]. Pricing: free = 100k req/day, 10ms CPU/req; paid Standard = $5/mo, 10M req + 30M CPU-ms included, then $0.30/M req and $0.02/M CPU-ms [S2]. **Takeaway:** Workers can *emit* SSE cheaply, but this does not solve where connection state lives — that is the DO question.

**Durable Objects billing.** Billed on (1) requests (WS messages at 20:1), (2) **duration in GB-s** = active wall-clock seconds × 128 MB fixed / 1 GB ≈ 0.125 GB-s/s, (3) storage [S5]. Free tier (SQLite DOs): 100k req/day + **13,000 GB-s/day**, and overage **hard-fails** rather than billing [S5]. Paid: 1M req/mo then $0.15/M; 400k GB-s/mo then **$12.50/M GB-s** [S5]. Naive `accept()` bills GB-s for the **entire** connection lifetime; **Hibernation** stops GB-s accrual while idle (ping/pong does not wake it) [S6].

Worked example — hold N connections open for 1 hour (paid list price; assumptions labeled):

| Connections | Naive GB-s/hr | Naive $/hr | Free-tier (13k GB-s/day) exhausted in | Hibernated GB-s/hr [EST: 1 msg/conn/min × 10ms] | Hibernated $/hr |
|---|---|---|---|---|---|
| 1,000 | 450,000 | **$5.63** | ~104 s | 75 | **$0.001** |
| 10,000 | 4,500,000 | **$56.25** | ~10 s | 750 | **$0.009** |
| 50,000 | 22,500,000 | **$281.25** | ~2 s | 3,750 | **$0.047** |

Formula: naive = N × 3600 s × 0.125 GB-s/s × $12.50/1e6 [S5]. **Does it explode?** On **free tier, yes catastrophically** — 1k naive connections burn the entire daily GB-s allotment in <2 minutes and then error out (an outage, not a bill) [S5]. On **paid naive, yes** — ~$56/hr at 10k ≈ ~$40k/mo sustained. **With Hibernation, no** — cents/hr even at 50k, because cost tracks messages not idle wall-clock [S6][EST]. **Load-bearing conclusion:** Hibernation is *mandatory* for a cost-viable DO design at 10k+ idle-but-open connections; without it DOs are simply not a viable host for this workload.

**Bun-on-VPS ceiling & marginal cost.** Each SSE conn = 1 fd; raise soft `ulimit -n` from the common 1024 default to 65535+ via systemd/`limits.conf` [S22]. Idle memory: cited floor ~5 KB/conn (uWS), ~52 KB/conn (Socket.IO); **~16 KB/conn** is a defensible middle estimate for a plain `ReadableStream` SSE handler [S23][EST] — so 10k connections ≈ 160 MB, i.e. RAM is not the binding constraint; CPU/GC and fd limits are. Ephemeral-port exhaustion (~28,232 ports, range 32768–60999) constrains **outbound** connections only — an inbound SSE server accepts on one fixed port, uniquely keyed by client IP:port, so it is **not** the inbound ceiling [S24]. Postgres LISTEN cost is O(instances): 10k clients on one box = 1 LISTEN connection [S26]. Marginal cost: a DO 4 GB/2 vCPU droplet is **$24/mo** [S28] and comfortably holds ~10k real connections [EST]; the next +10k ≈ bump to 8 GB/4 vCPU (~$48/mo), i.e. **~$24–48/mo per additional 10k** [S28][EST]. (Hetzner CPX pricing is in flux after a June-2026 hike and is deliberately not cited as the baseline; the DO figure is clean and dated [S29][S30].)

**Managed pub/sub at the same tiers.** Ably Standard $29/mo base + usage; 10k conns held a full month = 432M connection-minutes → **$432/mo list / $86/mo floor** *before messages*; add ~$1,080/mo list ($216 floor) at 1 msg/conn/min ⇒ **~$331–1,541/mo total** [S31][EST]. Pusher Premium **$499/mo flat** for 10k conns / ~600M msgs/mo — the most predictable model [S32]. Centrifugo/NATS OSS = VPS cost only [S33][S34].

### Q4 — Postgres LISTEN/NOTIFY at scale

- **Payload limit:** NOTIFY payload must be **< 8000 bytes** — hard limit [S11]. This is a direct reason the plan is right to make NOTIFY a *wake-up hint* carrying at most a small key, with the real event body in the `account_event` row.
- **Queue:** the async notification queue is cluster-wide and ~**8 GB** in a standard install; if it fills, **transactions calling NOTIFY fail at commit**, and a warning is logged at half-full identifying the session blocking cleanup (typically a long-running txn holding a LISTEN open) [S11]. `pg_notification_queue_usage()` reports occupancy.
- **Many listeners / contention:** each LISTEN holds a backend connection for the session lifetime; NOTIFY delivery is serialized in commit order via a documented lock hierarchy (`NotifyQueueTailLock` → `NotifyQueueLock` → SLRU → partition locks) [S13]. A **dated production incident** (Recall.ai, pub. 2025-07-01, upd. 2026-05-08) documents this becoming a database-instance-wide `AccessExclusiveLock` that serialized *all* commits under load — 200+ backends queued, one lock hold observed ~1016 ms, CPU/IO visibly dropping (global-lock convoy). They mitigated via a later Postgres core commit and ultimately migrated off LISTEN/NOTIFY at tens-of-thousands-of-simultaneous-writers scale [S12].
- **Single-connection throughput:** no authoritative dated micro-benchmark found. Community consensus puts comfortable sustained throughput in the **hundreds/sec**, with serialization effects near **~1,000/sec** cluster-wide — this is a *cluster* ceiling (commit-order lock), not a per-connection number [S14][EST].
- **Missed-notification semantics:** NOTIFY delivers only to sessions **currently** LISTENing; registrations exist only while the connection is open and clear at session end [S11][S15]. A client that is disconnected/reconnecting/not-yet-connected at NOTIFY time **never** receives that event, and nothing is queued for it. **This is exactly why the durable outbox + monotonic cursor replay (`WHERE id > :last_seen`) is required** for at-least-once delivery — NOTIFY is a "wake up and go check" signal, never the record of what happened. The plan's §5.1/§7 design is correct on this point.

### Q5 — Reconnect/replay correctness

- **Last-Event-ID:** the browser auto-sends the last received `id` on reconnect for native `EventSource`; a bare `id:` with no value resets the buffer [S7][S9]. For fetch-based SSE you track and attach it manually — so the plan must implement cursor tracking in the hook (plan §5.3/§6.3 already say this).
- **BIGSERIAL out-of-order-commit gotcha [important, under-specified in the plan]:** `nextval()` is assigned at INSERT-statement time, not at commit. Transaction A can take id=4 and B take id=5, and **B can commit before A**. A reader running `WHERE id > last_cursor` between B's and A's commits sees id=5, advances the cursor past 4, and **permanently skips row 4** once it commits [S17]. This is a well-known keyset-pagination-gap class, not folklore [S18][S19]. **Mitigations:** (a) **safety lag** — only replay events older than N ms/sec so in-flight txns commit first (cheapest, most common); (b) advisory-lock visibility ceiling computed from `pg_locks` (no fixed delay, more complex); (c) **durable outbox drained by a single writer** so there is one linearizable publish order [S17]. The plan's monotonic-`id > last_seen` replay (§5.1) is correct *only if* one of these mitigations is added — **this is the single most important correctness item the plan should resolve before build.**
- **Horizontal fanout without sticky routing:** because replay is driven from Postgres by cursor (not instance-local buffers), any gateway instance can serve any client; duplicate delivery across instances is possible and the **client must dedupe by event id** (at-least-once + idempotent consumer) [S17][EST]. The plan's §11.3 reasoning is sound.

### Q6 — Auth: short-lived bearer tokens for fetch-SSE

- **Lifetime:** RFC 6749 mandates no numeric lifetime (only `expires_in`) [S16a]. RFC 9700 (BCP, Jan 2025) recommends short access-token expiry — commonly summarized as 5–15 min for sensitive APIs, 30–60 min general [S16][EST on exact minutes]. The plan's 5-min `exp` (§6.2) is squarely in range.
- **Revocation:** JWTs are stateless — a valid signature + live `exp` is accepted, so no built-in pre-expiry revocation. Mitigations in cost order: short `exp` (free), `jti` denylist (per-request lookup — undoes much of JWT's point), and a **session/token-version claim checked once at connect** (one DB row bump revokes all tokens; cheap because checked at connect, not per event) [S20][S21]. The plan's optional session identifier (§6.2) maps to the version-claim pattern — recommend making it explicit.
- **Reconnect / mid-stream expiry:** the token can expire *during* a long stream. Options: (a) server enforces `exp`, closes with a reconnect hint, client re-mints + reconnects with `Last-Event-ID` — safe, adds churn; (b) validate only at connect, let the stream outlive `exp` — simpler, but a revoked credential keeps a live stream unless a session-version broadcast can kill it out-of-band [EST/design]. **Recommend (a)** as default since expiry is a security boundary, with a server-side "close matching connections" path for instant revoke.
- **Edge/Cloudflare gotcha:** RFC 9700 says clients **MUST NOT** pass access tokens in a URI query parameter (they leak into history, proxy/CDN logs, referrer) [S16]. Native `EventSource` forces query-string tokens (no header API) — a concrete reason to use fetch-SSE with an `Authorization` header. (Cloudflare-logs-query-strings-by-default is a reasonable inference, not a cited doc [EST].)

### Q7 — Failure modes / operational risk (recommended option: Bun-on-VPS SSE)

- **Idle-connection timeouts on intermediaries:** nginx `proxy_read_timeout` default **60 s** kills an idle upstream (also disable `proxy_buffering` so events flush) [S35]; Cloudflare enforces ~**100 s** idle → HTTP **524** [S36][EST: community-sourced, not a first-party doc]. **Mitigation:** heartbeat comment pings (`: ping\n\n`) every ~15–30 s, well under the shortest hop's window.
- **Load-shedding / backpressure:** slow consumers grow unbounded server-side buffers (memory risk). Use bounded per-connection buffers; on overflow, **do not keep patching deltas** — force the client into snapshot-repair (detect id/seq gap → full-state REST fetch) [S37]. This exactly matches the plan's §7.2 "next snapshot repairs the cache" rule.
- **Deploy/restart draining:** on graceful shutdown, stop accepting new work and let clients reconnect with their cursor. The EventSource `retry:` field sets base reconnect delay; the spec permits (not requires) exponential backoff [S7]. For mass-restart thundering herds, layer **jittered exponential backoff** in the client so dropped clients don't retry in lockstep [S38]. The plan's §5.3 "reconnects with backoff" should specify *jittered* backoff explicitly.

---

## Break-even thresholds

Explicit triggers for the revision pass to encode. Stay on Bun-on-VPS SSE **unless** one of these fires:

1. **Concurrent connections > ~50k–100k on a single box.** Below this, one tuned VPS (fd limit raised, ~16 KB/conn) holds the load with RAM to spare [S23][EST]; CPU/GC binds before memory. Above it, move to multiple gateway instances (the design already supports this, §11) *before* considering a different host. A purpose-built fanout tier (Centrifugo/NATS, still portable) is the first escalation — **not** Durable Objects or managed pub/sub.
2. **Sustained event-write rate approaching ~hundreds–1k NOTIFY/sec cluster-wide.** This is where the global commit-serialization lock convoy appears [S12][S14][EST]. Mitigation is *not* changing the transport or host — it is **debouncing/coalescing NOTIFY** (one wake per account per short window) and relying on the cursor catch-up query to batch-deliver, keeping NOTIFY volume far below the ceiling. Only if coalesced NOTIFY still saturates would you replace the wake path (e.g. a Redis/NATS signal), keeping the Postgres outbox as source of truth.
3. **Multi-region edge-local latency becomes a product requirement.** A single VPS is one region. If connections must terminate near users globally with sub-50ms fanout, that is the *one* scenario where Cloudflare Durable Objects' edge placement is a genuine advantage — and even then only with the Hibernation API for cost viability [S6], and accepting the portability trade-off. This is an explicit constraint-relaxation decision, out of scope for the current fixed constraints.

**There is no pure cost threshold at which DOs or managed pub/sub beat the VPS under the fixed constraints** — the VPS is cheaper at every tier examined (Table 2). The switch is always driven by scale-ceiling or latency-geography, never by price.

---

## Open questions / unknowns the plan must resolve before build

1. **Out-of-order commit safety (highest priority).** Choose a mitigation for the BIGSERIAL replay gap [S17]: safety-lag window, advisory-lock ceiling, or single-writer outbox drain. Without one, `id > last_seen` replay can silently drop events. Recommend: single-writer publish or a small safety lag, whichever fits the write path.
2. **NOTIFY coalescing policy.** Define debounce granularity (per-account, per-channel, per N ms) so the design stays well under the ~hundreds/sec lock-convoy zone [S12]. The outbox makes this safe (catch-up query batches), but the policy must be explicit.
3. **Mid-stream token expiry behavior.** Decide (a) close-on-expiry + reconnect vs (b) connect-time-only validation + out-of-band revoke [S16][S20]. Recommend (a) plus a server-side "close matching connections" revoke path.
4. **Heartbeat interval vs intermediary timeouts.** Pin a ping interval (~15–25 s) validated against the actual Coolify/nginx/Cloudflare chain in front of the gateway [S35][S36]. Confirm whether Cloudflare fronts the gateway host at all (if the gateway is on a bare VPS subdomain, the ~100s CF 524 may not apply).
5. **fd/ulimit provisioning.** Bake `LimitNOFILE=65535+` into the systemd unit / container spec; a shell `ulimit` will not persist for the service [S22].
6. **PgBouncer topology.** The gateway's LISTEN connection must bypass transaction-mode pooling (session mode or direct) [S25]; confirm the connection budget against `max_connections` (default 100) given worker + gateway + app pools share the box [S27].
7. **Single-box connection ceiling for *this* app.** The 16 KB/conn and "10k comfortable" figures are estimates [S23][S28][EST] — validate with a load test on the target droplet before assuming headroom.
8. **Exact Cloudflare timeout in front of the gateway.** The 100s/524 figure is community-sourced [S36][EST] — verify against a first-party Cloudflare doc or a direct test if CF proxies the gateway.

---

## Sources

All retrieved 2026-07-08. **[CITED]** = dated primary/official source; **[EST]** = estimate/assumption or secondary-source paraphrase, flagged at point of use above.

Cloudflare:
- [S1] Workers Platform Limits — https://developers.cloudflare.com/workers/platform/limits/ — CPU/subrequest/duration/connection limits; no wall-clock cap on HTTP requests. [CITED]
- [S2] Workers Pricing — https://developers.cloudflare.com/workers/platform/pricing/ — request & CPU-ms pricing, CPU excludes I/O wait, free vs paid. [CITED]
- [S3] Relaxed simultaneous connection limiting changelog, 2026-04-09 — https://developers.cloudflare.com/changelog/post/2026-04-09-relaxed-connection-limiting/ — the 6-conn limit applies only pre-header-arrival. [CITED]
- [S5] Durable Objects Pricing — https://developers.cloudflare.com/durable-objects/platform/pricing/ — GB-s formula (seconds × 128 MB / 1 GB), free (13k GB-s/day, hard-fail overage) & paid ($12.50/M GB-s, $0.15/M req), 20:1 WS message ratio. [CITED]
- [S6] Durable Objects WebSockets / Hibernation — https://developers.cloudflare.com/durable-objects/best-practices/websockets/ — `accept()` bills for full connection lifetime; Hibernation stops GB-s accrual while idle; ping/pong doesn't wake. [CITED]

Transport / specs:
- [S6a] RFC 8441 Bootstrapping WebSockets with HTTP/2 — https://www.rfc-editor.org/rfc/rfc8441.html — extended CONNECT; partial intermediary support. [CITED]
- [S7] HTML Standard — Server-sent events (WHATWG) — https://html.spec.whatwg.org/multipage/server-sent-events.html — SSE wire format, auto-reconnect, `retry:` field, Last-Event-ID, id-reset semantics; WS Upgrade context. [CITED]
- [S8] MDN — EventSource() constructor — https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource — only `withCredentials`, no custom-header support. [CITED]
- [S9] MDN — Using server-sent events — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events — Last-Event-ID / reconnect behavior. [CITED]
- [S10] RFC 7540 HTTP/2 §6.5.2 — https://www.rfc-editor.org/rfc/rfc7540.html — SETTINGS_MAX_CONCURRENT_STREAMS recommended min 100. [CITED]

Postgres:
- [S11] PostgreSQL Docs — NOTIFY — https://www.postgresql.org/docs/current/sql-notify.html — <8000-byte payload, ~8GB cluster queue, fail-at-commit when full, delivery only to currently-listening sessions. [CITED]
- [S12] Recall.ai — "Postgres LISTEN/NOTIFY does not scale" (pub. 2025-07-01, upd. 2026-05-08) — https://www.recall.ai/blog/postgres-listen-notify-does-not-scale — dated incident: instance-wide lock, 200+ queued backends, ~1016ms hold. [CITED — dated benchmark/incident]
- [S13] postgres/postgres src/backend/commands/async.c — https://github.com/postgres/postgres/blob/master/src/backend/commands/async.c — NotifyQueueLock/TailLock/SLRU lock hierarchy. [CITED — source]
- [S14] Community (pgdog.dev, tapoueh.org) — "hundreds–~1k/sec" directional throughput. [EST — secondary]
- [S15] PostgreSQL Docs — LISTEN — https://www.postgresql.org/docs/current/sql-listen.html — registration cleared at session end. [CITED]

Auth:
- [S16] RFC 9700 Best Current Practice for OAuth 2.0 Security — https://datatracker.ietf.org/doc/html/rfc9700 — short-lived tokens; MUST NOT pass tokens in URI query param. [CITED; exact "5–15 min" figure EST/paraphrase]
- [S16a] RFC 6749 OAuth 2.0 — https://datatracker.ietf.org/doc/html/rfc6749 — `expires_in`, no mandated lifetime. [CITED]
- [S20] SuperTokens — JWT blacklist / revocation — https://supertokens.com/blog/revoking-access-with-a-jwt-blacklist — jti denylist mechanics. [EST — practitioner consensus]
- [S21] OneUptime — Handling JWT revocation — https://oneuptime.com/blog/post/2026-02-02-jwt-revocation/view — version-claim revoke-all. [EST — practitioner consensus]

Replay correctness:
- [S17] Sequin — "Postgres sequences can commit out-of-order" — https://blog.sequinstream.com/postgres-sequences-can-commit-out-of-order/ — mechanism + advisory-lock/single-writer mitigations. [CITED]
- [S18] Cybertec — Gaps in sequences in PostgreSQL — https://www.cybertec-postgresql.com/en/gaps-in-sequences-postgresql/ — nextval not rolled back. [CITED]
- [S19] Stacksync — keyset pagination gaps from non-monotonic commit order — https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable — corroborates skip risk. [CITED — secondary]

Self-host ceilings & VPS pricing:
- [S22] ulimit / limits.conf — https://www.commandinline.com/ulimit-linux-resource-limits/ , https://wiki.archlinux.org/title/Limits.conf — soft nofile default 1024; persist via systemd/limits.conf. [CITED]
- [S23] Evil Martians — benchmarking 5 WebSocket servers for Node.js — https://evilmartians.com/chronicles/choose-your-fighter-benchmarking-5-websocket-servers-for-nodejs — ~5 KB (uWS) vs ~52 KB (Socket.IO) per idle conn. [CITED]
- [S24] Ephemeral port range — https://en.wikipedia.org/wiki/Ephemeral_port , https://www.dell.com/support/kbdoc/en-us/000154992/ — 32768–60999; constrains outbound not inbound. [CITED]
- [S25] pgbouncer#655 — https://github.com/pgbouncer/pgbouncer/issues/655 — LISTEN unsupported in transaction pooling. [CITED]
- [S26] jpcamara — "PgBouncer is useful…" — https://jpcamara.com/2023/04/12/pgbouncer-is-useful.html — session-mode requirement for LISTEN; in-process fanout implication. [CITED]
- [S27] PostgreSQL Docs — Connections and Authentication — https://www.postgresql.org/docs/current/runtime-config-connection.html — max_connections default 100. [CITED]
- [S28] DigitalOcean Droplet Pricing — https://www.digitalocean.com/pricing/droplets — $24/mo 4GB/2vCPU. [CITED; "holds 10k real conns" EST]
- [S29] Hetzner price adjustment notice — https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ — June 2026 CPX hike. [CITED — flagged in-flux]
- [S30] Northflank — Hetzner price increases 2026 — https://northflank.com/blog/hetzner-cloud-server-price-increases — 2.4x–3.1x detail. [CITED — secondary]

Managed pub/sub:
- [S31] Ably Pricing — https://ably.com/pricing — tiers, connection-minute/message rates. [CITED; monthly total EST]
- [S32] Pusher Channels Pricing — https://pusher.com/channels/pricing/ — Premium $499/mo, 10k conns flat. [CITED]
- [S33] Centrifugo — https://github.com/centrifugal/centrifugo , https://centrifugal.dev/pro — OSS self-hostable vs PRO. [CITED]
- [S34] Synadia Cloud Pricing — https://docs.synadia.com/cloud/pricing — NATS tiers; connection semantics ≠ browser SSE. [CITED]

Operational failure modes:
- [S35] Baeldung — NGINX timeouts — https://www.baeldung.com/linux/nginx-timeouts — proxy_read_timeout default 60s. [CITED]
- [S36] Cloudflare Community — 100s timeout / 524 — https://community.cloudflare.com/t/timeout-100second-cloudflare/585797 — ~100s idle → 524. [EST — community, not first-party doc]
- [S37] MVP Factory — backpressure-aware SSE reconnection — https://mvpfactory.io/blog/backpressure-aware-sse-reconnection-in-mobile-clients-eventsource-gaps/ — bounded buffer + gap→snapshot-repair. [EST — practitioner]
- [S38] Medium (Navoznova) — jittered exponential backoff for SSE — https://medium.com/andersen-it-community/how-i-stopped-503-spam-in-sse-fetch-event-source-exponential-backoff-jitter-14f36b357e6d — reconnect-storm mitigation. [EST — practitioner]
