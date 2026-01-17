# Migration v2: Implementation Plan

> Phased migration from v0 → v2 with checkboxes for tracking progress.

---

## Overview

```
Phase 0: Foundation ─────────────────────────────┐
    ↓                                            │
Phase 1: Schema DDL (17 tables + RLS)            │ Sequential
    ↓                                            │
Phase 2: Extensions & Types                      │
    ↓                                            ┘
Phase 3: Query Modules (9 files) ────────────────┐
    ↓                                            │
┌───────────┬─────────────┬─────────────┬────────┤
│ Phase 4a  │  Phase 4b   │  Phase 4c   │ 4d     │ Can parallelize
│ Factories │  Pipeline   │ Playlist    │ DeepInf│
└─────┬─────┴──────┬──────┴──────┬──────┴───┬────┘
      └────────────┼─────────────┴──────────┘    │
    ↓              ↓                             ┘
Phase 5: SSE Migration ──────────────────────────┐
    ↓                                            │ Sequential
Phase 6: Cleanup & Smoke Tests                   │
    ↓                                            │
Phase 7: UI Integration Begins                   ┘
```

**Estimated migration files**: 17 SQL + 9 query modules + ~10 service changes

---

## Phase 0: Foundation

> Set up fresh Supabase project and tooling.

### Tasks

- [ ] Create new Supabase project (or reset dev project)
- [ ] Note project URL and keys in `.env.local`
- [ ] Install Supabase CLI if not present (`bun add -D supabase`)
- [ ] Initialize Supabase locally (`supabase init` if needed)
- [ ] Verify `supabase/migrations/` directory exists

### Verification

```bash
supabase status  # Should show local project info
```

---

## Phase 1: Schema DDL

> Create all 17 tables with RLS enabled (deny-all policies; service-role access only). One migration file per table.

### Migration Order (respects foreign keys)

Dependencies flow top-to-bottom. Tables in the same tier can be created in any order.

```
Tier 1 (no dependencies):
├── account
└── song

Tier 2 (depends on Tier 1):
├── liked_song          → account, song
├── playlist            → account
├── song_audio_feature  → song
├── song_analysis       → song
├── song_embedding      → song
└── job                 → account

Tier 3 (depends on Tier 2):
├── playlist_song       → playlist, song
├── playlist_analysis   → playlist
├── playlist_profile    → playlist
├── job_failure         → job
├── match_context       → account
├── item_status         → account
└── user_preferences    → account

Tier 4 (depends on Tier 3):
└── match_result        → match_context, song, playlist
```

### Tasks

#### Tier 1: Core Entities

- [ ] `001_create_account.sql`
  ```sql
  -- account (was users)
  CREATE TABLE account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spotify_id TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_account_spotify_id ON account(spotify_id);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE account ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "account_deny_all"
    ON account FOR ALL
    USING (false);
  ```

- [ ] `002_create_song.sql`
  ```sql
  -- song (was tracks) - Global catalog, not user-owned
  CREATE TABLE song (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spotify_id TEXT NOT NULL UNIQUE,
    isrc TEXT,
    name TEXT NOT NULL,
    artists TEXT[] NOT NULL DEFAULT '{}',
    album_name TEXT,
    album_id TEXT,
    image_url TEXT,
    duration_ms INTEGER,
    popularity INTEGER,
    preview_url TEXT,
    genres TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_song_spotify_id ON song(spotify_id);
  CREATE INDEX idx_song_isrc ON song(isrc) WHERE isrc IS NOT NULL;
  CREATE INDEX idx_song_genres ON song USING GIN(genres);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE song ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "song_deny_all"
    ON song FOR ALL
    USING (false);
  ```

#### Tier 2: User-Owned & Song Extensions

