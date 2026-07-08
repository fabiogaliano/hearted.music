---
status: done
updated: 2026-07-08
depends_on: ["01"]
---

# 05 — Event-token mint (app tier)

Short-lived signed bearer token minted by the Cloudflare app tier for the
authenticated session's account. Contract §4.2, proposal §6.2.

## Steps

- [x] Add `ACCOUNT_EVENTS_TOKEN_SECRET` (min 32 chars) to the env schema/config
      for both the app tier and the Bun runtime — dedicated secret, not
      `BETTER_AUTH_SECRET`
- [x] New `createServerFn({ method: "GET" })` in
      `src/lib/server/account-events.functions.ts` returning a signed token for
      the authenticated session
- [x] Claims exactly per `EventTokenClaims`: `sub` = accountId from the session
      (never from input), `sid`, `ver` (session/token version for revoke-all),
      `iat`, `exp = iat + 5 min`, `jti`
- [x] Sign with WebCrypto-compatible HMAC (must run on Cloudflare Workers);
      share the verify helper with the gateway via a small common module
- [x] Rate-limit minting per session (healthy cadence ≈ once per `exp` window
      plus reconnects)
- [x] Tests: claims round-trip, expiry math, unauthenticated rejection, rate
      limit trips

## Acceptance gate

- [x] `bun run test` passes
- [x] An authenticated call returns a token the shared verifier accepts, with
      all six claims populated
- [x] Unauthenticated calls are rejected; `sub` can never be caller-chosen
- [x] Signing/verifying works in a Workers-compatible runtime (no Node-only
      crypto APIs)

## Guardrails

- The token is never placed in a URL query string (RFC 9700; contract §4.1).
- Separate secret = separate blast radius; do not fall back to
  `BETTER_AUTH_SECRET` even temporarily.
- Keep `exp` at 5 min; don't make it configurable per-call.
