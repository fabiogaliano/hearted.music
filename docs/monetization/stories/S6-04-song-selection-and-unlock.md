# S6-04 · Song Selection UI + requestSongUnlock Integration

## Goal

Implement the multi-select song selection flow for pack users to choose which locked songs to explore, with balance confirmation and unlock execution.

## Why

Pack users must explicitly select which songs to explore from their purchased balance. This is the primary user-facing purchase action after onboarding.

## Depends on

- S6-03 (locked song rendering)
- S2-06 (`requestSongUnlock` server function)
- S6-01 (billing state — balance display)

## Blocks

- S6-05 (paywall shown when balance hits zero)

## Scope

- Song selection UI in liked songs page:
  - Multi-select mode for locked songs
  - Selection count display
  - Remaining balance display
  - Confirmation dialog: "Explore {n} songs? ({remaining} songs to explore remaining)"
- Wire to `requestSongUnlock` server function:
  - On confirm: call `requestSongUnlock({ songIds })`
  - On success: invalidate liked songs + billing state queries; show success state
  - On error (insufficient balance): show paywall/upgrade prompt
  - On error (invalid songs): show error message
- Only available for pack users in provider-enabled mode
- Hidden for unlimited and provider-disabled users

## Out of scope

- Paywall design (S6-05)
- Full interaction design (functional is sufficient)
- Drag-to-select (can be refined later)

## Likely touchpoints

| Area | Files |
|---|---|
| Feature components | `src/features/liked-songs/*` |
| Route | `src/routes/_authenticated/liked-songs.tsx` |
| Query cache | `src/features/liked-songs/queries.ts` (invalidation) |
| Server functions | `src/lib/server/billing.functions.ts` |

## Constraints / decisions to honor

- All-or-nothing unlock — no partial fulfillment
- Max 500 song IDs per request
- Duplicate song IDs deduped silently
- Already-unlocked songs returned separately without double-charge
- Insufficient balance returns typed error

## Acceptance criteria

- [ ] Pack user can select locked songs and confirm unlock
- [ ] Balance and selection count displayed during selection
- [ ] Unlock calls `requestSongUnlock` and refreshes UI on success
- [ ] Insufficient balance shows paywall prompt
- [ ] Unlimited users don't see selection UI
- [ ] Provider-disabled users don't see selection UI
- [ ] Cache invalidated after successful unlock

## Verification

- Manual: select songs → confirm → unlocked → processing begins
- Manual: insufficient balance → paywall
- `bun run test` passes

## Parallelization notes

- Touches liked songs feature — should land after S6-03
- Can run in parallel with S6-02

## Suggested PR title

`feat(billing): song selection UI and unlock flow for pack users`