- [ ] `003_create_liked_song.sql`
  ```sql
  -- liked_song (was saved_tracks)
  CREATE TABLE liked_song (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    liked_at TIMESTAMPTZ NOT NULL,
    unliked_at TIMESTAMPTZ,  -- NULL = active, non-NULL = soft deleted
    status TEXT,  -- NULL = pending, 'matched', 'ignored'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(account_id, song_id)
  );

  CREATE INDEX idx_liked_song_account ON liked_song(account_id);
  CREATE INDEX idx_liked_song_pending ON liked_song(account_id)
    WHERE unliked_at IS NULL AND status IS NULL;

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE liked_song ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "liked_song_deny_all"
    ON liked_song FOR ALL
    USING (false);
  ```

- [ ] `004_create_playlist.sql`
  ```sql
  -- playlist
  CREATE TABLE playlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    spotify_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    snapshot_id TEXT,
    is_public BOOLEAN DEFAULT false,
    is_destination BOOLEAN DEFAULT false,
    song_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(account_id, spotify_id)
  );

  CREATE INDEX idx_playlist_account ON playlist(account_id);
  CREATE INDEX idx_playlist_spotify_id ON playlist(spotify_id);
  CREATE INDEX idx_playlist_destination ON playlist(account_id)
    WHERE is_destination = true;

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE playlist ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "playlist_deny_all"
    ON playlist FOR ALL
    USING (false);
  ```

- [ ] `005_create_song_audio_feature.sql`
  ```sql
  -- song_audio_feature (was audio_features)
  CREATE TABLE song_audio_feature (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL UNIQUE REFERENCES song(id) ON DELETE CASCADE,
    acousticness REAL,
    danceability REAL,
    energy REAL,
    instrumentalness REAL,
    liveness REAL,
    loudness REAL,
    speechiness REAL,
    tempo REAL,
    time_signature INTEGER,
    key INTEGER,
    mode INTEGER,
    valence REAL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_song_audio_feature_song ON song_audio_feature(song_id);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE song_audio_feature ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "song_audio_feature_deny_all"
    ON song_audio_feature FOR ALL
    USING (false);
  ```

- [ ] `006_create_song_analysis.sql`
  ```sql
  -- song_analysis (was track_analyses) - Global, no user ownership
  CREATE TABLE song_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    analysis JSONB NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT,
    tokens_used INTEGER,
    cost_cents INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_song_analysis_song_created ON song_analysis(song_id, created_at DESC);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE song_analysis ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "song_analysis_deny_all"
    ON song_analysis FOR ALL
    USING (false);
  ```

- [ ] `007_create_song_embedding.sql`
  ```sql
  -- song_embedding (was track_embeddings) - Global
  CREATE TABLE song_embedding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    model_version TEXT NOT NULL,
    dims INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector(1024) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(song_id, kind, model, model_version, content_hash)
  );

  CREATE INDEX idx_song_embedding_song ON song_embedding(song_id);
  CREATE INDEX idx_song_embedding_hnsw ON song_embedding
    USING hnsw (embedding vector_cosine_ops);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE song_embedding ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "song_embedding_deny_all"
    ON song_embedding FOR ALL
    USING (false);
  ```

- [ ] `009_create_job.sql`
  ```sql
  -- job (unified, was analysis_jobs + inline sync statuses)
  -- Migrates: analysis_jobs.job_type='track_batch' → 'song_analysis'
  --           analysis_jobs.job_type='playlist' → 'playlist_analysis'
  --           users.songs_sync_status → 'sync_liked_songs'
  --           users.playlists_sync_status → 'sync_playlists'
  CREATE TABLE job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type job_type NOT NULL,  -- 'sync_liked_songs', 'sync_playlists', 'song_analysis', 'playlist_analysis', 'matching'
    status job_status NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
    progress JSONB DEFAULT '{}',  -- { total: 100, done: 50, succeeded: 48, failed: 2 }
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_job_account ON job(account_id);
  CREATE INDEX idx_job_account_status ON job(account_id, status);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE job ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "job_deny_all"
    ON job FOR ALL
    USING (false);
  ```

#### Tier 3: Dependent Tables

