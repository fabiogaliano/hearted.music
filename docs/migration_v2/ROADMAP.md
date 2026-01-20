# Migration v2 Roadmap

> Product board for tracking migration progress. Each phase has clear tasks, references, and acceptance criteria.

---

## Status Overview

| Phase | Name                   | Status                | Blocked By |
| ----- | ---------------------- | --------------------- | ---------- |
| 0     | Foundation             | ✅ Complete            | —          |
| 1     | Schema                 | ✅ Complete            | Phase 0    |
| 2     | Extensions             | ✅ Complete            | Phase 1    |
| 3     | Query Modules          | ✅ Complete            | Phase 2    |
| 4a    | Delete Factories       | ✅ N/A (v1 fresh port) | Phase 3    |
| 4b    | Song/Analysis Services | ✅ Complete            | Phase 3    |
| 4c    | Playlist/Sync Services | ✅ Complete            | Phase 3    |
| 4d    | DeepInfra Migration    | ✅ Complete            | Phase 3    |
| 4e    | **Matching Pipeline**  | ⬜ Not Started         | Phase 4d   |
| 4f    | **Genre Enrichment**   | ⬜ Not Started         | Phase 4d   |
| 4g    | **Playlist Profiling** | ⬜ Not Started         | Phase 4e   |
| 5     | SSE                    | ⬜ Not Started         | Phase 4g   |
| 6     | Cleanup                | ⬜ Not Started         | Phase 5    |
| 7     | UI Integration         | 🟡 Prototypes Ready    | Phase 5    |

> **Frontend Note**: UI prototypes are ~85% complete in `old_app/prototypes/warm-pastel/` (88 files). Phase 7 involves wiring these to real APIs/data, not building from scratch.

---

## Phase 0: Foundation

> Set up infrastructure for v2 development.

### Tasks

