# Migration v2: Schema

> Column-level current → v2 mapping.

---

## Tables Overview

| Current | v2 | Change |
|---------|-----|--------|
| `users` | `account` | Rename + simplify |
| `user_preferences` | — | DROP (#017) |
| `provider_keys` | — | DROP (#016) |
| `tracks` | `song` | Rename |
| `audio_features` | `song_audio_feature` | Rename |
| `saved_tracks` | `liked_song` | Rename + soft delete |
| `track_analyses` | `song_analysis` | Rename + metadata |
| `playlists` | `playlist` | `is_flagged` → `is_destination` |
| `playlist_tracks` | `playlist_song` | Drop `user_id` (#020) |
| `playlist_analyses` | `playlist_analysis` | Rename + metadata |
| `track_embeddings` | `song_embedding` | Rename |
| `track_genres` | `song_genre` | Rename |
| `playlist_profiles` | `playlist_profile` | Rename |
| `match_contexts` | `match_context` | Keep |
| `match_results` | `match_result` | Keep |
| `analysis_jobs` | `job` | Unified (#021) |
| `track_analysis_attempts` | `job_failure` | Rename |
| `track_playlist_matches` | — | DROP (→ match_result) |
| — | `item_status` | NEW (newness tracking) |
| — | `user_preferences` | NEW (settings + onboarding) |

---

## account (was `users`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `spotify_id` | TEXT NOT NULL UNIQUE | Was `spotify_user_id` |
| `email` | TEXT | Was `spotify_user_email` |
| `display_name` | TEXT | NEW |
| `theme` | TEXT DEFAULT 'dark' | NEW (#015) |
| `has_completed_setup` | BOOLEAN | Renamed |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | NEW |
| ~~`last_login`~~ | — | DROP |
| ~~`songs_sync_status`~~ | — | DROP → job |
| ~~`songs_last_sync`~~ | — | DROP → job |
| ~~`playlists_sync_status`~~ | — | DROP → job |
| ~~`playlists_last_sync`~~ | — | DROP → job |

**Indexes**: `spotify_id` (unique)

---

## song (was `tracks`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `spotify_id` | TEXT NOT NULL UNIQUE | Was `spotify_track_id` |
| `isrc` | TEXT | NEW (cross-platform matching) |
| `name` | TEXT NOT NULL | — |
| `artist_name` | TEXT NOT NULL | Was `artist` |
| `album_name` | TEXT | Was `album` |
| `image_url` | TEXT | NEW (album art) |
| `duration_ms` | INTEGER | NEW |
| `created_at` | TIMESTAMPTZ | — |

**Indexes**: `spotify_id` (unique), `isrc`

---

## liked_song (was `saved_tracks`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `account_id` | UUID FK | Was `user_id` INTEGER |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `liked_at` | TIMESTAMPTZ | — |
| `unliked_at` | TIMESTAMPTZ | NEW (#010) |
| `status` | TEXT | Was `sorting_status` (values: NULL, matched, ignored) |

**Indexes**: `account_id`, `(account_id) WHERE unliked_at IS NULL AND status IS NULL`
**Constraint**: UNIQUE(account_id, song_id)

---

## playlist

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `account_id` | UUID FK | Was `user_id` INTEGER |
| `spotify_id` | TEXT NOT NULL | Was `spotify_playlist_id` |
| `name` | TEXT NOT NULL | — |
| `description` | TEXT | — |
| `is_destination` | BOOLEAN | Was `is_flagged` (#003) |
| `song_count` | INTEGER | Was `track_count` (#018) |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |
| ~~`tracks_sync_status`~~ | — | DROP → job |
| ~~`tracks_last_synced_at`~~ | — | DROP → job |

**Indexes**: `account_id`, `(account_id) WHERE is_destination = true`
**Constraint**: UNIQUE(account_id, spotify_id) (#019)

---

## playlist_song (was `playlist_tracks`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `playlist_id` | UUID FK | Was INTEGER |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `added_at` | TIMESTAMPTZ | — |
| ~~`user_id`~~ | — | DROP (#020) |

**Indexes**: `playlist_id`, `song_id`
**Constraint**: UNIQUE(playlist_id, song_id)

---

## song_audio_feature (was `audio_features`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `song_id` | UUID FK UNIQUE | Was `track_id` INTEGER |
| `acousticness` | REAL | Was DOUBLE PRECISION |
| `danceability` | REAL | — |
| `energy` | REAL | — |
| `instrumentalness` | REAL | — |
| `liveness` | REAL | — |
| `loudness` | REAL | — |
| `speechiness` | REAL | — |
| `tempo` | REAL | — |
| `valence` | REAL | — |
| `created_at` | TIMESTAMPTZ | — |
| ~~`spotify_track_id`~~ | — | DROP (redundant) |

**Indexes**: `song_id` (unique)

---

## song_analysis (was `track_analyses`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `analysis` | JSONB NOT NULL | — |
| `model` | TEXT NOT NULL | Was `model_name` |
| `prompt_version` | TEXT | NEW (#024) |
| `tokens_used` | INTEGER | NEW (#024) |
| `cost_cents` | INTEGER | NEW (#024) |
| `created_at` | TIMESTAMPTZ | — |
| ~~`version`~~ | — | DROP (#025: query by created_at) |

**Indexes**: `(song_id, created_at DESC)`

---

## playlist_analysis (was `playlist_analyses`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `playlist_id` | UUID FK | Was INTEGER |
| `analysis` | JSONB NOT NULL | — |
| `model` | TEXT NOT NULL | Was `model_name` |
| `prompt_version` | TEXT | NEW |
| `tokens_used` | INTEGER | NEW |
| `cost_cents` | INTEGER | NEW |
| `created_at` | TIMESTAMPTZ | — |
| ~~`user_id`~~ | — | DROP (via playlist) |
| ~~`version`~~ | — | DROP |

**Indexes**: `(playlist_id, created_at DESC)`

---

## song_embedding (was `track_embeddings`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was BIGINT |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `kind` | TEXT NOT NULL | Was `embedding_kind` |
| `model` | TEXT NOT NULL | Was `model_name` |
| `model_version` | TEXT NOT NULL | — |
| `dims` | INTEGER NOT NULL | — |
| `content_hash` | TEXT NOT NULL | — |
| `embedding` | vector(1024) NOT NULL | — |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |

**Indexes**: `song_id`, `(song_id, kind, model, model_version, content_hash)` unique, HNSW on `embedding`

---

## song_genre (was `track_genres`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was BIGINT |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `source` | TEXT NOT NULL | — |
| `source_level` | TEXT NOT NULL | — |
| `content_hash` | TEXT NOT NULL | — |
| `genres` | TEXT[] | — |
| `scores` | JSONB | Was `genres_with_scores` |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |

**Indexes**: `song_id`, `(song_id, source, content_hash)` unique

---

## playlist_profile (was `playlist_profiles`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was BIGINT |
| `playlist_id` | UUID FK | Was INTEGER |
| `kind` | TEXT NOT NULL | Was `profile_kind` |
| `model_bundle_hash` | TEXT NOT NULL | — |
| `dims` | INTEGER NOT NULL | — |
| `content_hash` | TEXT NOT NULL | — |
| `embedding` | vector(1024) | — |
| `audio_centroid` | JSONB | — |
| `genre_distribution` | JSONB | — |
| `emotion_distribution` | JSONB | — |
| `song_count` | INTEGER | Was `track_count` |
| `song_ids` | UUID[] | Was `track_ids` INTEGER[] |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |
| ~~`user_id`~~ | — | DROP (via playlist) |

**Indexes**: `playlist_id`, `(playlist_id, kind, model_bundle_hash, content_hash)` unique, HNSW on `embedding`

---

## match_context (unchanged name)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was BIGINT |
| `account_id` | UUID FK | Was `user_id` INTEGER |
| `embedding_model` | TEXT NOT NULL | Was `embedding_model_name` |
| `embedding_version` | TEXT NOT NULL | Was `embedding_model_version` |
| `reranker_model` | TEXT | Shortened |
| `reranker_version` | TEXT | Shortened |
| `emotion_model` | TEXT | Shortened |
| `emotion_version` | TEXT | Shortened |
| `algorithm_version` | TEXT NOT NULL | — |
| `config_hash` | TEXT NOT NULL | — |
| `playlist_set_hash` | TEXT NOT NULL | — |
| `candidate_set_hash` | TEXT NOT NULL | — |
| `context_hash` | TEXT NOT NULL UNIQUE | — |
| `created_at` | TIMESTAMPTZ | — |

**Indexes**: `account_id`, `context_hash` (unique)

---

## match_result (unchanged name)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was BIGINT |
| `context_id` | UUID FK | Was `match_context_id` |
| `song_id` | UUID FK | Was `track_id` INTEGER |
| `playlist_id` | UUID FK | Was INTEGER |
| `score` | NUMERIC(10,6) NOT NULL | — |
| `factors` | JSONB NOT NULL | — |
| `rank` | INTEGER | — |
| `created_at` | TIMESTAMPTZ | — |

**Indexes**: `context_id`, `(context_id, playlist_id, score DESC)`
**Constraint**: UNIQUE(context_id, song_id, playlist_id)

---

## job (was `analysis_jobs`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | — |
| `account_id` | UUID FK | Was `user_id` INTEGER |
| `type` | TEXT NOT NULL | Was `job_type` |
| `status` | TEXT NOT NULL | Was ENUM |
| `progress` | JSONB | NEW (#022) |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |
| ~~`batch_id`~~ | — | DROP |
| ~~`item_count`~~ | — | → progress.total |
| ~~`items_processed`~~ | — | → progress.done |
| ~~`items_succeeded`~~ | — | → progress.succeeded |
| ~~`items_failed`~~ | — | → progress.failed |
| ~~`item_ids`~~ | — | DROP |

**Indexes**: `account_id`, `(account_id, status)`

---

## job_failure (was `track_analysis_attempts`)

| Column | Type | Change |
|--------|------|--------|
| `id` | UUID | Was INTEGER |
| `job_id` | UUID FK | Was TEXT |
| `item_type` | TEXT NOT NULL | NEW (song/playlist) |
| `item_id` | UUID NOT NULL | Was `track_id` INTEGER |
| `error_type` | TEXT | — |
| `error_message` | TEXT | — |
| `created_at` | TIMESTAMPTZ | — |
| ~~`status`~~ | — | DROP |
| ~~`updated_at`~~ | — | DROP |

**Indexes**: `job_id`, `(job_id, item_type)`

---

## item_status (NEW)

> Tracks "newness" for UI badges ("20 new songs ready to match")

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `account_id` | UUID FK | — |
| `item_type` | TEXT NOT NULL | 'song', 'match', 'analysis', 'playlist' |
| `item_id` | UUID NOT NULL | References song.id, match_result.id, etc. |
| `is_new` | BOOLEAN DEFAULT true | Main flag for UI |
| `first_appeared_at` | TIMESTAMPTZ | When item became "new" |
| `viewed_at` | TIMESTAMPTZ | When user first viewed (clears is_new) |
| `actioned_at` | TIMESTAMPTZ | When user took action (add to playlist, skip) |
| `action_type` | TEXT | 'added_to_playlist', 'skipped', 'dismissed' |

**Indexes**: `(account_id, item_type) WHERE is_new = true`, `(account_id, item_type, item_id)` unique
**Constraint**: UNIQUE(account_id, item_type, item_id)

**Clearing strategies:**
- View-based: Set `viewed_at`, clear `is_new` after 2s in viewport
- Action-based: Set `actioned_at` + `action_type`, clear `is_new`
- Age-based: Cron clears items older than 7 days
- Explicit: "Mark all as read" button

---

## user_preferences (NEW)

> User settings and onboarding state. Separate from account for clean separation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | — |
| `account_id` | UUID FK UNIQUE | One preferences row per account |
| `theme` | TEXT DEFAULT 'blue' | Color palette: 'blue', 'green', 'rose', 'lavender' |
| `onboarding_step` | TEXT DEFAULT 'welcome' | Current onboarding step |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |

**Indexes**: `account_id` (unique)

**Onboarding steps**: `'welcome'`, `'pick-color'`, `'connecting'`, `'syncing'`, `'flag-playlists'`, `'ready'`, `'complete'`

**Future columns** (add when needed):
- `theme_mode` TEXT — `'light'`, `'dark'`
- `matching_view` TEXT — `'split'`, `'card'`, `'timeline'`

---

## Resolved Questions

| Question | Decision |
|----------|----------|
| Add `display_name` to account? | ✅ Yes |
| Store artists as array? | ❌ Keep simple TEXT |
| Add `isrc` to song? | ✅ Yes (future cross-platform) |
| Add `image_url` to song? | ✅ Yes (album art) |
| Keep sorting status on liked_song? | ✅ Yes, renamed to `status` (NULL/matched/ignored) |
| Add newness tracking? | ✅ Yes, `item_status` table |
| User preferences storage? | ✅ Separate `user_preferences` table (clean separation from account) |
| `view_count` on item_status? | ❌ Timestamp only (`viewed_at`) — simpler, we clear on first view |
| Onboarding state storage? | ✅ `user_preferences.onboarding_step` column |
| Theme storage? | ✅ `user_preferences.theme` (color palette: blue/green/rose/lavender) |
| Monetization tables? | ❌ Add later (not in v2 initial schema) |

---

*Schema complete. Next: 02-SERVICES.md*
