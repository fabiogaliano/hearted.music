## Context

The enrichment pipeline processes liked songs through 6 stages: audio features, genre tagging, song analysis, song embedding, playlist profiling, and matching. The pipeline uses `item_status` for both batch selection (determining which songs need processing) and tracking user actions on match suggestions. This dual role creates several problems:

1. **Infinite loop**: `item_status` is written by UI actions, not the pipeline. Songs processed by the pipeline but not yet acted on by the user are re-selected indefinitely.
2. **Shared data blindness**: Song data (audio features, analysis, embeddings) is shared across users. When User A enriches a song, User B's pipeline skips it entirely because the shared artifacts exist — but matching never runs for User B.
3. **Per-song action granularity**: `item_status` stores one `action_type` per song, but the matching UI shows per-playlist suggestions. Adding song X to playlist A loses the pending suggestion for playlist B.
4. **No re-matching**: When playlist profiles change (tracks, name, description — anything that affects the profile), there's no mechanism to re-evaluate previously processed songs against the new profiles.

Current relevant files:
- `src/lib/workflows/enrichment-pipeline/batch.ts` — batch selection using `getFullyEnrichedSongIds`
- `src/lib/workflows/enrichment-pipeline/orchestrator.ts` — chunk execution, does NOT write `item_status`
- `src/lib/workflows/enrichment-pipeline/stages/matching.ts` — matching stage
- `src/lib/domains/library/liked-songs/status-queries.ts` — `item_status` CRUD, `ActionType` enum
- `src/lib/server/liked-songs.functions.ts` — `addSongToPlaylist`, `skipSong`, `dismissSong`
- `src/lib/domains/taste/song-matching/service.ts` — `matchBatch`, `scoreSongToPlaylist`
- `src/lib/domains/taste/song-matching/cache.ts` — context hash computation
- `supabase/migrations/20260117000010_create_item_status.sql` — `item_status` schema

## Goals / Non-Goals