- [x] **Create Supabase Cloud project**
  - Go to [supabase.com](https://supabase.com) → New Project
  - Name: `spotify-v2` (or similar)
  - Region: Choose closest
  - Save URL + keys

- [x] **Configure environment**
  - Add to `.env.local`:
    ```
    SUPABASE_URL=https://xxx.supabase.co
    SUPABASE_ANON_KEY=xxx
    SUPABASE_SERVICE_ROLE_KEY=xxx
    ```
  - Ref: [Decision #052](/docs/migration_v2/00-DECISIONS.md)

- [ ] **Set up DB keep-alive**
  - Create cron job to ping Supabase every 5 days
  - Prevents free tier pause
  - Options: GitHub Action, cron-job.org, or Cloudflare Worker

- [x] **Verify local Supabase**
  ```bash
  supabase status  # Should show running
  supabase db reset  # Fresh start
  ```

### Acceptance Criteria
- [x] Can connect to Supabase Cloud from app
- [x] Local Supabase running with empty DB
- [ ] Keep-alive scheduled

### References
- [00-DECISIONS.md #052](/docs/migration_v2/00-DECISIONS.md) — Supabase Cloud Free

---

## Phase 1: Schema

> Create all 17 tables with RLS enabled (deny-all; service-role access only).

### Tasks

#### Tier 1: No Dependencies
- [x] `001_create_account.sql` — [Decision #001, #039](/docs/migration_v2/00-DECISIONS.md)
- [x] `002_create_song.sql` — [Decision #002, #040, #041, #042](/docs/migration_v2/00-DECISIONS.md)

#### Tier 2: Depends on Tier 1
- [x] `003_create_song_audio_feature.sql`
- [x] `004_create_song_analysis.sql`
- [x] `005_create_song_embedding.sql`
- [x] `007_create_liked_song.sql` — [Decision #005, #043](/docs/migration_v2/00-DECISIONS.md)
- [x] `008_create_playlist.sql` — [Decision #006](/docs/migration_v2/00-DECISIONS.md)
- [x] `009_create_job.sql` — [Decision #008, #009](/docs/migration_v2/00-DECISIONS.md)

#### Tier 3: Depends on Tier 2
- [x] `010_create_playlist_song.sql` — [Decision #049](/docs/migration_v2/00-DECISIONS.md)
- [x] `011_create_playlist_analysis.sql`
- [x] `012_create_playlist_profile.sql`
- [x] `013_create_job_failure.sql`
- [x] `014_create_match_context.sql`
- [x] `015_create_item_status.sql` — [Decision #010](/docs/migration_v2/00-DECISIONS.md)
- [x] `016_create_user_preferences.sql` — [Decision #044, #045, #046](/docs/migration_v2/00-DECISIONS.md)

#### Tier 4: Final
- [x] `017_create_match_result.sql`

### Acceptance Criteria
- [x] All 17 tables created
- [x] RLS enabled with deny-all policies
- [x] Foreign keys valid
- [x] `supabase db reset` runs clean

### References
- [01-SCHEMA.md](/docs/migration_v2/01-SCHEMA.md) — Full schema definitions
- [03-IMPLEMENTATION.md Phase 1](/docs/migration_v2/03-IMPLEMENTATION.md) — SQL for each migration

---

## Phase 2: Extensions & Types

> Enable pgvector and generate TypeScript types.

### Tasks

- [x] **Enable pgvector extension**
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```

- [x] **Generate TypeScript types**
  ```bash
  supabase gen types typescript --local > lib/database.types.ts
  ```

- [ ] **Create Zod/Valibot schemas** *(deferred — add when needed)*
  - Location: `lib/schemas/`
  - One file per domain: `song.schema.ts`, `playlist.schema.ts`, etc.
  - Ref: [Decision #036, #037](/docs/migration_v2/00-DECISIONS.md)

### Acceptance Criteria
- [x] pgvector queries work (test with dummy vector)
- [x] TypeScript types compile
- [ ] Schemas validate sample data *(deferred)*

### References
- [01-SCHEMA.md](/docs/migration_v2/01-SCHEMA.md) — Type definitions
- [Decision #021](/docs/migration_v2/00-DECISIONS.md) — Valibot for validation

---

## Phase 3: Query Modules

> Create data access modules replacing repositories.

### Tasks

- [x] `data/client.ts` — Supabase client setup
- [x] `data/song.ts` — Songs
- [x] `data/liked-song.ts` — Liked songs + item status
- [x] `data/playlists.ts`
- [x] `data/song-analysis.ts` — Song LLM analysis
- [x] `data/playlist-analysis.ts` — Playlist LLM analysis
- [x] `data/song-audio-feature.ts` — Audio feature storage
- [x] `data/vectors.ts` — Song embeddings + playlist profiles
- [x] `data/matching.ts` — Match context + results + aggregations
- [x] `data/jobs.ts`
- [x] `data/accounts.ts`
- [x] `data/newness.ts` — Item status tracking (new/seen/actioned)
- [x] `data/preferences.ts` — User preferences + onboarding state
- [x] `data/auth-tokens.ts` — (additional) Token refresh support

### Acceptance Criteria
- [x] Each module compiles
- [x] Each module has working CRUD functions
- [ ] Old repositories can delegate to new modules (facade pattern)

### References
- [02-SERVICES.md Query Modules](/docs/migration_v2/02-SERVICES.md) — Function signatures
- [Decision #030, #031, #032](/docs/migration_v2/00-DECISIONS.md) — Query module pattern

---

## Phase 4a: Delete Factories

> Remove factory pattern files.

**Status**: ✅ N/A — v1 is a fresh port with no factories to delete. Using direct imports from the start.

### Tasks

- [x] Delete `matching/factory.ts` — N/A (fresh v1 port)
- [x] Delete `reranker/factory.ts` — N/A (fresh v1 port)
- [x] Delete `embedding/factory.ts` — N/A (fresh v1 port)
- [x] Delete `genre/factory.ts` — N/A (fresh v1 port)
- [x] Delete `profiling/factory.ts` — N/A (fresh v1 port)
- [x] Delete `llm/LlmProviderManagerFactory.ts` — N/A (fresh v1 port)
- [x] Update imports to use direct imports — using direct imports from start

### Acceptance Criteria
- [x] No factory files remain
- [x] All imports updated
- [x] `bun run typecheck` passes

### References
- [Decision #034](/docs/migration_v2/00-DECISIONS.md) — No factories

---

## Phase 4b: Song/Analysis Services

> Consolidate song and analysis pipeline.

**Status**: ✅ Complete

### Tasks

- [x] Merge analysis pipeline → `analysis/pipeline.ts`
  - Location: `src/lib/services/analysis/pipeline.ts`
  - Orchestrates batch analysis with concurrency control and job tracking
  - Uses `data/jobs.ts` for job lifecycle management
- [x] Delete `TrackService.ts` → use `data/song.ts` + `data/liked-song.ts`
  - N/A for v1 fresh port; using split query modules from start
- [x] Create `SongAnalysisService` using query modules
  - Location: `src/lib/services/analysis/song-analysis.ts`
  - Uses AI SDK via `LlmService` with Zod schemas for structured output
- [x] Create `PlaylistAnalysisService` using query modules
  - Location: `src/lib/services/analysis/playlist-analysis.ts`
  - Same pattern as SongAnalysisService
- [x] Wire job progress updates via `data/jobs.ts`
  - Pipeline creates jobs, updates progress, marks completion/failure

### Acceptance Criteria
- [x] Song sync works (via `data/song.ts` + `data/liked-song.ts`)
- [x] Analysis pipeline works
- [x] No duplicate code

### References
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md) — Service consolidation
- [Decision #033](/docs/migration_v2/00-DECISIONS.md) — Merge analysis pipeline

---

## Phase 4c: Playlist/Sync Services

> Split and consolidate playlist services.

**Status**: ✅ Complete

### Tasks

- [x] Create `PlaylistSyncService.ts` (Spotify API operations)
  - Location: `src/lib/services/sync/playlist-sync.ts`
  - Implements: `syncPlaylists`, `syncPlaylistTracks`, `createPlaylist`, `updatePlaylist`
- [x] Update `PlaylistService.ts` → use `data/playlists.ts` for DB
  - DB operations now in `data/playlists.ts` (Phase 3)
- [x] Rename `SyncService.ts` → `SyncOrchestrator.ts`
  - Location: `src/lib/services/sync/orchestrator.ts`
  - Implements: `syncLikedSongs`, `syncPlaylists`, `fullSync`
- [x] Delete `UserService.ts` → use `data/accounts.ts`
  - Replaced by `data/accounts.ts` (Phase 3)

### Acceptance Criteria
- [x] Playlist sync works
- [x] No duplicate DB code

### References
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md) — PlaylistSyncService spec

---

## Phase 4d: DeepInfra Migration

> Replace Python vectorization with DeepInfra API.

**Status**: ✅ Complete

### Tasks

- [x] **Create DeepInfraService**
  - Location: `src/lib/services/deepinfra/service.ts`
  - Endpoints:
    - Embeddings: `https://api.deepinfra.com/v1/openai/embeddings`
    - Reranker: `https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B`
  - Model: `intfloat/multilingual-e5-large-instruct` (1024 dims)
  - Uses E5 prefixes: `query:` for search, `passage:` for documents

- [x] **Add environment variable**
  ```
  DEEPINFRA_API_KEY=xxx
  ```

- [x] **Update EmbeddingService** → call DeepInfra
  - Location: `src/lib/services/embedding/service.ts`
  - Implements: `embedSong`, `embedBatch`, `getEmbedding`, `getEmbeddings`
  - Content-hash caching to avoid re-embedding
- [x] **Update RerankerService** → call DeepInfra
  - Location: `src/lib/services/reranker/service.ts`
  - Implements: `rerank` with score blending (70% original + 30% reranker)
  - Two-stage pipeline: embedding similarity → cross-encoder reranking
- [x] **Remove sentiment calls** (LLM handles emotions) — N/A for v1 fresh port
- [x] **Delete VectorizationService.ts** — N/A for v1 fresh port
- [x] **Delete `services/vectorization/` Python folder** — N/A for v1 fresh port
- [x] **Update docker-compose.yml** — N/A for v1 fresh port

### Acceptance Criteria
- [x] Embeddings return 1024-dim vectors
- [x] Existing embeddings still compatible (no reindexing)
- [x] Reranking works
- [x] No Python service running

### References
- [02-SERVICES.md DeepInfraService](/docs/migration_v2/02-SERVICES.md) — Service spec
- [Decision #053, #054, #055, #056](/docs/migration_v2/00-DECISIONS.md) — DeepInfra decisions

---

## Phase 4e: Matching Pipeline 🆕

> Port the core song-to-playlist matching algorithm. This is the primary business logic that makes the app work.

**Status**: ⬜ Not Started

### Source Files (old_app)

| File                                   | Lines | Purpose                                                     |
| -------------------------------------- | ----- | ----------------------------------------------------------- |
| `matching/MatchingService.ts`          | 1493  | Core matching algorithm (vector + semantic + audio + genre) |
| `matching/MatchCachingService.ts`      | 534   | Cache-first orchestration (Phase 8)                         |
| `matching/matching-config.ts`          | 85    | Algorithm weights & thresholds                              |
| `semantic/SemanticMatcher.ts`          | 306   | Theme/mood similarity matching                              |
| `vectorization/analysis-extractors.ts` | 354   | Extract text from analysis for embedding                    |
| `vectorization/hashing.ts`             | 327   | Content hashing for cache invalidation                      |
| `vectorization/model-bundle.ts`        | 210   | Embedding model metadata                                    |

### Tasks

- [ ] **Port `matching-config.ts`** → `services/matching/config.ts`
  - Algorithm weights (semantic, vector, audio, genre)
  - Score thresholds and normalization
  - Configurable tuning without touching algorithm

- [ ] **Port `analysis-extractors.ts`** → `services/embedding/extractors.ts`
  - `extractSongText(analysis)` → text for embedding
  - `extractPlaylistText(analysis)` → text for embedding
  - Handle missing fields gracefully

- [ ] **Port `hashing.ts`** → `services/embedding/hashing.ts`
  - `hashContent(text)` → content hash for cache invalidation
  - `hashModelBundle(model, version)` → model version hash
  - Deterministic hashing for reproducibility

- [ ] **Port `SemanticMatcher.ts`** → `services/matching/semantic.ts`
  - Theme similarity (keyword overlap + embeddings)
  - Mood compatibility scoring
  - Caching layer for repeated comparisons

- [ ] **Port `MatchingService.ts`** → `services/matching/service.ts`
  - Multi-factor scoring: vector (cosine), semantic, audio features, genre
  - Score normalization and weighting from config
  - Batch matching for efficiency
  - Use `data/matching.ts` for persistence

- [ ] **Port `MatchCachingService.ts`** → `services/matching/cache.ts`
  - Cache-first orchestration pattern
  - Context hashing (playlist set + candidate set + config)
  - Invalidation on new songs/playlists/config changes

- [ ] **Create integration tests**
  - Test matching accuracy with known song-playlist pairs
  - Test cache hit/miss behavior
  - Test score reproducibility

### Acceptance Criteria
- [ ] Can match a song to playlists and get ranked results
- [ ] Scores are deterministic (same input = same output)
- [ ] Cache invalidates correctly on changes
- [ ] Matching completes in <5s for typical library (500 songs, 20 playlists)

### Architecture Notes

```
Song Analysis → Extract Text → Embed → Match
                    ↓
            Content Hash → Cache Check
                    ↓
         Vector Similarity (cosine distance)
         Semantic Similarity (theme/mood)
         Audio Feature Compatibility
         Genre Alignment
                    ↓
            Weighted Score → Rank → Results
```

### References
- [matching-ui spec](/openspec/specs/matching-ui/spec.md) — UI for match results
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md) — Original service list (marked KEEP)

---

## Phase 4f: Genre Enrichment 🆕

> Port Last.fm genre fetching and normalization for improved matching.

**Status**: ⬜ Not Started

### Source Files (old_app)

| File                              | Lines | Purpose                               |
| --------------------------------- | ----- | ------------------------------------- |
| `lastfm/LastFmService.ts`         | 311   | Last.fm API client                    |
| `lastfm/utils/genre-whitelist.ts` | 469   | 469-genre normalized taxonomy         |
| `lastfm/utils/normalize.ts`       | 81    | Genre string normalization            |
| `genre/GenreEnrichmentService.ts` | 477   | Orchestrates genre fetching + caching |

### Tasks

- [ ] **Port `LastFmService.ts`** → `services/lastfm/service.ts`
  - `getArtistTopTags(artist)` → genre tags
  - Rate limiting (Last.fm allows 5 req/sec)
  - Error handling for missing artists

- [ ] **Port genre whitelist** → `services/lastfm/whitelist.ts`
  - 469-genre canonical taxonomy
  - Mapping from raw tags to canonical genres
  - Export as `GENRE_WHITELIST: Set<string>`

- [ ] **Port normalize utils** → `services/lastfm/normalize.ts`
  - `normalizeGenre(raw)` → canonical genre or null
  - Lowercase, trim, handle variations

- [ ] **Port `GenreEnrichmentService.ts`** → `services/genre/service.ts`
  - `enrichSong(song)` → fetch genres if missing
  - `enrichBatch(songs)` → batch with rate limiting
  - **Top 3 only, ordered**: index 0 = primary, index 1 = secondary, index 2 = tertiary
  - Store ordered genres on `song.genres` column (TEXT[], max 3)
  - Use `data/song.ts` for persistence

- [ ] **Add environment variable**
  ```
  LASTFM_API_KEY=xxx
  ```

### Acceptance Criteria
- [ ] Can fetch genres for artist from Last.fm
- [ ] Returns max 3 genres, ordered by relevance (primary → secondary → tertiary)
- [ ] Genres normalized to canonical 469-genre taxonomy
- [ ] Genres persisted on `song.genres` as ordered TEXT[]
- [ ] Rate limiting prevents API abuse (5 req/sec)

### References
- [song.genres column](/docs/migration_v2/01-SCHEMA.md) — Schema for genres array

---

## Phase 4g: Playlist Profiling 🆕

> Port playlist profile computation for matching destination playlists.

**Status**: ⬜ Not Started

### Source Files (old_app)

| File                                    | Lines | Purpose                              |
| --------------------------------------- | ----- | ------------------------------------ |
| `profiling/PlaylistProfilingService.ts` | 770   | Compute playlist vectors from tracks |
| `audio/AudioFeaturesService.ts`         | 45    | Audio feature utilities              |
| `reccobeats/ReccoBeatsService.ts`       | 226   | ReccoBeats API for audio features    |

### Tasks

- [ ] **Port `ReccoBeatsService.ts`** → `services/reccobeats/service.ts`
  - `getAudioFeatures(isrc)` → audio features
  - Rate limiting
  - Graceful degradation if ReccoBeats unavailable (skip backfill)
  - Add `RECCOBEATS_API_URL` env var if needed

- [ ] **Port `AudioFeaturesService.ts`** → `services/audio/service.ts`
  - `normalizeFeatures(raw)` → 0-1 normalized values
  - Centroid computation for playlist aggregation

- [ ] **Backfill missing audio features** before profiling
  - Fetch features for songs missing `song_audio_feature`
  - Persist via `data/song-audio-feature.ts`
  - Prefer existing rows; only fetch missing data

- [ ] **Port `PlaylistProfilingService.ts`** → `services/profiling/service.ts`
  - `computeProfile(playlist)` → aggregate profile from songs
  - Embedding centroid (average of song embeddings)
  - Audio feature centroid (average of song features)
  - Genre distribution (weighted by frequency)
  - Emotion distribution (from song analyses)
  - Use `data/vectors.ts` for persistence (`playlist_profile` table)
  - Ensure audio features are backfilled before centroid computation

- [ ] **Create integration tests**
  - Profile changes when playlist songs change
  - Profile is deterministic
  - Handle empty playlists gracefully

### Acceptance Criteria
- [ ] Can compute profile for destination playlist
- [ ] Profile includes: embedding centroid, audio centroid, genre distribution, emotion distribution
- [ ] Missing audio features are backfilled into `song_audio_feature`
- [ ] Profile persisted to `playlist_profile` table
- [ ] Profile invalidates when playlist contents change

### Architecture Notes

```
Destination Playlist
        ↓
    Get Songs → Get Embeddings → Compute Centroid
        ↓
    Get Audio Features → Compute Audio Centroid
        ↓
    Get Genres → Compute Distribution
        ↓
    Get Emotions (from analysis) → Compute Distribution
        ↓
    Store as playlist_profile
```

### References
- [playlist_profile schema](/docs/migration_v2/01-SCHEMA.md) — Table definition
- [02-SERVICES.md](/docs/migration_v2/02-SERVICES.md) — Original service list

---

## Phase 5: SSE Migration

> Replace WebSocket job subscriptions with Server-Sent Events.

### Tasks

- [ ] Create SSE endpoint: `routes/api.jobs.$id.progress.tsx`
  ```typescript
  import { createAPIFileRoute } from "@tanstack/start/api"

  export const Route = createAPIFileRoute("/api/jobs/$id/progress")({
    GET: async ({ request, params }) => {
      // SSE stream implementation
    }
  })
  ```
- [ ] Update job creation to emit SSE events
  - Emit job-level progress and status events
  - Emit per-item status events with current item metadata
- [ ] Delete `JobSubscriptionManager.ts`
- [ ] Delete `JobPersistenceService.ts` → use `data/jobs.ts`
- [ ] Update UI to use EventSource and track current item

### Acceptance Criteria
- [ ] Job progress streams via SSE
- [ ] Item-level events surface current item + status in UI
- [ ] No WebSocket code remains
- [ ] Works in Cloudflare Workers (no WS support)

### References
- [02-SERVICES.md SSE API Route](/docs/migration_v2/02-SERVICES.md)
- [Decision #035](/docs/migration_v2/00-DECISIONS.md) — SSE over WebSocket

---

## Phase 6: Cleanup & Smoke Tests

> Final cleanup and validation.

### Tasks

#### Cleanup
- [ ] Delete `vectorization/VectorCache.ts`
- [ ] Delete `llm/ProviderKeyService.ts`
- [ ] Delete old repository files
- [ ] Update `services/index.ts` exports
- [ ] Remove unused dependencies from `package.json`

#### Smoke Tests
- [ ] **Auth flow**: Login → account created → redirect
- [ ] **Song sync**: Trigger → job created → songs appear
- [ ] **Playlist sync**: Trigger → playlists appear → mark destination
- [ ] **Analysis**: Run → progress updates → saved
- [ ] **Matching**: Run → results appear → can review
- [ ] **Newness**: New songs badge → viewing clears

### Acceptance Criteria
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] `bun run build` succeeds
- [ ] All smoke tests pass

---

## Phase 7: UI Integration

> Wire warm-pastel prototypes to real APIs and data.

**Status**: 🟡 Prototypes Ready

### Source

UI prototypes are ~85% complete in `old_app/prototypes/warm-pastel/`:
- 88 files across 6 features
- Landing, Onboarding (6 steps), Dashboard, Matching, Liked Songs, Playlists, Settings
- Full design system with 4 themes (blue, green, rose, lavender)
- FLIP animations, infinite scroll, keyboard shortcuts

### Tasks

- [ ] Set up TanStack Start routes using prototype structure
- [ ] Create API routes/server functions for data fetching
- [ ] Wire components to real Supabase data via query modules
- [ ] Integrate SSE for job progress (after Phase 5)
- [ ] Test all user flows end-to-end

### Acceptance Criteria
- [ ] All prototype pages render with real data
- [ ] User can complete full workflow: sync → analyze → match → sort

---

## Deployment

> After all phases complete.

### Tasks

- [ ] **Cloudflare Workers setup**
  - Follow: [RR7 Cloudflare Guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
  - `bunx wrangler init`
  - Configure `wrangler.toml`

- [ ] **Environment variables in Cloudflare**
  ```
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  DEEPINFRA_API_KEY
  SPOTIFY_CLIENT_ID
  SPOTIFY_CLIENT_SECRET
  ```

- [ ] **Deploy**
  ```bash
  bun run build
  wrangler deploy
  ```

- [ ] **Custom domain** (optional)

### References
- [Decision #051](/docs/migration_v2/00-DECISIONS.md) — Cloudflare Workers

---

## Quick Links

| Doc                                            | Purpose                        |
| ---------------------------------------------- | ------------------------------ |
| [00-DECISIONS.md](./00-DECISIONS.md)           | All 56 architectural decisions |
| [01-SCHEMA.md](./01-SCHEMA.md)                 | Database schema definitions    |
| [02-SERVICES.md](./02-SERVICES.md)             | Service layer consolidation    |
| [03-IMPLEMENTATION.md](./03-IMPLEMENTATION.md) | Detailed SQL + code            |
| [GAP-ANALYSIS.md](./GAP-ANALYSIS.md)           | Matching pipeline gap analysis |

---

*Last updated: January 20, 2026 — Phases 4e-4g added, UI simplified (prototypes exist)*
