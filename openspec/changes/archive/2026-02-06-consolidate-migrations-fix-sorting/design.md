## Context

Code review surfaced two SQL bugs and a design drift in how sorting status is tracked. The app has two tables that could track sorting: `liked_song.status` (per original spec) and `item_status` (newness system). In practice, only `item_status` is written to when users act on songs. The SQL functions `get_liked_songs_page` and `get_liked_songs_stats` read from `liked_song.status` which is never populated, returning wrong results.

Additionally, since the app is pre-production, 8 migrations that modify earlier ones can be consolidated back into their originals for a cleaner migration history.

## Goals / Non-Goals

**Goals:**
- Establish `item_status` as the single source of truth for sorting status
- Fix duplicate row bug in `get_liked_songs_page` caused by bare LEFT JOIN on `song_analysis`
- Fix `get_liked_songs_stats` to return accurate sorted/unsorted counts
- Consolidate migration files (33 → 25) by folding modifications back into originals

**Non-Goals:**
- Changing the `item_status` schema (columns, indexes) — current schema is sufficient
- Building filter UI for the liked songs page — that's a separate change
- Modifying any frontend components — server mapping handles the abstraction

## Decisions

### 1. Remove `liked_song.status` column entirely

**Choice**: Drop the column from the create migration rather than keeping it unused.

**Alternatives considered**:
- Keep column and implement dual-write → adds complexity for zero benefit, already proven fragile
- Keep column as deprecated → dead code confusion for future development

**Rationale**: The column is never written to. `item_status` already captures richer data (action_type, actioned_at). A single source of truth eliminates the sync problem.

### 2. Derive sorting status from `item_status` presence

**Choice**: A song is "sorted" when an `item_status` record exists with `actioned_at IS NOT NULL`. A song is "unsorted" when no `item_status` record exists for it.

**Mapping**:
| item_status state | Sorting status |
|---|---|
| No record | `unsorted` |
| `action_type = 'added_to_playlist'` | `sorted` |
| `action_type = 'skipped'` | `ignored` |
| `action_type = 'dismissed'` | `ignored` |

**Rationale**: Aligns with how `updateStatus()` in `liked-song.ts` already works. The function upserts into `item_status` with an `action_type` — this is the canonical write path.

### 3. Use LEFT JOIN LATERAL for song_analysis

**Choice**: Replace `LEFT JOIN song_analysis sa ON sa.song_id = s.id` with a LATERAL subquery that selects only the latest analysis.

```sql
LEFT JOIN LATERAL (
  SELECT sa.id, sa.analysis, sa.model, sa.created_at
  FROM song_analysis sa
  WHERE sa.song_id = s.id
  ORDER BY sa.created_at DESC
  LIMIT 1
) sa ON true
```

**Alternatives considered**:
- `DISTINCT ON (ls.id)` → harder to reason about with existing `ORDER BY ls.liked_at DESC` and cursor pagination
- Add UNIQUE constraint on `song_analysis.song_id` → violates intentional design (multiple analyses per song allowed for different models/versions)

**Rationale**: LATERAL + LIMIT 1 guarantees one row per song. The existing index `idx_song_analysis_song_created ON song_analysis(song_id, created_at DESC)` serves this perfectly.

### 4. Consolidate migrations by folding forward changes back

**Choice**: Edit original migration files to include later additions, then delete the now-empty modification migrations.

**Groups to consolidate**:

| Original | Fold in | Delete |
|---|---|---|
| `create_playlist.sql` | `image_url` column | `add_image_url_to_playlist.sql`, `add_playlist_is_destination.sql` (NO-OP) |
| `create_user_preferences.sql` | `phase_job_ids` column, nullable `theme` | `add_current_job_id.sql`, `make_theme_nullable.sql` |
| `create_app_token.sql` | RLS policy | `add_app_token_rls_policy.sql` |
| `create_song.sql` | `artist_ids` column | `add_artist_ids_to_song.sql` |
| `add_liked_songs_page_function.sql` | v2 with LATERAL + item_status | `update_liked_songs_page_function.sql` |
| `create_job.sql` | `sync_playlist_tracks` enum value | `add_sync_playlist_tracks_job_type.sql` |

### 5. Update `get_liked_songs_page` return type

**Choice**: Add `sorting_status TEXT` to the return columns (derived from `item_status.action_type`) and remove `status TEXT` (which came from `liked_song.status`).

**Rationale**: The server mapping at `liked-songs.server.ts:74` reads `row.status` and casts it to `SortingStatus`. By returning a computed `sorting_status` column from the RPC, the server mapping becomes a direct pass-through. Values returned: `'sorted'`, `'ignored'`, or `NULL` (for unsorted).

### 6. Update `get_liked_songs_stats` to JOIN item_status

**Choice**: Replace `ls.status` counts with `item_status` JOIN:

```sql
COUNT(*) FILTER (WHERE ist.actioned_at IS NOT NULL
  AND ist.action_type = 'added_to_playlist') AS sorted,
COUNT(*) FILTER (WHERE ist.id IS NULL
  OR ist.actioned_at IS NULL) AS unsorted
```

## Risks / Trade-offs

- **[Risk] Migration consolidation requires `supabase db reset`** → Only affects local dev. No production data exists. Run `supabase db reset --local` after changes.
- **[Risk] Regenerated `database.types.ts` may cause type errors** → Run type generation after reset and fix any mismatches before committing.
- **[Trade-off] `item_status` does double duty (newness + sorting)** → Acceptable because the data naturally overlaps. An action like "added_to_playlist" is both a sorting event and a newness-clearing event. No need for separate tables.
