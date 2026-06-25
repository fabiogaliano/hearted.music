# MSR-08 — Match preference and job availability schema

## Goal

Add the remaining schema needed for saved match mode and delayed job claiming.

## Depends on / blocks

Depends on:

- MSR-05

Blocks:

- MSR-09
- MSR-21
- MSR-29

## Scope and out of scope

In scope:

- Add `user_preferences.match_view_mode` with default/check constraint.
- Add `job.available_at` with default `now()`.
- Update pending job claim indexes for `available_at`-aware polling.
- Regenerate DB types.

Out of scope:

- Preference helper implementation.
- Claim RPC predicate changes.
- UI route toggle persistence.

## Likely touchpoints

- `supabase/migrations/**user_preferences**`
- `supabase/migrations/**job**`
- `src/lib/data/database.types.ts`

## Constraints and decisions to honor

- `match-system-terminology-decisions.md` C10, C16, E15, E16.
- Preference is for non-`/match` surfaces; explicit `/match` URL remains authoritative.
- `available_at` is the canonical scheduling column.

## Acceptance criteria

- Migrations apply cleanly.
- Existing users/jobs default to song mode and immediately claimable jobs.
- Generated DB types include both new columns.

## Notes on risks or ambiguity

- Keep this story small; behavior lands in MSR-09 and MSR-21.
