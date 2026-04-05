# S3-10 · Match/Suggestion Loaders — Entitlement Filtering

## Goal

Update match, suggestion, and session detail loaders to filter by current entitlement at read time so revoked/locked songs are excluded immediately.

## Why

Current match loaders (`getSongMatches`, `getSongSuggestions`, `getMatchingSession`, `fetchMatchPreviews`) serve `song_analysis` content and match data without entitlement checks. Stale match results can reference songs whose access was later revoked.

## Depends on

- S1-04 (entitlement predicate)
- S2-01 (billing types)

## Blocks

- Phase 6 (match UI consumes filtered results)

## Scope

- Update `src/lib/server/matching.functions.ts`:
  - `getSongMatches` — filter by entitlement; do not serve `song_analysis.analysis` for locked songs
  - `getSongSuggestions` — entitlement check before exposing match data
  - `getMatchingSession` — filter session songs by entitlement
  - `fetchMatchPreviews` — exclude locked songs from previews
- Filter by current entitlement at read time, not only by snapshot contents
- Revoked songs disappear immediately without waiting for snapshot refresh
- Match snapshots are append-only; revocations do NOT delete old snapshots

## Out of scope

- Match snapshot refresh candidate filtering (S3-05)
- Liked songs page (S3-07)
- UI changes

## Likely touchpoints

| Area | Files |
|---|---|
| Server functions | `src/lib/server/matching.functions.ts` |
| SQL queries | Underlying match/suggestion queries |

## Constraints / decisions to honor

- `match_result` is account-scoped via `match_snapshot.account_id` but still requires entitlement filtering
- The canonical entitlement predicate must be applied in both liked-song and match/session read models
- Locked songs must not expose analysis text or match output

## Acceptance criteria

- [ ] Match results for locked/revoked songs excluded from all match loaders
- [ ] Analysis text not served for locked songs in match context
- [ ] Revoked songs disappear immediately from matching UI
- [ ] Self-hosted users see all matches (all songs entitled)
- [ ] No breaking changes to loader return shapes (locked results simply excluded)

## Verification

- Test: revoke a song's unlock → immediately excluded from match results
- Test: locked song with cached analysis → not in match output
- `bun run test` passes

## Parallelization notes

- Touches `matching.functions.ts` only — can run in parallel with all other Phase 3 stories

## Suggested PR title

`feat(billing): entitlement filtering in match and suggestion loaders`
