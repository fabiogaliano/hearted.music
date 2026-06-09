# Task 14 — `reset-onboarding` script

**Plan:** §13.3 · **Recommended order:** step 15 · **Status:** [ ]

## Goal

Make `bun run reset:onboarding <email>` clear `account.handle` too, so local
replay still exercises a true **first-claim** path. Without this, replay would only
ever hit the stale re-entry / owned-handle branch and stop being a real onboarding
reset.

## Checklist

- [ ] `scripts/reset-onboarding.ts` clears `account.handle` (set to null) in addition to the existing `user_preferences` onboarding-state reset
- [ ] Update the script's help text to state that it clears the handle
- [ ] Update the completion summary/output copy to make the handle clear explicit
- [ ] Confirm a clean DB-side replay yields `claimHandleSeed = { kind: "suggested" | "blank" }` (not `owned`) on the next onboarding run

## Notes

Pre-prod assumption stands: no meaningful real accounts to migrate, **no backfill
flow** in this change. The cleared handle must still satisfy the DB
normalization/syntax constraints if ever set manually.

## Files touched

`scripts/reset-onboarding.ts`.

## Dependencies

Task 02 (`account.handle` exists).

## Related tests

Manual: run `bun run reset:onboarding <email>` and confirm a first-claim replay.
No dedicated unit test required by the plan.