- [ ] `010_create_playlist_song.sql`
  ```sql
  -- playlist_song (was playlist_tracks)
  CREATE TABLE playlist_song (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(playlist_id, song_id)
  );

  CREATE INDEX idx_playlist_song_playlist ON playlist_song(playlist_id);
  CREATE INDEX idx_playlist_song_song ON playlist_song(song_id);
  CREATE INDEX idx_playlist_song_position ON playlist_song(playlist_id, position);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE playlist_song ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "playlist_song_deny_all"
    ON playlist_song FOR ALL
    USING (false);
  ```

- [ ] `011_create_playlist_analysis.sql`
  ```sql
  -- playlist_analysis (was playlist_analyses)
  CREATE TABLE playlist_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    analysis JSONB NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT,
    tokens_used INTEGER,
    cost_cents INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_playlist_analysis_playlist_created
    ON playlist_analysis(playlist_id, created_at DESC);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE playlist_analysis ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "playlist_analysis_deny_all"
    ON playlist_analysis FOR ALL
    USING (false);
  ```

- [ ] `012_create_playlist_profile.sql`
  ```sql
  -- playlist_profile (was playlist_profiles)
  CREATE TABLE playlist_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    model_bundle_hash TEXT NOT NULL,
    dims INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector(1024),
    audio_centroid JSONB,
    genre_distribution JSONB,
    emotion_distribution JSONB,
    song_count INTEGER DEFAULT 0,
    song_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(playlist_id, kind, model_bundle_hash, content_hash)
  );

  CREATE INDEX idx_playlist_profile_playlist ON playlist_profile(playlist_id);
  CREATE INDEX idx_playlist_profile_hnsw ON playlist_profile
    USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE playlist_profile ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "playlist_profile_deny_all"
    ON playlist_profile FOR ALL
    USING (false);
  ```

- [ ] `013_create_job_failure.sql`
  ```sql
  -- job_failure (was track_analysis_attempts)
  CREATE TABLE job_failure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,  -- 'song', 'playlist'
    item_id UUID NOT NULL,
    error_type TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_job_failure_job ON job_failure(job_id);
  CREATE INDEX idx_job_failure_job_type ON job_failure(job_id, item_type);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE job_failure ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "job_failure_deny_all"
    ON job_failure FOR ALL
    USING (false);
  ```

- [ ] `014_create_match_context.sql`
  ```sql
  -- match_context
  CREATE TABLE match_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    embedding_model TEXT NOT NULL,
    embedding_version TEXT NOT NULL,
    reranker_model TEXT,
    reranker_version TEXT,
    emotion_model TEXT,
    emotion_version TEXT,
    algorithm_version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    playlist_set_hash TEXT NOT NULL,
    candidate_set_hash TEXT NOT NULL,
    context_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_match_context_account ON match_context(account_id);
  CREATE INDEX idx_match_context_hash ON match_context(context_hash);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE match_context ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "match_context_deny_all"
    ON match_context FOR ALL
    USING (false);
  ```

- [ ] `015_create_item_status.sql`
  ```sql
  -- item_status (NEW - newness tracking)
  CREATE TABLE item_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,  -- 'song', 'match', 'analysis', 'playlist'
    item_id UUID NOT NULL,
    is_new BOOLEAN DEFAULT true,
    first_appeared_at TIMESTAMPTZ DEFAULT now(),
    viewed_at TIMESTAMPTZ,
    actioned_at TIMESTAMPTZ,
    action_type TEXT,  -- 'added_to_playlist', 'skipped', 'dismissed'
    UNIQUE(account_id, item_type, item_id)
  );

  CREATE INDEX idx_item_status_new ON item_status(account_id, item_type)
    WHERE is_new = true;

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE item_status ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "item_status_deny_all"
    ON item_status FOR ALL
    USING (false);
  ```

- [ ] `016_create_user_preferences.sql`
  ```sql
  -- user_preferences (NEW - separate from account for clean separation)
  CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL UNIQUE REFERENCES account(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'blue',  -- 'blue', 'green', 'rose', 'lavender'
    onboarding_step TEXT DEFAULT 'welcome',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_user_preferences_account ON user_preferences(account_id);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "user_preferences_deny_all"
    ON user_preferences FOR ALL
    USING (false);
  ```

