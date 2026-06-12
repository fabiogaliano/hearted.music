# Sync body-size guard

**Status:** App-level controls shipped. Three follow-ups outstanding (preprod
verification, optional WAF rule, route audit) — see below.

The extension sync endpoint (`POST /api/extension/sync`) accepts a JSON body and
buffers it before validation. On Cloudflare Workers an unbounded buffer can OOM
the isolate, so the body is size-bounded before any parse runs.

## Why this matters (platform limits)

The app deploys to Cloudflare Workers (`wrangler deploy`, `main: src/server.ts`).
Two limits collide:

| Limit | Value | Enforced by |
| --- | --- | --- |
| Per-isolate memory | 128 MB (heap + WASM + buffers) | Worker runtime — Error 1102 / "Memory limit would be exceeded before EOF" |
| Request body size | 100 MB (Free/Pro), 200 MB (Business), 500 MB (Ent) | CF edge → 413 before the Worker runs |

The exposure band is the intended 20 MB cap → the 100 MB edge cap. A body in that
band fully buffered by `request.json()` holds the raw bytes plus a parsed object
graph (~2–3× raw), so a 40–100 MB body realistically blows the 128 MB isolate
budget → isolate OOM → Error 1102 / 500, and the runtime may tear down the
isolate, disturbing other in-flight requests sharing it.

Blast radius is bounded: the route is authenticated (401 gate before the body is
touched), behind an active-sync gate (429) and a 60 s cooldown that both run
*before* the body guard (≤ ~1 attempt / 60 s / account), and the CF edge body cap
bounds the worst case. Classification: **reliability (isolate OOM), low
severity, bounded by auth + rate-limit.**

## What shipped (app-level, two layers)

Both in `src/routes/api/extension/sync.tsx`; helper in
`src/lib/server/request-body.ts`.

1. **Strict `Content-Length` (load-bearing).** Absent or non-numeric header →
   **411**; honest-but-oversized (`> MAX_SYNC_BODY_BYTES`, 20 MB) → **413**.
   This replaced a `Number(request.headers.get("content-length"))` check that
   passed on a missing header (`Number(null)` → `0`) and on a malformed one
   (`Number("abc")` → `NaN` fails `isFinite`).

   Why a present header is trustworthy: HTTP/1.1 reads exactly the declared
   `Content-Length` bytes; HTTP/2/3 (what CF terminates at the edge) treats a
   `content-length` that mismatches the DATA-frame total as a *malformed*
   request per RFC 9113 §8.1.1 and spec-compliant intermediaries reset the
   stream. So a *lying* length is not a practical bypass — only a **missing** or
   **malformed** one, which 411 now closes. Browsers always attach an accurate
   `Content-Length` for a `JSON.stringify` string fetch body on every HTTP
   version, so this cannot reject the legitimate extension caller.

2. **Byte-capped streaming read (defense-in-depth).** `readBodyWithByteCap`
   streams `request.body` and aborts (`reader.cancel()`) the moment the running
   total exceeds the cap, so memory is bounded *during* the read instead of
   buffered then measured. Replaces `request.json()`: read → `JSON.parse` →
   `SyncPayloadSchema.parse`. Does not depend on intermediaries honoring the
   protocol.

   Anti-pattern avoided: `request.text()` then `Buffer.byteLength` — on Workers
   that buffers the whole body first, the exact operation that risks the OOM.

Tested: `src/lib/server/__tests__/request-body.test.ts` (over-cap → null, reader
cancellation, split-UTF-8 decode) and the 411/413 cases in
`src/routes/api/extension/__tests__/sync.test.ts`.

Keep the cap at **20 MB**: peak memory ≈ raw buffer + decoded string + parsed
graph, already ~60–100 MB inside a 128 MB isolate at 20 MB. If a real library
exceeds it (50k liked songs × ~300 B ≈ 15 MB + playlists is plausibly close for
a power user), the product answer is chunked/paginated sync, not a bigger cap.

## Outstanding follow-ups

### 1. Preprod end-to-end verification (do before relying on the 411 path)

Run one real-extension sync against preprod and confirm `Content-Length` arrives
intact at the Worker through the CF edge. CF preserves it for non-streaming
bodies, but the 411 path makes that assumption load-bearing — a stripped header
in prod would 411 every legitimate sync. Verify once.

### 2. Edge WAF rule (optional belt-and-suspenders)

A custom rule rejects oversized bodies at the edge before the Worker runs:

```
http.request.body.size > 20971520
```

`http.request.body.size` reports the *full* body size even when body inspection
is truncated, so it is robust against chunking. **Caveat:** body-field
availability in custom rules varies by plan — confirm the current plan tier
exposes `http.request.body.size` before relying on this. The app-level controls
above are the portable ones; the WAF rule is additive only.

### 3. Retrofit `readBodyWithByteCap` onto other body-accepting routes

The helper is route-agnostic by design. Audit other Worker routes that buffer a
request body and route them through it.

## Sources

- [Cloudflare Workers — Platform Limits (128 MB isolate, 100 MB body)](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers — Streams runtime API](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Cloudflare Workers — Stream large JSON example](https://developers.cloudflare.com/workers/examples/streaming-json/)
- [Cloudflare Ruleset Engine — `http.request.body.size`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/http.request.body.size/)
- [Cloudflare Ruleset Engine — `http.request.body.truncated`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/http.request.body.truncated/)
- [Cloudflare Support — Error 1102 "Worker exceeded resource limits"](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/)
- RFC 9113 §8.1.1 — HTTP/2 malformed requests (content-length mismatch)
