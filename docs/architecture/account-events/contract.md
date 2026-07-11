---
status: proposed
updated: 2026-07-08
---

# Account events — build contract

Status: **proposed** — the buildable interface for the design in
[`proposal.md`](./proposal.md). This is what producer, gateway, and client code
is written *against*. It fixes the wire format, the event payloads, the endpoint
behavior, and the client rules. Where this doc and `proposal.md` disagree on a
concrete shape, **this doc wins** and the divergence is called out inline.

TypeScript is the source of truth for every payload. The interfaces below are
the contract; the migration and runtime code must match them, and a shared
module (proposed `src/lib/account-events/contract.ts`) should export them so
producers and the client hook cannot drift.

---

## 1. SSE frame format

The gateway emits standard `text/event-stream` frames. Two frame families share
one stream:

```
id: <publish_id>            # durable events only; the reconnect cursor
event: <type>               # e.g. match_deck_appended, active_jobs_snapshot
data: <single-line JSON>    # the envelope below, JSON-encoded

```

- **Durable events** carry `id:` set to the row's `publish_id`. This is the only
  value a client may persist as its cursor.
- **Live frames** (snapshots, progress, control) **omit `id:`** so the browser /
  hook never advances the durable cursor past a non-replayable frame.
- Heartbeats are SSE comment frames: `: ping\n\n`. They carry no `event:`/`data:`
  and are ignored by the parser.

### 1.1 Envelope

Every `data:` payload is one JSON object with this envelope:

```ts
interface AccountEventEnvelope<T extends AccountEventType = AccountEventType> {
  /** Discriminant. Matches the SSE `event:` field. */
  type: T;
  /** Payload schema version. Bumped only on a breaking payload change (§6). */
  v: 1;
  /** Producer-side wall clock (account_event.created_at) as epoch ms. */
  ts: number;
  /** Present iff durable. Equals the SSE `id:` field. Absent on live frames. */
  publishId?: number;
  /** Discriminated by `type`. See §2 / §3. */
  data: AccountEventPayloadMap[T];
}
```

**`accountId` is intentionally not in the envelope or payloads.** The stream is
already account-scoped by the bearer token (§4), and replay is filtered
server-side by `account_id`. This supersedes the inline `accountId` shown in
`proposal.md` §8.3 — carrying it per-event would be redundant and would invite a
client to trust a body field over the authenticated stream identity.

---

## 2. Durable event catalog

These rows live in `account_event`, get a `publish_id`, and are replayable on
reconnect (`WHERE account_id = :sub AND publish_id > :cursor ORDER BY publish_id`).
Delivery is **at-least-once**; clients dedupe by `publishId` (§5.3).

```ts
type AccountEventType =
  | "match_snapshot_published"
  | "match_snapshot_failed"
  | "match_deck_appended"
  | "enrichment_completed"
  | "enrichment_stopped"
  | "billing_state_changed"; // later phase

type MatchOrientation = "playlist" | "artist"; // mirror src/.../match-review-queue/types

interface AccountEventPayloadMap {
  match_snapshot_published: { orientation: MatchOrientation; snapshotId: string };
  match_snapshot_failed: {
    orientation: MatchOrientation | null;
    snapshotId: string | null;
    reason: string;
  };
  // Producer: src/worker/poll-match-deck-jobs.ts, append_sessions arm,
  // only when outcome.kind === "applied" && appendedCount > 0.
  match_deck_appended: {
    orientation: MatchOrientation;
    sessionId: string;
    snapshotId: string;
    appendedCount: number;
  };
  // counts mirror ProgressCounts from src/lib/server/jobs.functions.ts.
  enrichment_completed: {
    jobId: string;
    counts: { done: number; total: number; succeeded: number; failed: number };
  };
  enrichment_stopped: {
    jobId: string;
    reason: "user_cancelled" | "failed" | "superseded";
    counts: { done: number; total: number; succeeded: number; failed: number };
  };
  billing_state_changed: Record<string, never>; // empty; client refetches getBillingState()

  // live frames (§3) reuse this map via AllFrameType below
  active_jobs_snapshot: ActiveJobsSnapshot;
  job_progress_changed: { jobId: string; kind: "enrichment" | "matchSnapshotRefresh"; progress: { done: number; total: number; succeeded: number; failed: number } };
}
```