#### Tier 4: Final Dependencies

- [ ] `017_create_match_result.sql`
  ```sql
  -- match_result
  CREATE TABLE match_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id UUID NOT NULL REFERENCES match_context(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    score NUMERIC(10,6) NOT NULL,
    factors JSONB NOT NULL,
    rank INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(context_id, song_id, playlist_id)
  );

  CREATE INDEX idx_match_result_context ON match_result(context_id);
  CREATE INDEX idx_match_result_context_playlist_score
    ON match_result(context_id, playlist_id, score DESC);

  -- RLS: deny-all (service_role bypasses)
  ALTER TABLE match_result ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "match_result_deny_all"
    ON match_result FOR ALL
    USING (false);
  ```

### Verification

```bash
supabase db reset  # Apply all migrations
supabase db lint   # Check for issues
```

---

## Phase 2: Extensions & Types

> Enable pgvector and set up type generation.

### Tasks

- [ ] Create `000_enable_extensions.sql` (runs before table migrations)
  ```sql
  -- Enable required extensions
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "vector";
  ```

- [ ] Generate TypeScript types
  ```bash
  supabase gen types typescript --local > app/types/database.types.ts
  ```

- [ ] Verify vector column types work
  ```bash
  # Quick test in SQL editor
  SELECT embedding <=> embedding FROM song_embedding LIMIT 1;
  ```

### Verification

- [ ] `database.types.ts` contains all 16 tables
- [ ] No TypeScript errors when importing types

---

## Phase 3: Query Modules

> Extract database operations from repositories/services into `data/*.ts` files.

### Tasks

Create 8 query modules in `app/lib/data/`:

- [x] `client.ts` — Supabase client setup
  ```typescript
  // Service role client for backend operations (deny-all RLS)
  export function getServiceClient() { ... }
  ```

- [x] `songs.ts` — From `TrackService`, `trackRepository`
  - [x] `getSongById(id: string)`
  - [x] `getSongBySpotifyId(spotifyId: string)`
  - [x] `getSongsBySpotifyIds(spotifyIds: string[])`
  - [x] `upsertSongs(songs: SongInsert[])`
  - [x] `getLikedSongs(accountId: string)`
  - [x] `upsertLikedSongs(likedSongs: LikedSongInsert[])`
  - [ ] `softDeleteLikedSong(accountId: string, songId: string)` — deferred
  - [ ] `getUnmatchedLikedSongs(accountId: string)` — deferred
  - [ ] `updateLikedSongStatus(accountId: string, songId: string, status)` — deferred

- [x] `playlists.ts` — From `PlaylistService` (DB ops only)
  - [x] `getPlaylists(accountId: string)`
  - [x] `getPlaylistById(id: string)`
  - [x] `getPlaylistBySpotifyId(accountId: string, spotifyId: string)`
  - [x] `getDestinationPlaylists(accountId: string)`
  - [x] `upsertPlaylists(playlists: PlaylistInsert[])`
  - [x] `deletePlaylist(id: string)`
  - [x] `setPlaylistDestination(id: string, isDestination: boolean)`
  - [x] `getPlaylistSongs(playlistId: string)`
  - [x] `upsertPlaylistSongs(playlistSongs: PlaylistSongInsert[])`
  - [x] `removePlaylistSongs(playlistId: string, songIds: string[])`

- [x] `analysis.ts` — From `trackAnalysisRepository`, `playlistAnalysisRepository`
  - [x] `getSongAnalysis(songIds: string | string[])`
  - [x] `insertSongAnalysis(analysis: SongAnalysisInsert)`
  - [x] `getPlaylistAnalysis(playlistId: string)`
  - [x] `insertPlaylistAnalysis(analysis: PlaylistAnalysisInsert)`
  - [x] `getSongAudioFeatures(songId: string)`
  - [x] `getSongAudioFeaturesBatch(songIds: string[])`
  - [x] `upsertSongAudioFeatures(features: SongAudioFeatureInsert[])`

