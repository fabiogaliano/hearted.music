---
status: proposed
updated: 2026-07-08
depends_on: ["10", "11"]
---

# 12 — Match route switch

Event-driven deck freshness on `/match`, closing the parked-deck gap.
Proposal §9.2, rollout phase 3.

## Steps

- [ ] On `match_snapshot_published`: if `/match` is still `{status:"building"}`,
      retry the bounded deck read
- [ ] On `match_deck_appended`: invalidate
      `matchDeckKeys.deck(accountId, orientation)` immediately
- [ ] Keep the bounded 3 s building-recovery poll **only** as fallback while
      the stream is unavailable or during first-connect race windows
- [ ] Tests: published event triggers the deck retry without waiting for the
      poll; append event refreshes a parked deck; fallback still recovers with
      the stream down

## Acceptance gate

- [ ] `bun run test` passes
- [ ] Building → published transitions render the deck via the event path
      (fallback poll not observed while connected)
- [ ] A background append while parked on `/match` refreshes the deck without
      navigation
- [ ] With the stream down, the bounded poll still recovers the building state

## Guardrails

- Deck invalidation is orientation-scoped — never invalidate both
  orientations on one event.
- The building poll stays bounded; don't extend its window while adding the
  event path.
- Remember the repo rule: no DB-derived id sets re-entering queries as `.in()`
  filters if any read path is touched.
