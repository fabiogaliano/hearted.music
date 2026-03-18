## Why

The current matching architecture conflates pipeline processing state, user actions, and matching status into a single `item_status.action_type` field per song. This causes: infinite re-processing loops in the enrichment pipeline, loss of per-playlist action context (user adds song to playlist A but the decision for playlist B is lost), no mechanism to re-evaluate songs when playlists change (tracks, name, description — anything that affects the profile), and shared song data making songs invisible to other users' pipelines. The newness spec's per-song `item_status` model also contradicts the matching UI's multi-add support (adding a song to multiple playlists).

## What Changes

- **BREAKING**: Remove `action_type` and `actioned_at` from `item_status` — matching actions move to a new table
- **BREAKING**: Replace per-song user actions with per-(song, playlist) decisions via new `match_decision` table
- Introduce two distinct operations: enrichment pipeline (new songs) and re-match pass (playlist changes)
- Pipeline writes `item_status` after processing to prevent infinite loops — `item_status` becomes a pure pipeline processing tracker
- Matching stage accepts exclusion set (existing decisions + playlist membership) and skips excluded pairs at scoring time
- Re-match triggered on sync only when `playlistSetHash` differs from latest `match_context`
- Rename `BatchMatchResult.failed` → `noMatch` (no match above threshold is not a failure)
- Skip/Next becomes UI-only state (not persisted) — only `'added'` and `'dismissed'` are permanent decisions
- Badge count and /matching page derived directly from `match_result` for the latest `match_context` — since exclusion happens at match time, `match_result` only contains actionable suggestions
- `get_liked_songs_page` RPC updated to derive matching status from `match_result`/`match_decision` instead of `item_status.action_type`

## Capabilities

### New Capabilities
- `match-decisions`: Per-(song, playlist) user action tracking — replaces per-song action_type on item_status. Covers the match_decision table, decision types (added/dismissed), dismiss-as-batch-decline, and exclusion set loading for the matching engine.
- `re-matching`: Separate re-match operation triggered by playlist profile changes on sync. Runs matching on all data-enriched songs without going through the full enrichment pipeline.

### Modified Capabilities
- `newness`: Remove `action_type`/`actioned_at` from `item_status`. `item_status` becomes a pipeline processing tracker + newness flag only. Matching status derivation moves from `item_status.action_type` to `match_result`/`match_decision` composition.
- `matching-pipeline`: Add exclusion set input (match_decisions + playlist_songs) to skip already-decided pairs at scoring time. Rename `failed` → `noMatch`. Return matched/noMatch song IDs from matching stage (not just counts).
- `matching-ui`: Clarify data mutations — "Add" writes `match_decision(added)`, "Decline" writes `match_decision(dismissed)`, "Dismiss" batch-inserts dismissed for all shown playlists, "Skip/Next" is UI-only (not persisted). Badge count derived from match_result minus match_decision minus playlist_song.
- `data-flow`: Update server function contracts — `addSongToPlaylist` writes to `match_decision`, `dismissSong` batch-inserts dismissed decisions, `skipSong` removed as server function.

## Impact

- **Schema**: New `match_decision` table. `item_status` columns `action_type`/`actioned_at` removed. `get_liked_songs_page` and `get_liked_songs_stats` RPCs rewritten.
- **Pipeline**: `batch.ts` restores `item_status` check for per-user processing. `orchestrator.ts` writes `item_status` + calls `markItemsNew` after matching. `matching.ts` accepts exclusion set. `trigger.ts` adds playlist change detection.
- **Worker**: `poll.ts` Result checking fixes (already applied). Chain error recovery (already applied).
- **Server functions**: `liked-songs.functions.ts` actions rewritten to target `match_decision`.
- **Queries**: `status-queries.ts` ActionType simplified. New `match-decision-queries.ts`. Badge/stats queries rewritten.
- **Migrations**: Supabase CLI local-only via `supabase migration new`, applied with `supabase migrate up`.