- [x] `vectors.ts` — From `EmbeddingService` (DB ops), `embeddingRepository`
  - [x] `getSongEmbedding(songId: string, modelName: string)`
  - [x] `getSongEmbeddings(songId: string)`
  - [x] `getSongEmbeddingsBatch(songIds: string[], modelName: string)`
  - [x] `upsertSongEmbedding(embedding: SongEmbeddingInsert)`
  - [x] `upsertSongEmbeddings(embeddings: SongEmbeddingInsert[])`
  - [x] `getPlaylistProfile(playlistId: string)`
  - [x] `getPlaylistProfilesBatch(playlistIds: string[])`
  - [x] `upsertPlaylistProfile(profile: PlaylistProfileInsert)`

- [x] `matching.ts` — From `matchContextRepository`, `matchResultRepository`
  - [x] `getMatchContext(contextId: string)`
  - [x] `getLatestMatchContext(accountId: string)`
  - [x] `getMatchContexts(accountId: string)`
  - [x] `createMatchContext(context: MatchContextInsert)`
  - [x] `getMatchResults(contextId: string)`
  - [x] `getMatchResultsForSong(contextId: string, songId: string)`
  - [x] `getMatchResultsForSongs(contextId: string, songIds: string[])`
  - [x] `insertMatchResults(results: MatchResultInsert[])`
  - [x] `getTopMatchesPerPlaylist(contextId: string, limit: number)`
  - [x] `getBestMatchPerSong(contextId: string)`

- [x] `jobs.ts` — From `JobPersistenceService`
  - [x] `getJobById(id: string)`
  - [x] `getActiveJob(accountId: string, type: JobType)`
  - [x] `getLatestJob(accountId: string, type: JobType)`
  - [x] `getJobs(accountId: string, type?: JobType)`
  - [x] `createJob(accountId: string, type: JobType)`
  - [x] `updateJobProgress(id: string, progress: JobProgress)`
  - [x] `markJobRunning(id: string)`
  - [x] `markJobCompleted(id: string)`
  - [x] `markJobFailed(id: string, error?: string)`
  - [ ] `getJobFailures(jobId: string)` — deferred
  - [ ] `insertJobFailure(failure: JobFailureInsert)` — deferred

- [x] `accounts.ts` — From `UserService`
  - [x] `getAccountById(id: string)`
  - [x] `getAccountBySpotifyId(spotifyId: string)`
  - [x] `upsertAccount(account: AccountInsert)`
  - [ ] `updateAccountSetupComplete(id: string, complete: boolean)` — deferred

- [x] `newness.ts` — NEW for `item_status` table
  - [x] `getNewCounts(accountId: string)`
  - [x] `getNewItemIds(accountId: string, itemType: ItemType)`
  - [x] `getItemStatuses(accountId: string, itemType?: ItemType)`
  - [x] `markItemsNew(accountId: string, itemType: ItemType, itemIds: string[])`
  - [x] `markSeen(accountId: string, itemType: ItemType, itemIds: string[])`
  - [x] `markAllSeen(accountId: string, itemType: ItemType)`
  - [x] `recordAction(accountId: string, itemId: string, itemType: ItemType, actionType: ActionType)`
  - [x] `clearAction(accountId: string, itemId: string, itemType: ItemType)`

- [x] `preferences.ts` — NEW for `user_preferences` table
  - [x] `getPreferences(accountId: string)`
  - [x] `getOrCreatePreferences(accountId: string)`
  - [x] `updateTheme(accountId: string, theme: ThemeColor)`
  - [x] `getOnboardingStep(accountId: string)`
  - [x] `isOnboardingComplete(accountId: string)`
  - [x] `updateOnboardingStep(accountId: string, step: OnboardingStep)`
  - [x] `completeOnboarding(accountId: string)`
  - [x] `resetOnboarding(accountId: string)`

### Verification

- [x] Each module compiles without errors
- [ ] Old repositories still work (temporarily call new query modules)

---

## Phase 4a: Delete Factories

> Remove factory pattern, use direct imports.

**Can run in parallel with 4b and 4c.**

### Tasks

