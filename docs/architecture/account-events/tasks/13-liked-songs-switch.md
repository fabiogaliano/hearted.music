---
status: proposed
updated: 2026-07-08
depends_on: ["11"]
---

# 13 — Liked songs switch

Replace the 5 s stats and collection polls with stream-driven invalidation.
Proposal §9.3, rollout phase 4.

## Steps

- [ ] `useLikedSongsPageData`: drop the 5 s stats poll; invalidate liked-song
      stats on `enrichment_completed` / `enrichment_stopped` (via the shell's
      §5.6 map); derive header progress from the active-jobs cache instead of
      a second poll
- [ ] `useLikedSongsCollection`: drop the 5 s unsettled-rows poll; invalidate
      (or patch) the collection from enrichment events
- [ ] Keep a bounded self-heal fallback in both hooks that runs only while the
      stream is disconnected
- [ ] Tests: events invalidate the same keys the polls refreshed; no polling
      while connected; fallback self-heal works disconnected

## Acceptance gate

- [ ] `bun run test` passes; `LikedSongsPage` consumes unchanged hook contracts
- [ ] With the stream connected and enrichment running, no periodic
      stats/collection fetch fires — updates arrive on events
- [ ] Unsettled rows still converge when the stream is down (fallback)
- [ ] Header progress renders from the active-jobs cache, no dedicated poll

## Guardrails

- Hook contracts stay identical for consumers (proposal §9.4).
- Fallback polls are gated on disconnection, never deleted.
- No speculative row-patching machinery if invalidation is sufficient — patch
  only if invalidation measurably thrashes.