`billing_state_changed` is deliberately payload-free: billing truth is derived,
so the client re-reads `getBillingState()` rather than trusting an event body.
Same principle as `firstVisibleMatchReady` staying derived (`proposal.md` §7.3).

---

## 3. Live (non-durable) frames

No `id:`, never replayed, always repairable from a fresh snapshot.

- **`active_jobs_snapshot`** — sent on every connect and reconnect, and after any
  durable event whose consumer needs a fresh running-jobs view. Its payload **is
  the `ActiveJobs` shape** from `src/lib/server/jobs.functions.ts` (do not fork
  it — re-export the type):

  ```ts
  type ActiveJobsSnapshot = import("@/lib/server/jobs.functions").ActiveJobs;
  ```

- **`job_progress_changed`** *(optional, phase 2+)* — coalesced progress ticks. If
  dropped, the next `active_jobs_snapshot` repairs the cache. Clients must treat
  it as best-effort.

### 3.1 Control frames

- **heartbeat** — `: ping\n\n` every 20 s (range 15–25 s), tuned under the
  shortest idle timeout in the chain. The shortest hop is **not** a proxy: Bun's
  own `Bun.serve` idle timeout defaults to **10 s** and a quiet SSE stream counts
  as idle, so the gateway must disable it per stream (`server.timeout(req, 0)`)
  or the connection dies before the first ping — see task 06 (`proposal.md` §5.2).
- **token-expiry close** — before closing on `exp`, the gateway sends
  `event: token_expiring` with `data: {"reason":"token_expired"}`, then ends the
  stream. The client re-mints and reconnects with its cursor.
- **error close** — `event: error` with `data: {"code": <string>}` for
  terminal server-side conditions (e.g. `revoked`, `overloaded`) before the
  stream ends.

---

## 4. HTTP contract

### 4.1 `GET /account-events/stream` (Bun gateway)

Request:

| Header | Value |
| --- | --- |
| `Accept` | `text/event-stream` |
| `Authorization` | `Bearer <event-token>` (§4.2) |
| `Last-Event-ID` | last seen `publishId`, on reconnect only (also accepted as `?` — see note) |

Cursor transport: prefer the standard `Last-Event-ID` request header. Because the
client is fetch-based (not native `EventSource`) it sets this header explicitly;
do **not** put the cursor or token in the query string (RFC 9700, `research.md`
[S16]).

Responses:

