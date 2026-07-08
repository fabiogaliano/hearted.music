---
status: proposed
updated: 2026-07-08
depends_on: ["11"]
---

# 16 — Billing events (later phase)

**Deferred — rollout phase 6.** Do not start until phases 1–4 (tasks 01–13)
are stable in production. Contract §2; proposal §8.4, §9.5.

## Steps

- [ ] Emit durable `billing_state_changed` (empty payload) from the Stripe
      webhook fulfillment boundary and any direct transition that changes
      `getBillingState()` — same-transaction outbox writes via task 03's helper
- [ ] Extend the shell invalidation map: `billing_state_changed` → invalidate
      billing state so `getBillingState()` refetches
- [ ] **Consolidate first:** `usePostPurchaseReturn` and `useCheckoutPolling` are
      today two independent copies of the same 2 s / 30 s billing poll (identical
      constants, duplicated logic). Merge them into one shared hook, then make that
      hook stream-first with the 2 s / 30 s poll retained only as fallback while
      disconnected — don't switch two forks in parallel
- [ ] Leave the `checkout/success.tsx` 35 s one-shot "taking longer" UI timer
      alone — it is a visual affordance, not a billing poll; the stream just makes
      it fire less often
- [ ] Tests: webhook fulfillment emits the event; client refetches billing
      state on the event; fallback poll still covers the disconnected case

## Acceptance gate

- [ ] `bun run test` passes
- [ ] A checkout return with the stream connected reflects the new billing
      state without the 2 s poll firing
- [ ] With the stream down, the legacy poll behavior is unchanged
- [ ] The event payload is empty (`Record<string, never>`) end to end

## Guardrails

- Payload-free by design: billing truth is derived; the client must refetch,
  never trust an event body (contract §2).
- The app tier writes this event — verify task 03's helper works on the
  Cloudflare DB path before wiring the webhook.
- Onboarding and post-purchase flows share the fallback semantics; don't fork
  them.