- [ ] Update `matching/` imports to direct
- [ ] Update `reranker/` imports to direct
- [ ] Update `embedding/` imports to direct
- [ ] Update `genre/` imports to direct
- [ ] Update `profiling/` imports to direct
- [ ] Update `llm/` imports to direct
- [ ] Delete factory files:
  - [ ] `matching/factory.ts`
  - [ ] `reranker/factory.ts`
  - [ ] `embedding/factory.ts`
  - [ ] `genre/factory.ts`
  - [ ] `profiling/factory.ts`
  - [ ] `llm/LlmProviderManagerFactory.ts`

### Verification

```bash
bun run typecheck  # No import errors
```

---

## Phase 4b: Merge Analysis Pipeline

> Consolidate batch/prefetch/progress into single `pipeline.ts`.

**Can run in parallel with 4a and 4c.**

### Tasks

- [ ] Create `analysis/pipeline.ts` combining:
  - `TrackPrefetchService.ts` logic
  - `PlaylistBatchProcessor.ts` logic
  - `ProgressNotifier.ts` logic
- [ ] Keep separate (cross-cutting):
  - `RetryPolicy.ts`
  - `RateLimitGate.ts`
- [ ] Update imports in analysis services
- [ ] Delete merged files:
  - [ ] `analysis/TrackPrefetchService.ts`
  - [ ] `analysis/PlaylistBatchProcessor.ts`
  - [ ] `analysis/ProgressNotifier.ts`

### Verification

- [ ] Analysis pipeline runs end-to-end
- [ ] Progress callbacks still work

---

## Phase 4c: Split PlaylistService

> Separate DB operations from Spotify API sync logic.

**Can run in parallel with 4a and 4b.**

### Tasks

- [ ] Move DB operations to `data/playlists.ts` (done in Phase 3)
- [ ] Create `services/sync/PlaylistSyncService.ts`:
  - [ ] `syncPlaylists(accountId: string)`
  - [ ] `syncPlaylistSongs(playlistId: string)`
  - [ ] `createPlaylist(name: string, description: string)`
  - [ ] `updatePlaylist(playlistId: string, updates: PlaylistUpdate)`
- [ ] Update `PlaylistService.ts` to delegate:
  - DB calls → `data/playlists.ts`
  - Sync calls → `PlaylistSyncService.ts`
- [ ] (Later) Delete `PlaylistService.ts` when all callers migrated

### Verification

- [ ] Playlist sync still works
- [ ] No duplicate code between files

---

## Phase 4d: DeepInfra API Migration

> Replace local Python vectorization service with DeepInfra hosted APIs. Same models, external hosting.

**Can run in parallel with Phase 4b/4c**

### Background

| Current                         | New                                                       |
| ------------------------------- | --------------------------------------------------------- |
| Local Python service (~4GB RAM) | DeepInfra API calls                                       |
| `localhost:8000/embed`          | `api.deepinfra.com/v1/openai/embeddings`                  |
| `localhost:8000/rerank`         | `api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B` |
| `localhost:8000/sentiment`      | ❌ Drop (LLM handles emotions)                             |

### Models (unchanged)

- **Embeddings**: `intfloat/multilingual-e5-large-instruct` (1024d)
- **Reranker**: `Qwen/Qwen3-Reranker-0.6B`

### Tasks

- [ ] Create `lib/services/deepinfra/DeepInfraService.ts`
  ```typescript
  // Core methods
  export async function embedText(text: string): Promise<number[]>
  export async function embedBatch(texts: string[]): Promise<number[][]>
  export async function rerank(query: string, documents: string[]): Promise<RerankResult[]>
  ```

- [ ] Update `EmbeddingService.ts` to call DeepInfra instead of Python
- [ ] Update `RerankerService.ts` to call DeepInfra instead of Python
- [ ] Remove `VectorizationService.ts` (calls to Python)
- [ ] Remove `/sentiment` calls from codebase
- [ ] Add `DEEPINFRA_API_KEY` to environment
- [ ] Delete `services/vectorization/` Python service folder
- [ ] Update `docker-compose.yml` to remove vectorization service