**Goals:**
- Separate pipeline processing state from user actions into distinct tables
- Track user decisions per (song, playlist) pair, not per song
- Enable re-matching when playlist profiles change without re-running data enrichment
- Eliminate infinite re-processing loops in the enrichment pipeline
- Correctly handle shared song data across users (User B's matching runs even if User A already enriched the song)
- Skip already-decided (song, playlist) pairs at match time, not just display time

**Non-Goals:**
- Changing the matching algorithm or scoring weights
- Adding real-time/automatic re-matching (only triggered on user-initiated sync)
- Implementing the actual Spotify playlist write (adding track to playlist via API) — tracked separately
- Changing the enrichment pipeline's chunking/chaining architecture
- Adding undo support for match decisions

## Decisions

### 1. New `match_decision` table for per-playlist user actions

**Decision**: Create a `match_decision` table with `UNIQUE(account_id, song_id, playlist_id)` to track permanent user decisions per (song, playlist) pair.

**Alternatives considered**:
- *Extend `item_status` with `playlist_id`*: Would change the unique constraint and break all existing queries. `item_status` serves other purposes (newness tracking for non-matching items like playlists, analyses).
- *Add `user_action` column to `match_result`*: `match_result` is per-context (recreated on re-match). User decisions need to persist across matching contexts.
- *Keep per-song actions, add a junction table*: Half-measure that doesn't cleanly separate concerns.

**Decision types**:
- `'added'` — user placed this song in this playlist (permanent)
- `'dismissed'` — user explicitly rejected this song for this playlist (permanent)
- Skip/Next — UI-only state, not persisted. Song reappears on next visit.
- "Dismiss" in UI — batch insert of `'dismissed'` for all currently shown playlists

### 2. `item_status` becomes a pipeline processing tracker only

**Decision**: Remove `action_type` and `actioned_at` from `item_status`. Row existence means "pipeline has processed this song for this user." `is_new` and `viewed_at` remain for general newness tracking.

**Rationale**: Separating concerns eliminates the conflation that causes loops and lost context. The pipeline writes `item_status` after processing, and never needs to know about user decisions.

**Migration**: Since the app is pre-production, this is a clean removal — no data migration needed. Drop the columns in a new migration.

### 3. Two-mode batch selection in `getFullyEnrichedSongIds`

**Decision**: Batch selection checks 4 shared artifacts + `item_status` (per-user). The `hasMoreSongs` probe uses a narrow check (4 artifacts only) when matching was skipped (no playlists), and the full check otherwise.

**Rationale**: This handles all cases:
- New songs (no artifacts, no item_status) → full pipeline
- Songs enriched by another user (has artifacts, no item_status for this user) → selected, stages A-D skip, matching runs
- Fully processed songs (has artifacts + item_status) → excluded
- No playlists scenario → `hasMoreSongs` only considers data enrichment needs → no loop

### 4. Re-match as a separate operation from the pipeline

**Decision**: Re-matching is a distinct operation that runs matching on all data-enriched songs without going through stages A-D. Triggered when `playlistSetHash` differs from the latest `match_context.playlist_set_hash`.

**Alternatives considered**:
- *Clear `item_status` and re-run the full pipeline*: Wastes compute on stages A-D (data already exists). Also re-enters the chaining system unnecessarily.
- *Embed re-match logic in the pipeline*: Complicates the orchestrator with conditional batch selection modes.

**Re-match scope**: ALL songs are candidates (not just previously unmatched). When playlist C is added, songs already matched to A and B should also be evaluated against C. The exclusion set (match_decisions + playlist_songs) prevents redundant suggestions.

### 5. Exclusion set loaded at match time

**Decision**: Before `matchBatch` runs, load `match_decision` rows (added + declined) and `playlist_song` rows for the account. Skip excluded (song, playlist) pairs during scoring — no `match_result` rows created for them.

**Rationale**: Filtering at match time (not display time) means `match_result` only contains actionable suggestions. Badge count becomes a simple count on `match_result` for the latest context, with no joins needed against `match_decision`.

### 6. Pipeline writes `item_status` after matching completes

**Decision**: The orchestrator writes `item_status` for ALL batch songs after `matchSongs` completes. Also calls `markItemsNew` for songs that received match suggestions.

**What `markItemsNew` gets called with**: Songs where `matchBatch` returned results (score >= 0.3 for at least one non-excluded playlist). This requires `runMatching` to return matched song IDs, not just counts.

### 7. Matching status derived at read time

**Decision**: The `get_liked_songs_page` RPC derives matching status from `match_result` + `match_decision` composition, not from `item_status.action_type`.

**Derivation**:
- Song has `match_result` rows in latest context with no corresponding `match_decision` → has actionable suggestions
- Song has `match_result` rows but all covered by `match_decision` → fully acted upon
- Song has no `match_result` rows → no suggestions
- `match_decision` with `'dismissed'` for all shown playlists = "dismissed" in old terminology

### 8. Schema migrations via Supabase CLI

**Decision**: All schema changes created as local migrations via `supabase migration new`, applied locally with `supabase migrate up`. Once everything is verified correct locally, sync to prod via `supabase db push`.

## Risks / Trade-offs

**[Risk] Badge count query complexity** → The badge count now requires querying `match_result` for the latest context instead of a simple `COUNT` on `item_status`. Mitigated by the fact that `match_result` is already indexed on `context_id` and the latest context lookup is a single-row subquery.

**[Risk] Re-match performance for large libraries** → Re-matching ALL songs on playlist change could be expensive for users with thousands of liked songs. Mitigated by: (1) context hash dedup prevents re-computation when nothing actually changed, (2) the exclusion set reduces the scoring work, (3) matching is CPU-bound scoring, not API calls.

**[Risk] `match_decision` accumulates over time** → As users act on suggestions across multiple re-match cycles, the `match_decision` table grows. Not a concern at current scale. Could add a cleanup job later if needed.

**[Risk] Breaking existing `item_status` consumers** → Any code reading `action_type` from `item_status` will break. Mitigated by pre-production status — no live users. All consumers identified in proposal.

**[Trade-off] Skip not persisted** → Users who skip a song and close the browser lose their skip state. Accepted trade-off — skip is "not now," and the matching page should handle session state internally.

## Resolved Questions

1. **Should `match_decision` have a `context_id` reference?** No. Decisions are context-independent — decline is permanent per-playlist, persists across re-matching runs. No `context_id` column needed.

2. **Badge count: count songs or count suggestions?** Songs. Two variants: sidebar badge shows total actionable songs (all songs with `match_result` in latest context), dashboard shows only new songs (`match_result` joined with `item_status.is_new = true`). Matching page orders new songs first, then previously seen/skipped.