| Status | Meaning | Client action |
| --- | --- | --- |
| `200` | stream open (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`) | consume frames |
| `401` | missing / invalid / expired token | re-mint, then reconnect |
| `403` | token valid but session/version revoked, or `sub` ≠ requested scope | stop; force full re-auth |
| `429` | too many concurrent streams for this account (§5.4) | back off with jitter |
| `503` | gateway draining / at capacity | back off with jitter; keep fallback poll |

The gateway disables response buffering (`X-Accel-Buffering: no`, and
`proxy_buffering off` at nginx) so frames flush immediately (`research.md` [S35]).

### 4.2 Token mint (Cloudflare app tier, server fn)

A new `createServerFn({ method: "GET" })` (proposed `src/lib/server/account-events.functions.ts`)
returns a short-lived signed token for the *authenticated session's* account.

- Signed with a dedicated secret (`ACCOUNT_EVENTS_TOKEN_SECRET`, min 32), **not**
  `BETTER_AUTH_SECRET` — separate blast radius, separate rotation.
- The gateway validates signature + `exp` locally (no per-connect DB round-trip)
  and checks the version claim at connect (§4.3).

Claims:

```ts
interface EventTokenClaims {
  sub: string;         // accountId — the ONLY account this stream may read
  sid: string;         // session id
  ver: number;         // session/token version for revoke-all
  iat: number;
  exp: number;         // iat + 5 min
  jti: string;
}
```

Rate-limit the mint endpoint per session (a healthy client mints roughly once per
`exp` window plus reconnects; anything faster is a loop or abuse).

### 4.3 Authz invariants (must hold in code)

1. A stream only ever serves rows where `account_event.account_id = token.sub`.
   The `account_id` filter is non-optional in the replay query — never derived
   from a client-supplied field.
2. On connect the gateway compares `token.ver` against the account/session's
   current version; a mismatch is `403` (revoke-all path, `proposal.md` §6.2).
3. `exp` is enforced mid-stream: at `exp` the gateway sends `token_expiring` and
   closes. Connect-time-only validation is explicitly rejected (`research.md`
   [S16]).

---

## 5. Client contract (`useAccountEvents`)

Mounted once from `src/routes/_authenticated/route.tsx` (`proposal.md` §5.3, §9.1).

### 5.1 Cursor persistence

The `publishId` cursor lives **in memory for the tab's lifetime only** — not
`localStorage`. Rationale: a persisted cursor that outlives a logout/login or a
retention prune (§operations) would ask the gateway to replay from an id that no
longer exists; the gateway would then have to distinguish "pruned" from "ahead of
me", and the client would risk silently missing the gap. A fresh page load starts
from no cursor, receives a full `active_jobs_snapshot`, and only then begins
advancing. This trades a redundant snapshot on reload (cheap) for never trusting a
stale cursor.

The gateway announces the stream's effective starting cursor in the
`x-account-events-cursor` response header, and the client seeds its in-memory
cursor from it on a cursor-less connect. A mid-session reconnect that happens
before the first durable frame therefore still carries a `Last-Event-ID`
instead of presenting as another fresh page load — which would re-resolve the
head and silently skip events published in the gap.

### 5.2 Multi-tab behavior (phase 1 decision)

**Phase 1: one stream per tab.** N open tabs for one account = N gateway
connections. This is simple and correct, and the connection-budget math in
`proposal.md` §5.5 / `research.md` Table 3 must be read as *connections*, not
*users* — anchor the load test (§operations) on realistic tabs-per-user, not
accounts.

A `BroadcastChannel` leader-election model (one real stream per account,
fanned out to sibling tabs) is a known later optimization and is **explicitly
deferred** — it adds a leader-failover state machine that isn't worth it until
tabs-per-user measurably threatens the connection budget.

### 5.3 Dedup + ordering

- Dedupe durable events by `publishId`; drop any `publishId <= lastSeen`.
- Advance `lastSeen` only on durable frames, monotonically.
- Live frames never touch the cursor and are idempotent by construction (a
  snapshot overwrites cache state; a progress tick is last-writer-wins).

### 5.4 Reconnect / backoff

- Full-jitter exponential backoff, base 500 ms–1 s, cap ~30 s, reset after a
  stable connection (`proposal.md` §5.3, `research.md` [S38]).
- On `401`/`token_expiring`: re-mint then reconnect with cursor.
- On `403`: stop and surface a re-auth path; do not retry in a loop.
- While disconnected, the slow fallback poll (§5.5) is the only freshness source.

### 5.5 Fallback poll

Every replaced poll keeps a **slow** fallback that runs *only while the stream is
disconnected*, then quiesces. The hook contracts in `useActiveJobs` and the
route/liked-songs hooks stay identical to consumers (`proposal.md` §9); only the
data source underneath changes.

### 5.6 Invalidation map (trigger → React Query action)

Owned by the shell; this is the concrete form of `proposal.md` §9.

| Event | Action |
| --- | --- |
| `active_jobs_snapshot` | write `["active-jobs", accountId]` cache directly |
| `job_progress_changed` | patch `["active-jobs", accountId]` progress |
| `enrichment_completed` / `enrichment_stopped` | invalidate dashboard (`pageData`/`stats`/`recentActivity`) + liked-songs (`stats`, collection) keys — same set `useActiveJobCompletionEffects` invalidates today |
| `match_snapshot_published` | if `/match` still building, retry the bounded deck read |
| `match_deck_appended` | invalidate `matchDeckKeys.deck(accountId, orientation)` |
| `billing_state_changed` | invalidate billing state; let `getBillingState()` refetch |

---

## 6. Payload versioning

- `v` starts at `1`. Additive, optional fields do **not** bump `v`.
- A breaking change (rename/remove/retype a field, or change semantics) bumps `v`
  and the client must handle both the old and new `v` for one retention window
  (§operations) so in-flight replays don't break across a deploy.
- New event *types* are additive and never bump existing payloads' `v`. Unknown
  `type` values must be ignored by the client, not treated as errors.

---

## 7. Open contract decisions

1. **Capacity validation.** The owner anchor is now **10,000 concurrent tabs**
   for the initial pass/fail target, but the real capacity result is still open
   until Task 15 records measured load-test evidence on the target environment.
2. **`job_progress_changed` in phase 1?** Ship snapshot-only first; add the
   progress delta only if snapshot cadence feels coarse in practice.
3. **Shared contract module location.** Proposed `src/lib/account-events/contract.ts`;
   confirm against module-boundary rules before build.