### Verification

- [ ] Embeddings return 1024-dimensional vectors
- [ ] Existing stored embeddings remain compatible (no reindexing)
- [ ] Reranking improves match quality
- [ ] No Python service running
- [ ] All tests pass without local models

---

## Phase 5: SSE Migration

> Replace WebSocket-based job subscriptions with Server-Sent Events.

### Tasks

- [ ] Create SSE endpoint `routes/api/jobs/$id/progress.tsx`
  ```typescript
  // routes/api/jobs/$id/progress.tsx
  import { createAPIFileRoute } from '@tanstack/start/api'

  export const Route = createAPIFileRoute('/api/jobs/$id/progress')({
    GET: async ({ request, params }) => {
      const session = await requireUserSession(request)
      const jobId = params.id

      // Verify user owns this job
      const job = await jobsRepository.getById(jobId)
      if (!job || job.account_id !== session.userId) {
        return new Response('Not Found', { status: 404 })
      }

      // Create SSE stream
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          const unsubscribe = jobEventEmitter.subscribe(jobId, (progress) => {
            const data = `data: ${JSON.stringify(progress)}\n\n`
            controller.enqueue(encoder.encode(data))

            if (progress.status === 'completed' || progress.status === 'failed') {
              controller.close()
            }
          })

          request.signal.addEventListener('abort', () => {
            unsubscribe()
            controller.close()
          })
        }
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        }
      })
    }
  })
  ```

- [ ] Create SSE client hook `hooks/useJobProgress.ts`
  ```typescript
  export function useJobProgress(jobId: string) {
    const queryClient = useQueryClient()

    useEffect(() => {
      const eventSource = new EventSource(`/api/jobs/${jobId}/progress`)

      eventSource.onmessage = (event) => {
        const progress = JSON.parse(event.data)
        queryClient.setQueryData(['job', jobId], progress)
      }

      return () => eventSource.close()
    }, [jobId, queryClient])
  }
  ```

- [ ] Migrate job services to emit SSE events:
  - [ ] Update `SyncOrchestrator` (renamed from `SyncService`)
  - [ ] Update analysis pipeline
  - [ ] Update matching service

- [ ] Delete old job subscription system:
  - [ ] `JobSubscriptionManager.ts`
  - [ ] `JobPersistenceService.ts` (replaced by `data/jobs.ts`)

### Verification

- [ ] Job progress shows in UI via SSE
- [ ] No WebSocket connections in network tab

---

## Phase 6: Cleanup & Smoke Tests

> Delete remaining thin wrappers and verify critical paths.

### Tasks

#### Cleanup

- [ ] Delete `TrackService.ts` (→ `data/songs.ts`)
- [ ] Delete `UserService.ts` (→ `data/accounts.ts`)
- [ ] Delete `vectorization/VectorCache.ts` (in-memory → DB)
- [ ] Delete `llm/ProviderKeyService.ts` (table dropped)
- [ ] Rename `SyncService.ts` → `SyncOrchestrator.ts`
- [ ] Delete old repository files once confirmed unused
- [ ] Update `services/index.ts` exports

#### Smoke Tests

Test these critical paths manually or with integration tests:

- [ ] **Auth flow**: Login → account created → redirect
- [ ] **Song sync**: Trigger sync → job created → songs appear
- [ ] **Playlist sync**: Trigger sync → playlists appear → mark destination
- [ ] **Analysis**: Run analysis → progress updates → analysis saved
- [ ] **Matching**: Run matching → results appear → can review
- [ ] **Newness**: New songs show badge → viewing clears badge

### Verification

```bash
bun run typecheck  # Clean
bun run lint       # Clean
bun run build      # Builds successfully
```

---

## Phase 7: UI Integration

> UI development begins with TanStack Start. All data layer and SSE must be stable.

### Prerequisites

- [ ] Phase 5 (SSE) complete
- [ ] Phase 6 (Cleanup) complete
- [ ] Generated types available

### Initial UI Tasks

