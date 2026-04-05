# S3-09 · Dashboard Stats — Billing-Aware

## Goal

Update `fetchDashboardStats` and underlying queries so `analyzedPercent` and match preview counts reflect only entitled songs.

## Why

The current dashboard counts `song_analysis` rows against total liked songs. Under billing, a locked song with a cached global `song_analysis` row should not count as "analyzed" for that account.

## Depends on

- S1-04 (entitlement predicate)
- S2-01 (billing types)

## Blocks

- Phase 6 (dashboard upgrade entry points, if any)

## Scope

- Update `fetchDashboardStats` in `src/lib/server/dashboard.functions.ts`:
  - `analyzedPercent` = entitled analyzed songs / total liked songs
  - `analyzedCount` counts only entitled + analyzed songs
  - Match previews filtered by entitlement (see S3-10 for full match filtering)
- Update underlying SQL or query logic as needed

## Out of scope

- Match/suggestion loader filtering (S3-10)
- Dashboard UI changes
- Upgrade CTAs (Phase 6)

## Likely touchpoints

| Area | Files |
|---|---|
| Server functions | `src/lib/server/dashboard.functions.ts` |
| SQL queries | Underlying stats queries (may be inline or in separate RPCs) |

## Constraints / decisions to honor

- Shared `song_analysis` existence does not imply account access
- Self-hosted users see all songs as analyzed (if they have analysis)
- Dashboard stats must not leak paid value through aggregate counts

## Acceptance criteria

- [ ] `analyzedPercent` counts only entitled + analyzed songs
- [ ] Locked songs with global `song_analysis` do not inflate analyzed count
- [ ] Match previews exclude locked songs
- [ ] Self-hosted dashboard stats unchanged from current behavior

## Verification

- Test: account with locked songs that have global analysis → not counted
- `bun run test` passes

## Parallelization notes

- Touches `dashboard.functions.ts` only — no conflict with other read-model stories
- Can run in parallel with S3-07, S3-08, S3-10

## Suggested PR title

`feat(billing): billing-aware dashboard stats`
