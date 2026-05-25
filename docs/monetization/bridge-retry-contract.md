# Billing-service → App Bridge: retry contract

This doc is the single source of truth for the retry and idempotency
semantics between `v1_hearted_brand` (the billing service) and
`v1_hearted` (the app) across the `/api/billing-bridge` endpoint.

Keep it in sync with the code:
- App receiver: `v1_hearted/src/routes/api/billing-bridge.ts`
- Payload parser/versioning: `v1_hearted/src/lib/domains/billing/bridge-payloads.ts`
- Claim RPCs: `v1_hearted/supabase/migrations/20260420000000_billing_bridge_event_status_lease.sql`
- Service client: `v1_hearted_brand/src/lib/bridge.ts`

## Response shape

| Status | Body                         | Meaning                     | Caller action                  |
| ------ | ---------------------------- | --------------------------- | ------------------------------ |
| 200    | `{ ok: true }`               | Event processed             | Terminal success               |
| 200    | `{ ok: true, duplicate: true }` | Already processed        | Terminal success (no-op)       |
| 400    | `{ error: "Invalid ..." }`   | Bad payload for the current schema version | Terminal failure (do not retry)|
| 401    | `{ error: "..." }`           | Bad HMAC / config           | Terminal failure (do not retry)|
| 409    | `{ error: "in_progress" }`   | Another worker holds the processing lease | **Transient — retry with backoff** |
| 500    | `{ error: "..." }`           | Server / handler / claim error, or unsupported bridge schema version | **Transient — retry with backoff** |
| 503    | `{ error: "rate_limited" }`  | Per-IP rate limit tripped (sends `Retry-After`) | **Transient — retry with backoff** |

## Why 409 exists

The app models `billing_bridge_event` as a state machine
(`processing | processed | failed`) with a processing lease, so
dispatch failures leave the event reclaimable instead of poisoning the
idempotency key. While one worker holds a valid lease on a
`stripe_event_id`, a concurrent delivery for the same id gets 409
instead of being silently double-dispatched.

If 409 is treated as terminal the event is effectively dropped for the
duration of the lease, even though the app is perfectly willing to
serve the retry once the lease expires or the holding worker finishes.

## Schema versioning

Bridge payloads now require `schema_version: 2`.

Rules:
- The billing service must send `schema_version: 2` on every bridge payload.
- The app receiver accepts only `schema_version: 2`.
- Missing `schema_version` is an invalid payload (`400`).
- An otherwise valid payload with a non-current `schema_version` returns `500`, not `400`, so a future staggered deploy retries instead of dropping the event.

## Required billing-service behavior

`sendBridgeEvent` in `v1_hearted_brand/src/lib/bridge.ts` **must**:

1. Retry on status `409` and on any `5xx` with exponential backoff and jitter.
2. Not retry on `2xx` or on `4xx` other than `409`.
3. Retry on network-level errors (fetch throw) with the same backoff policy.
4. Cap total attempts so a persistently failing receiver does not wedge a
   webhook handler indefinitely.
5. Resign the HMAC per attempt (current timestamp each time), since clock
   skew + backoff could otherwise exceed the receiver's timestamp window.

Current settings (see constants in `bridge.ts`):
- `BRIDGE_MAX_ATTEMPTS = 4`
- `BRIDGE_INITIAL_BACKOFF_MS = 400` (doubles each attempt, cap 4 s, +100 ms jitter)

## Why this is safe

Even if every in-process retry is exhausted and `sendBridgeEvent`
returns the final non-2xx response (or throws), the webhook event's own
idempotency claim (`billing_webhook_event`) remains, and Stripe's own
webhook retry window (~3 days, exponential) will redeliver the webhook.
On redelivery:
- `v1_hearted_brand` re-enters the handler with the same
  `stripe_event_id`.
- Handler calls bridge again.
- App receiver reclaims the stale-lease/failed row via its CAS RPC and
  re-runs the handler.

The worst case — a handler that crashes mid-dispatch on the app side —
is recovered by the processing lease timeout (`BRIDGE_PROCESSING_LEASE_MS`
in the app route, currently 5 min).

## Changing the contract

Any change to status codes, retry classification, or lease timing must
be made **atomically in both repos** and this doc. A drift where one
side treats 409 as terminal and the other treats it as transient is a
silent correctness bug.
