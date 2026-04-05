# S3-07 · Liked Songs Page — Locked/Pending Split

## Goal

Update the liked songs page SQL RPC and server function to distinguish `locked` from `pending` and suppress `song_analysis` text for locked songs.

## Why

The current `get_liked_songs_page` RPC treats missing `item_status` as `pending`. Under billing, some of those songs are `locked` (not entitled). Exposing analysis text for locked songs leaks paid value — the #1 architectural risk identified in the audit.

## Depends on

- S1-04 (entitlement predicate)
- S2-01 (SongDisplayState type)
- S1-01 (account_song_unlock table)

## Blocks

- S3-11 (feature type migration consumes the new states)
- Phase 6 (locked song rendering in UI)

## Scope

- Update `get_liked_songs_page` SQL RPC (new migration):
  - Join against `account_song_unlock` and/or use `is_account_song_entitled`
  - Return `SongDisplayState` (`locked`, `pending`, `analyzing`, `analyzed`, `failed`) instead of deriving from `item_status` alone
  - Suppress `song_analysis.analysis` content for locked songs (return NULL or exclude)
  - `locked`: not entitled, regardless of shared cache state
  - `pending`: entitled, no `item_status` yet
  - Matching status only for `analyzed` songs

- Update `getLikedSongsPage` server function in `src/lib/server/liked-songs.functions.ts`:
  - Pass through the new display state
  - No analysis text for locked songs

## Out of scope

- Stats changes (S3-08)
- Dashboard changes (S3-09)
- UI component changes (Phase 6)
- Feature type migration (S3-11)

## Likely touchpoints

| Area | Files |
|---|---|
| SQL RPC | `supabase/migrations/{timestamp}_liked_songs_page_billing_aware.sql` |
| Server functions | `src/lib/server/liked-songs.functions.ts` |

## Constraints / decisions to honor

- `locked` = not entitled, regardless of shared cache
- `pending` = entitled, queued, not started
- Matching status is a sub-dimension of `analyzed` only
- Read-model must filter by effective entitlement, not `song_analysis` existence
- `item_status` absence for non-entitled songs = `locked`, not `pending`

## Acceptance criteria

- [ ] Locked songs returned with `locked` state, no analysis text
- [ ] Entitled songs without `item_status` returned as `pending`
- [ ] Analyzed entitled songs returned with analysis text and matching status
- [ ] Self-hosted/unlimited users see all songs as entitled
- [ ] No analysis text leaks for locked songs

## Verification

- SQL test: mix of locked, pending, analyzed songs → correct states and text visibility
- `bun run test` passes

## Parallelization notes

- Can run in parallel with S3-01 through S3-06 (workflow track)
- Touches `liked-songs.functions.ts` — coordinate with S3-08 if both modify the same file (consider landing S3-07 first)

## Suggested PR title

`feat(billing): liked songs page locked/pending split with entitlement filtering`
