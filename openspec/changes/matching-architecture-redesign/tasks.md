## 1. Schema Migrations

- [ ] 1.1 Create `match_decision` table migration via `supabase migration new create_match_decision` — schema per spec, UNIQUE(account_id, song_id, playlist_id), indexes on (account_id) and (account_id, song_id). Apply with `supabase migrate up`.
  - `supabase/migrations/<timestamp>_create_match_decision.sql`
- [ ] 1.2 Create migration to remove `action_type` and `actioned_at` columns from `item_status` via `supabase migration new remove_item_status_action_columns`. Apply with `supabase migrate up`.
  - `supabase/migrations/<timestamp>_remove_item_status_action_columns.sql`
- [ ] 1.3 Update `get_liked_songs_page` RPC to derive matching status from `match_result`/`match_context`/`match_decision` instead of `item_status.action_type`. New migration via `supabase migration new update_liked_songs_page_function`.
  - `supabase/migrations/<timestamp>_update_liked_songs_page_function.sql`
- [ ] 1.4 Update `get_liked_songs_stats` RPC to derive counts from `match_result`/`match_decision` instead of `item_status.action_type`. New migration via `supabase migration new update_liked_songs_stats_function`.
  - `supabase/migrations/<timestamp>_update_liked_songs_stats_function.sql`
- [ ] 1.5 Regenerate Supabase types with `supabase gen types typescript --local > src/lib/data/database.types.ts`

## 2. Match Decision Data Layer

- [ ] 2.1 Create `src/lib/data/match-decision-queries.ts` — CRUD functions: `insertMatchDecision`, `insertMatchDecisions` (batch), `getMatchDecisions(accountId)`, `getMatchDecisionsForSongs(accountId, songIds)`. All return `Result<T, DbError>`.
- [ ] 2.2 Create `src/lib/data/match-decision-queries.test.ts` — unit tests for insert/query with mocked Supabase client.

## 3. Matching Exclusion Set

- [ ] 3.1 Create exclusion set loader in `src/lib/workflows/enrichment-pipeline/stages/matching.ts` — function `loadExclusionSet(accountId): Promise<Set<string>>` that loads `match_decision` rows + `playlist_track` rows, returns `Set<"songId:playlistId">`.
  - `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
- [ ] 3.2 Integrate exclusion set into `runMatching` — accept exclusion set parameter, skip excluded (song, playlist) pairs before scoring in `matchBatch`.
  - `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
  - `src/lib/domains/taste/song-matching/service.ts`
- [ ] 3.3 Rename `BatchMatchResult.failed` → `unmatched` and `stats.failed` → `stats.unmatched` across the matching service and all consumers.
  - `src/lib/domains/taste/song-matching/service.ts`
  - `src/lib/domains/taste/song-matching/types.ts`

## 4. Matching Stage Returns Song IDs

- [ ] 4.1 Update `runMatching` return type to include `matchedSongIds: string[]`, `unmatchedSongIds: string[]`, `skipped: boolean` alongside existing `total`, `succeeded`, `failed` counts.
  - `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
- [ ] 4.2 Update `matchSongs` in orchestrator to capture and propagate the matched/unmatched song IDs.
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`

## 5. Pipeline Writes item_status

- [ ] 5.1 Restore `item_status` check in `getFullyEnrichedSongIds` — revert the earlier change that removed `item_status`, re-add the 5th query for `item_status` per user.
  - `src/lib/workflows/enrichment-pipeline/batch.ts`
- [ ] 5.2 Add `item_status` write in orchestrator after matching completes — call `markItemsNew` for matched songs, create `item_status` rows for unmatched/skipped songs with `is_new = false`.
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - `src/lib/domains/library/liked-songs/status-queries.ts`
- [ ] 5.3 Implement two-mode `hasMoreSongs` probe — when matching was skipped (no playlists), use narrow check (4 artifacts only); otherwise use full check (4 artifacts + item_status).
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - `src/lib/workflows/enrichment-pipeline/batch.ts`

## 6. Re-match Operation

- [ ] 6.1 Create `src/lib/workflows/enrichment-pipeline/rematch.ts` — `requestRematch(accountId)` function that: loads all data-enriched songs, loads exclusion set, runs playlist profiling + matching, writes new `match_context` + `match_result` rows. Returns `Result`.
- [ ] 6.2 Add playlist change detection in `src/lib/workflows/enrichment-pipeline/trigger.ts` — compute current `playlistSetHash`, compare with latest `match_context.playlist_set_hash`, trigger re-match if different.
  - `src/lib/workflows/enrichment-pipeline/trigger.ts`
  - `src/lib/domains/taste/song-matching/queries.ts` (add `getLatestPlaylistSetHash`)
- [ ] 6.3 Integrate re-match into sync flow — call `requestRematch` from `trigger.ts` or sync route when playlist change detected. Wire into background job system.
  - `src/lib/workflows/enrichment-pipeline/trigger.ts`
  - `src/routes/api/extension/sync.tsx`

## 7. Server Functions & Query Updates

- [ ] 7.1 Update `addSongToPlaylist` server function to write `match_decision(decision='added')` instead of `item_status.action_type`.
  - `src/lib/server/liked-songs.functions.ts`
- [ ] 7.2 Replace `dismissSong` server function with batch-dismiss — accept array of playlist IDs, batch insert `match_decision(decision='dismissed')`.
  - `src/lib/server/liked-songs.functions.ts`
- [ ] 7.3 Remove `skipSong` server function — skip becomes UI-only state.
  - `src/lib/server/liked-songs.functions.ts`
- [ ] 7.4 Update `status-queries.ts` — remove matching-related `ActionType` values, keep newness functions (`markItemsNew`, `markSeen`, `markAllSeen`, `getNewCounts`, `getNewItemIds`).
  - `src/lib/domains/library/liked-songs/status-queries.ts`

## 8. Cleanup & Verification

- [ ] 8.1 Remove terminal failure recording for unmatched songs (already done in matching.ts, verify `recordTerminalFailure` import is gone).
  - `src/lib/workflows/enrichment-pipeline/stages/matching.ts`
- [ ] 8.2 Verify poll.ts Result checking fixes are in place (already applied).
  - `src/worker/poll.ts`
- [ ] 8.3 Verify sweep error logging in index.ts is in place (already applied).
  - `src/worker/index.ts`
- [ ] 8.4 Run full test suite — `bun run test` — ensure no regressions.
- [ ] 8.5 Update existing tests for changed interfaces (`BatchMatchResult.unmatched`, `runMatching` return type, server function contracts).
  - `src/worker/__tests__/`
  - `src/lib/workflows/enrichment-pipeline/__tests__/`
