# CMHF-08 — Filter options RPC

## Goal

Add `getPlaylistMatchFilterOptions`, an account-scoped compact read for filter option data and bounds.

## Depends on / blocks

- Depends on: CMHF-01 and CMHF-02.
- Blocks: CMHF-14.

## Scope

In scope:

- Add `getPlaylistMatchFilterOptions` server function with no input and auth-session account scoping.
- Use the same candidate eligibility semantics as `getEntitledDataEnrichedSongIds(accountId)`.
- Return compact language, release-year, and liked-date option data in the locked DTO shape.
- Count primary and secondary language once per code per song.
- Exclude/log detected language codes that are not in the catalog.
- Return release-year min/max and optional counts from eligible active liked songs.
- Return liked-date oldest/today UTC date strings and UTC year counts.
- Add query option/key helper for the frontend.
- Add tests for candidate population, language counting/order, uncataloged logging, release-year bounds, liked-date UTC year counts, and empty library behavior.

Out of scope:

- UI rendering of options.
- Production query consumption.
- Full song row returns.
- Multi-select combined result count calculation.

## Likely touchpoints

- `src/lib/server/playlists.functions.ts`
- `src/features/playlists/queries.ts`
- `src/lib/workflows/enrichment-pipeline/batch.ts` or the selector/RPC used by `getEntitledDataEnrichedSongIds(accountId)`.
- `src/lib/domains/library/liked-songs/queries.ts` or a dedicated aggregation helper.
- `src/lib/domains/library/songs/queries.ts` if compact song metadata helpers are added.
- Server tests near playlist functions/options.

## Constraints and decisions to honor

Reference `crisp-metadata-hard-filters-decisions.md` sections 1, 4, 6, 7, and 10.

- RPC name is `getPlaylistMatchFilterOptions`.
- It takes no input; it is account-scoped from auth session.
- Options use matching-eligible active liked songs, not all songs.
- Language catalog remains selectable beyond detected library languages.
- Release-year bounds guide controls only.
- `likedAt.today` is server current UTC date.
- Endpoint returns compact aggregates only.

## Acceptance criteria

- Response shape exactly matches `PlaylistMatchFilterOptions`.
- Empty eligible library returns catalog language options as selectable with counts `0`, release-year `min/max: null`, likedAt `oldest: null`, and current UTC `today`.
- Bilingual songs increment two language counts but never duplicate the same code for one song.
- Uncataloged detected codes are logged and not returned as selectable options.
- Liked-date year counts use UTC years from active `liked_song.liked_at` rows.
- Frontend query key/helper exists without requiring `playlistId`.
- Relevant `bun run test` coverage passes.

## Notes on risks or ambiguity

- Avoid loading full song rows into the response; aggregate in SQL or compact server helpers.
- Ensure active liked songs exclude `unliked_at` rows.