- [ ] Set up TanStack Start project structure
  ```
  routes/
  ├── __root.tsx           # Root layout with providers
  ├── index.tsx            # Landing page
  ├── login.tsx            # OAuth flow
  ├── onboarding.tsx       # Onboarding wizard
  ├── _app.tsx             # Authenticated layout (pathless)
  └── _app/
      ├── index.tsx        # Home dashboard
      ├── sort.tsx         # Matching page
      └── library/
          ├── songs.tsx    # Songs list
          └── playlists.tsx
  ```

- [ ] Configure TanStack Query in root layout
  ```typescript
  // routes/__root.tsx
  import { createRootRoute, Outlet } from '@tanstack/react-router'
  import { QueryClientProvider } from '@tanstack/react-query'

  export const Route = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  })
  ```

- [ ] Set up Zustand stores for UI state
- [ ] Create server functions (`lib/server/*.ts`)
- [ ] Create query hooks (`lib/queries/*.ts`)
- [ ] Implement SSE subscription hook
- [ ] Build first route using new data layer with `createFileRoute`

---

## Risk Mitigation

### Rollback Points

| Phase   | Rollback Strategy                                 |
| ------- | ------------------------------------------------- |
| Phase 1 | `supabase db reset` to clear all tables           |
| Phase 3 | Keep old repositories, query modules are additive |
| Phase 4 | Git revert, factories are just imports            |
| Phase 5 | Keep old job system until SSE proven              |

### Facade Pattern (Phase 3)

During migration, old services can delegate to new query modules:

```typescript
// Old: TrackService.ts (temporary facade)
class TrackService {
  async getTracks(userId: number) {
    // Delegate to new query module
    return getSongsByAccountId(userId.toString())
  }
}
```

This allows incremental migration without breaking existing code.

---

## Tracking Progress

Update this section as phases complete:

| Phase    | Status        | Started  | Completed |
| -------- | ------------- | -------- | --------- |
| Phase 0  | ✅ Complete    | Jan 2026 | Jan 2026  |
| Phase 1  | 🟡 Partial     | Jan 2026 | —         |
| Phase 2  | 🟡 Partial     | Jan 2026 | —         |
| Phase 3  | ✅ Complete    | Jan 2026 | Jan 2026  |
| Phase 4a | ⬜ Not started |          |           |
| Phase 4b | ⬜ Not started |          |           |
| Phase 4c | ⬜ Not started |          |           |
| Phase 4d | ⬜ Not started |          |           |
| Phase 5  | ⬜ Not started |          |           |
| Phase 6  | ⬜ Not started |          |           |
| Phase 7  | 🟡 In Progress | Jan 2026 | —         |

### Progress Notes

**Phase 1 (Schema)**: Core tables created - account, auth_token, song, playlist, liked_song, playlist_song, job, song_audio_feature, song_analysis, song_embedding, playlist_analysis, playlist_profile, job_failure, match_context, item_status, user_preferences, match_result. Added `is_destination` column to playlist table (migration `20260117030516`). Genres are stored on `song.genres`.

**Phase 2 (Extensions)**: TypeScript types generated (database.types.ts). pgvector enabled.

**Phase 3 (Query Modules)**: ✅ Complete — All 11 modules implemented with Result<T, DbError> pattern:
- ✅ `client.ts` — Service role client factory (deny-all RLS)
- ✅ `accounts.ts` — Account CRUD
- ✅ `auth-tokens.ts` — Token refresh support
- ✅ `songs.ts` — Song + liked song operations
- ✅ `playlists.ts` — Playlist + playlist-song + destination operations
- ✅ `jobs.ts` — Job lifecycle management
- ✅ `analysis.ts` — Song/playlist LLM analysis + audio features
- ✅ `vectors.ts` — Song embeddings + playlist profiles
- ✅ `matching.ts` — Match context + results + aggregations
- ✅ `newness.ts` — Item status tracking (new/seen/actioned)
- ✅ `preferences.ts` — User preferences + onboarding state

**Phase 7 (UI)**: Auth flows working (login, logout, callback routes). TanStack Start + Router configured.

---

*Last updated: January 17, 2026*
