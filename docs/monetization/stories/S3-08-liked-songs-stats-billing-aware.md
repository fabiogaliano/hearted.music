# S3-08 · Liked Songs Stats — Billing-Aware Counts

## Goal

Update `get_liked_songs_stats` SQL RPC to add a `locked` count and ensure `pending` excludes locked songs.

## Why

The current stats RPC counts missing `item_status` as `pending`. Under billing, locked and pending are distinct. Dashboard and UI stats must reflect the real breakdown.

## Depends on

- S1-04 (entitlement predicate)
- S3-07 (liked songs page split establishes the pattern)

## Blocks

- Phase 6 (UI consumes these stats)

## Scope

- Update `get_liked_songs_stats` SQL RPC (new migration):
  - Add `locked` count: songs that are not entitled
  - `pending` count: entitled songs without `item_status`
  - `analyzed` count: entitled songs with `item_status` (analysis visible)
  - Existing `analyzing` and `failed` counts adjusted for entitlement
- Update `getLikedSongsStats` server function if the return shape changes

## Out of scope

- Dashboard stats (S3-09)
- UI rendering of stats

## Likely touchpoints

| Area | Files |
|---|---|
| SQL RPC | `supabase/migrations/{timestamp}_liked_songs_stats_billing_aware.sql` |
| Server functions | `src/lib/server/liked-songs.functions.ts` |

## Constraints / decisions to honor

- Counts must be billing-aware — only entitled analyzed songs count as `analyzed`
- Locked songs must not inflate `pending` count
- Stats may still reference `match_snapshot` (verify table name post-rename)

## Acceptance criteria

- [ ] `locked` count reflects non-entitled songs
- [ ] `pending` excludes locked songs
- [ ] `analyzed` counts only entitled + analyzed songs
- [ ] Total counts still sum correctly
- [ ] Self-hosted users show 0 locked songs

## Verification

- SQL test: account with mix of locked/pending/analyzed songs
- `bun run test` passes

## Parallelization notes

- Touches `liked-songs.functions.ts` — should land after S3-07 to avoid merge conflict
- Can run in parallel with S3-09, S3-10

## Suggested PR title

`feat(billing): billing-aware liked songs stats with locked count`
