# Migration v2: Service Layer

> 75 files → ~35 files via consolidation, factory deletion, and query module extraction.

---

## Overview

| Category           | Current   | v2  | Strategy                                  |
| ------------------ | --------- | --- | ----------------------------------------- |
| Factories          | 6 files   | 0   | DELETE all (#034)                         |
| Job services       | 2 files   | 0   | DELETE → query module + SSE (#035)        |
| TrackService       | 1 file    | 0   | DELETE → query module (#032)              |
| UserService        | 1 file    | 0   | DELETE → query module                     |
| VectorCache        | 1 file    | 0   | DELETE (DB-backed)                        |
| ProviderKeyService | 1 file    | 0   | DELETE (#016)                             |
| Analysis pipeline  | 4 files   | 1   | MERGE → `pipeline.ts` (#033)              |
| PlaylistService    | 1 file    | 2   | SPLIT (DB → query, sync → service) (#032) |
| Query modules      | 0 files   | 13  | NEW (domain-organized) (#030)             |
| SyncService        | 1 file    | 1   | RENAME → `SyncOrchestrator`               |
| Core services      | ~30 files | ~25 | KEEP (minor simplification)               |

---

## Files to DELETE (12 files)

### Factory Files (6) — #034

| File                               | Reason                                   |
| ---------------------------------- | ---------------------------------------- |
| `matching/factory.ts`              | Direct imports; RR7 provides composition |
| `reranker/factory.ts`              | Direct imports                           |
| `embedding/factory.ts`             | Direct imports                           |
| `genre/factory.ts`                 | Direct imports                           |
| `profiling/factory.ts`             | Direct imports                           |
| `llm/LlmProviderManagerFactory.ts` | Direct imports                           |

### Job System (2) — #035

| File                        | Replacement            |
| --------------------------- | ---------------------- |
| `JobPersistenceService.ts`  | → `data/jobs.ts` + SSE |
| `JobSubscriptionManager.ts` | → SSE endpoint         |

### Thin Wrappers (4)

| File                           | Replacement                             | Reason                 |
| ------------------------------ | --------------------------------------- | ---------------------- |
| `TrackService.ts`              | → `data/song.ts` + `data/liked-song.ts` | Thin DB wrapper (#032) |
| `UserService.ts`               | → `data/accounts.ts`                    | Thin DB wrapper        |
| `vectorization/VectorCache.ts` | —                                       | In-memory → DB-backed  |
| `llm/ProviderKeyService.ts`    | —                                       | Table dropped (#016)   |

### Python Service (entire folder) — #056

| File/Folder                                    | Replacement             | Reason                                              |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------- |
| `old_app/lib/services/vectorization/` (Python) | → `DeepInfraService.ts` | DeepInfra hosts same models; no self-hosting needed |
| `VectorizationService.ts` (TS client)          | → `DeepInfraService.ts` | Single service for embeddings + reranking           |

---

## Files to MERGE (4 → 1)

### Analysis Pipeline — #033

**Current (4 files):**
- `analysis/TrackPrefetchService.ts` — prefetch tracks for batch
- `analysis/PlaylistBatchProcessor.ts` — batch orchestration
- `analysis/ProgressNotifier.ts` — progress callbacks
- `analysis/types.ts` — shared types

**v2 (1 file):**
- `analysis/pipeline.ts` — unified batch orchestration

**Kept separate (cross-cutting):**
- `analysis/RetryPolicy.ts` — reusable retry logic
- `analysis/RateLimitGate.ts` — rate limiting

---

## Files to SPLIT (1 → 2)

### PlaylistService — #032

**Current:** `PlaylistService.ts` (607 lines, mixed concerns)

| Concern                                     | v2 Location                                    |
| ------------------------------------------- | ---------------------------------------------- |
| `getPlaylists`, `getFlaggedPlaylists`, etc. | → `data/playlists.ts`                          |
| `getPlaylistTracks`                         | → `data/playlists.ts`                          |
| `sync status + last sync tracking`          | → `jobs.ts` (job table)                        |
| `syncPlaylistTracks`                        | → `PlaylistSyncService.ts`                     |
| `processSpotifyPlaylists`                   | → `PlaylistSyncService.ts`                     |
| `createAIPlaylist`, `updatePlaylistInfo`    | → `PlaylistSyncService.ts` (Spotify API calls) |

---

## Query Modules (data layer)

> Location: `data/`
> All query modules return `Result<T, DbError>` (no throwing).
> Supporting module: `client.ts` (Supabase public/admin clients)

### 1. `song.ts`

From: `TrackService`, `trackRepository`

```ts
export function getById(id: string)
export function getBySpotifyId(spotifyId: string)
export function getBySpotifyIds(spotifyIds: string[])
export function getByIds(ids: string[])
export function upsert(data: UpsertData[])
```

### 2. `liked-song.ts`

From: `TrackService`, `trackRepository`

```ts
export function getAll(accountId: string)
export function getPending(accountId: string)
export function upsert(accountId: string, data: UpsertData[])
export function softDelete(accountId: string, songId: string)
export function updateStatus(accountId: string, songId: string, actionType: ActionType)
```

### 3. `playlists.ts`

From: `PlaylistService` (DB ops), `playlistRepository`

```ts
export function getPlaylists(accountId: string)
export function getPlaylistById(id: string)
export function getPlaylistBySpotifyId(accountId: string, spotifyId: string)
export function getDestinationPlaylists(accountId: string)
export function upsertPlaylists(accountId: string, playlists: UpsertPlaylistData[])
export function deletePlaylist(id: string)
export function setPlaylistDestination(id: string, isDestination: boolean)

export function getPlaylistSongs(playlistId: string)
export function upsertPlaylistSongs(playlistId: string, songs: UpsertPlaylistSongData[])
export function removePlaylistSongs(playlistId: string, songIds: string[])
```

### 4. `song-analysis.ts`

From: `trackAnalysisRepository`

```ts
export function get(songId: string | string[])
export function insert(data: InsertData)
```

### 5. `playlist-analysis.ts`

From: `playlistAnalysisRepository`

```ts
export function get(playlistId: string)
export function insert(data: InsertData)
```

### 6. `song-audio-feature.ts`

From: `trackAnalysisRepository`

```ts
export function get(songId: string)
export function getBatch(songIds: string[])
export function upsert(features: UpsertData[])
```

### 7. `vectors.ts`

From: `EmbeddingService` (DB ops), `embeddingRepository`

```ts
export function getSongEmbedding(songId: string, model: string, kind: SongEmbedding["kind"])
export function getSongEmbeddings(songId: string)
export function getSongEmbeddingsBatch(songIds: string[], model: string, kind: SongEmbedding["kind"])
export function upsertSongEmbedding(data: UpsertSongEmbedding)
export function upsertSongEmbeddings(embeddings: UpsertSongEmbedding[])

export function getPlaylistProfile(playlistId: string)
export function getPlaylistProfilesBatch(playlistIds: string[])
export function upsertPlaylistProfile(data: UpsertPlaylistProfile)
```

### 8. `matching.ts`

From: `matchContextRepository`, `matchResultRepository`

```ts
export function getMatchContext(contextId: string)
export function getLatestMatchContext(accountId: string)
export function getMatchContexts(accountId: string)
export function createMatchContext(data: InsertMatchContext)

export function getMatchResults(contextId: string)
export function getMatchResultsForSong(contextId: string, songId: string)
export function getMatchResultsForSongs(contextId: string, songIds: string[])
export function insertMatchResults(results: InsertMatchResult[])
export function getTopMatchesPerPlaylist(contextId: string, limit: number)
export function getBestMatchPerSong(contextId: string)
```

### 9. `jobs.ts`

From: `JobPersistenceService`, `analysisJobRepository`

```ts
export function getJobById(id: string)
export function getActiveJob(accountId: string, type: JobType)
export function getLatestJob(accountId: string, type: JobType)
export function getJobs(accountId: string, type?: JobType)
export function createJob(accountId: string, type: JobType)
export function updateJobProgress(id: string, progress: JobProgress)
export function markJobRunning(id: string)
export function markJobCompleted(id: string)
export function markJobFailed(id: string, error?: string)
```

### 10. `accounts.ts`

From: `UserService`, `userRepository`

```ts
export function getAccountById(id: string)
export function getAccountBySpotifyId(spotifyId: string)
export function upsertAccount(data: UpsertAccountData)
// Note: theme + onboarding live in preferences.ts (#044)
```

### 11. `newness.ts`

From: NEW (`item_status` table)

```ts
export function getNewCounts(accountId: string)
export function getNewItemIds(accountId: string, itemType: ItemType)
export function getItemStatuses(accountId: string, itemType?: ItemType)
export function markItemsNew(accountId: string, itemType: ItemType, itemIds: string[])
export function markSeen(accountId: string, itemType: ItemType, itemIds: string[])
export function markAllSeen(accountId: string, itemType: ItemType)
export function recordAction(accountId: string, itemId: string, itemType: ItemType, actionType: ActionType)
export function clearAction(accountId: string, itemId: string, itemType: ItemType)
```

### 12. `preferences.ts`

From: NEW (`user_preferences` table)

```ts
export function getPreferences(accountId: string)
export function getOrCreatePreferences(accountId: string)
export function updateTheme(accountId: string, theme: ThemeColor)
export function getOnboardingStep(accountId: string)
export function isOnboardingComplete(accountId: string)
export function updateOnboardingStep(accountId: string, step: OnboardingStep)
export function completeOnboarding(accountId: string)
export function resetOnboarding(accountId: string)
```

### 13. `auth-tokens.ts`

From: NEW (`auth_token` table)

```ts
export function getTokenByAccountId(accountId: string)
export function upsertToken(accountId: string, tokens: UpsertTokenData)
export function deleteToken(accountId: string)
export function isTokenExpired(token: AuthToken)
```

---

## Services to PORT (Phases 4e-4g)

> ⚠️ **Status Clarification (2026-01-20)**: These services exist in `old_app/lib/services/` but have NOT been ported to v1 yet. They are required for the core matching functionality.

### Core Matching Algorithm (Phase 4e) — ✅ COMPLETE (2026-01-21)

| Service                                | Lines | Purpose                        | Status | v1 Location |
| -------------------------------------- | ----- | ------------------------------ | ------ | ----------- |
| `matching/MatchingService.ts`          | 1493  | Core matching algorithm        | ✅      | `capabilities/matching/service.ts` (440 lines) |
| `matching/MatchCachingService.ts`      | 534   | Cache-first orchestration      | ✅      | `capabilities/matching/cache.ts` (507 lines) |
| `matching/matching-config.ts`          | 85    | Algorithm weights & thresholds | ✅      | `capabilities/matching/config.ts` (173 lines) |
| `semantic/SemanticMatcher.ts`          | 306   | Theme/mood similarity          | ✅      | `capabilities/matching/semantic.ts` (300 lines) |
| `vectorization/analysis-extractors.ts` | 354   | Text extraction for embeddings | ✅      | `ml/embedding/extractors.ts` (354+ lines) |
| `vectorization/hashing.ts`             | 327   | Content hashing for cache      | ✅      | `ml/embedding/hashing.ts` (327+ lines) |

**Implementation Notes**:
- More efficient than old_app (2,443 lines vs 3,139 lines) with additional SSE integration
- Enhanced with SSE progress events for UI tracking
- DB persistence via `data/matching.ts` (race-safe with unique constraints)
- Adaptive weights based on data availability
- Tiered scoring with deep analysis gate (0.1 threshold)
- Scoring functions in `capabilities/matching/scoring.ts` (301 lines)
- Type definitions in `capabilities/matching/types.ts` (222 lines)

### Genre Enrichment (Phase 4f) — ✅ COMPLETE (2026-01-21)

| Service                           | Lines | Purpose                  | Status | v1 Location |
| --------------------------------- | ----- | ------------------------ | ------ | ----------- |
| `lastfm/LastFmService.ts`         | 311   | Last.fm API              | ✅      | `integrations/lastfm/service.ts` (311+ lines) |
| `lastfm/utils/genre-whitelist.ts` | 469   | Genre taxonomy           | ✅      | `integrations/lastfm/whitelist.ts` (469+ lines) |
| `genre/GenreEnrichmentService.ts` | 477   | Genre fetching + caching | ✅      | `capabilities/genre/service.ts` (294 lines) |

**Implementation Notes**:
- Graceful degradation when `LASTFM_API_KEY` unavailable
- DB-first pattern (returns cached genres before API calls)
- Batch operations with progress callbacks
- Rate limiting via `ConcurrencyLimiter` (5 req/sec)
- Additional normalization utils in `integrations/lastfm/normalize.ts`
- Type definitions in `integrations/lastfm/types.ts`
- Error handling in `shared/errors/external/lastfm.ts`

### Playlist Profiling (Phase 4g) — ✅ COMPLETE (2026-01-21)

| Service                                 | Lines | Purpose                     | Status | v1 Location |
| --------------------------------------- | ----- | --------------------------- | ------ | ----------- |
| `profiling/PlaylistProfilingService.ts` | 770   | Playlist vector computation | ✅      | `capabilities/profiling/service.ts` (253 lines) |
| `reccobeats/ReccoBeatsService.ts`       | 226   | ReccoBeats API              | ✅      | `integrations/reccobeats/service.ts` (226+ lines) |
| `audio/AudioFeaturesService.ts`         | 45    | Audio feature utilities     | ✅      | `integrations/audio/service.ts` (45+ lines) |

**Implementation Notes**:
- Computes 4 distributions: embedding centroid, audio centroid, genre distribution, emotion distribution
- Content hash invalidation for automatic cache refresh
- Integrates with `GenreEnrichmentService` for genre data
- Audio feature backfill via ReccoBeats (no API key required)
- Calculation utilities in `capabilities/profiling/calculations.ts`
- Type definitions in `capabilities/profiling/types.ts`
- Error handling in `shared/errors/external/reccobeats.ts`

---

## Services ALREADY PORTED (Phases 4a-4d) — ✅

### Analysis (v1: `capabilities/analysis/`)

| Service                      | v1 Location                                  | Status |
| ---------------------------- | -------------------------------------------- | ------ |
| `SongAnalysisService.ts`     | `capabilities/analysis/song-analysis.ts`     | ✅      |
| `PlaylistAnalysisService.ts` | `capabilities/analysis/playlist-analysis.ts` | ✅      |
| Analysis pipeline (merged)   | `capabilities/analysis/pipeline.ts`          | ✅      |

### API + ML Clients (v1: `integrations/`, `ml/`, `capabilities/`)

| Service                   | v1 Location                       | Status |
| ------------------------- | --------------------------------- | ------ |
| `SpotifyService.ts`       | `integrations/spotify/service.ts` | ✅      |
| `lyrics/LyricsService.ts` | `capabilities/lyrics/service.ts`  | ✅      |
| `RerankerService.ts`      | `ml/reranker/service.ts`          | ✅      |

### New Services (v1 only)

| Service             | v1 Location                          | Purpose                    | Status |
| ------------------- | ------------------------------------ | -------------------------- | ------ |
| DeepInfraService    | `integrations/deepinfra/service.ts`  | Embeddings + reranking API | ✅      |
| EmbeddingService    | `ml/embedding/service.ts`            | Song embedding with cache  | ✅      |
| LlmService          | `ml/llm/service.ts`                  | AI SDK multi-provider      | ✅      |
| SyncOrchestrator    | `capabilities/sync/orchestrator.ts`  | Full sync coordination     | ✅      |
| PlaylistSyncService | `capabilities/sync/playlist-sync.ts` | Playlist Spotify sync      | ✅      |
| JobLifecycleService | `jobs/lifecycle.ts`                  | Job state transitions      | ✅      |

### ML Provider Abstraction (2026-01-21) — ✅ COMPLETE

**Purpose**: Abstract ML operations (embeddings, reranking) behind provider-agnostic interface for multi-backend support.

**Providers**:
- **DeepInfra** (production): E5-large-instruct (1024d), Qwen reranker - requires `DEEPINFRA_API_KEY`
- **HuggingFace** (dev/fallback): all-MiniLM-L6-v2 (384d), no reranking - free tier, optional `HF_TOKEN`
- **Local** (dev-only): Xenova models via @huggingface/transformers - gated by `ML_PROVIDER=local`

**Selection Logic** (via `ML_PROVIDER` env):
1. Explicit `ML_PROVIDER` override (deepinfra, huggingface, local)
2. DeepInfra if `DEEPINFRA_API_KEY` exists (production default)
3. HuggingFace (default fallback, free tier)

**Key Files**:
- `ml/provider/ports.ts` (80 lines) - `MLProvider` interface
- `ml/provider/factory.ts` (133 lines) - Provider selection + lazy singleton
- `ml/provider/types.ts` (105 lines) - Provider-agnostic types
- `ml/adapters/deepinfra.ts` (171 lines) - DeepInfra adapter
- `ml/adapters/huggingface.ts` (168 lines) - HuggingFace adapter
- `ml/adapters/local.ts` (312 lines) - Local adapter with dynamic import
- `shared/errors/domain/ml.ts` (141 lines) - Provider-agnostic errors
- `integrations/huggingface/service.ts` (189 lines) - HuggingFace API client

**Benefits**:
- Multi-backend support (production, dev, local)
- Provider-agnostic error handling
- Dynamic import for local provider (no bundle bloat)
- Cache-safe model bundle hashing with provider metadata
- Graceful degradation when providers unavailable

### SSE Job Progress (Phase 5, 2026-01-21) — ✅ COMPLETE

**Purpose**: Real-time job progress updates via Server-Sent Events (replaces WebSocket).

**Key Files**:
- `routes/api.jobs.$id.progress.tsx` (156 lines) - SSE endpoint with auth, keep-alive, terminal handling
- `lib/jobs/progress/types.ts` (152 lines) - Event types with Zod validation
- `lib/jobs/progress/emitter.ts` (101 lines) - In-memory pub/sub event emitter
- `lib/jobs/progress/helpers.ts` (127 lines) - Service helper functions for emitting events
- `lib/hooks/useJobProgress.ts` (197 lines) - React hook with EventSource and TanStack Query

**Architecture**:
- Edge-compatible (no Node.js dependencies, uses Web Streams API)
- Keep-alive ping every 30 seconds
- Auto-cleanup on terminal status (completed, failed, cancelled)
- Type-safe event system (progress, status, item, error events)

**Service Integrations**:
- ✅ `capabilities/sync/orchestrator.ts` - Emits sync progress
- ✅ `capabilities/analysis/pipeline.ts` - Emits analysis progress
- ✅ `capabilities/matching/service.ts` - Emits matching progress

**Benefits**:
- Simpler than WebSocket (HTTP-based, no upgrade handshake)
- Auto-reconnect built into EventSource API
- Cloudflare Workers compatible
- Replaces 600 lines of WebSocket code with 200 lines of SSE

### LLM (v2 - AI SDK)

| Service          | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `llm/service.ts` | AI SDK wrapper (Google/Anthropic/OpenAI) |

**v2 Implementation Notes:**
- Uses `ai` package with `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`
- Supports `generateText` and `generateObject` with Zod schemas for structured output
- Provider abstraction via factory function `createLlmService(provider)`

### Analysis (v2 - with Zod schemas)

| Service                         | v2 Change                                     |
| ------------------------------- | --------------------------------------------- |
| `analysis/song-analysis.ts`     | NEW - LLM analysis with Zod structured output |
| `analysis/playlist-analysis.ts` | NEW - LLM analysis with Zod structured output |
| `analysis/pipeline.ts`          | NEW - Batch orchestrator with job tracking    |

**v2 Implementation Notes:**
- All analysis services use `LlmService.generateObject()` with Zod schemas
- `SongAnalysisLlmSchema` and `PlaylistAnalysisLlmSchema` define structured LLM output
- Pipeline creates jobs via `data/jobs.ts` and reports progress for SSE (Phase 5)
- Old services (`RetryPolicy.ts`, `RateLimitGate.ts`) N/A for v1 fresh port

### Vectorization (replaced by DeepInfra)

| Service                                                      | v2 Change                               |
| ------------------------------------------------------------ | --------------------------------------- |
| `ml/embedding/service.ts`                                    | UPDATE → calls `integrations/deepinfra` |
| `old_app/lib/services/vectorization/VectorizationService.ts` | DELETE → replaced by `DeepInfraService` |
| `capabilities/genre/service.ts`                              | Keep (Last.fm API)                      |
| `integrations/deepinfra/service.ts`                          | NEW (embeddings + reranking)            |

### Other

| Service                                 | v2 Change                                    |
| --------------------------------------- | -------------------------------------------- |
| `SyncService.ts`                        | RENAME → `capabilities/sync/orchestrator.ts` |
| `AuthService.ts`                        | Keep                                         |
| `DatabaseService.ts`                    | → `data/client.ts`                           |
| `profiling/PlaylistProfilingService.ts` | Keep                                         |
| `audio/AudioFeaturesService.ts`         | Keep                                         |

---

## New Services

### `PlaylistSyncService.ts`

Split from `PlaylistService.ts`. Handles Spotify API sync operations.

```ts
export class PlaylistSyncService {
  constructor(private spotify: SpotifyService) {}

  async syncPlaylists(accountId: string): Promise<SyncResult>
  async syncPlaylistSongs(playlistId: string): Promise<SyncResult>
  async createPlaylist(name: string, description: string): Promise<Playlist>
  async updatePlaylist(playlistId: string, updates: PlaylistUpdate): Promise<Playlist>
}
```

### SSE API Route

Replaces `JobSubscriptionManager.ts`. Server-Sent Events for job progress.

```ts
// routes/api.jobs.$id.progress.tsx
import { createAPIFileRoute } from "@tanstack/start/api"
import { Result } from "better-result"
import { requireSession } from "@/lib/auth/session"
import * as jobs from "@/lib/data/jobs"

export const Route = createAPIFileRoute("/api/jobs/$id/progress")({
  GET: async ({ request, params }) => {
    const session = requireSession(request)
    const jobId = params.id

    // Verify user owns this job
    const jobResult = await jobs.getJobById(jobId)
    if (
      Result.isError(jobResult) ||
      !jobResult.value ||
      jobResult.value.account_id !== session.accountId
    ) {
      return new Response("Not Found", { status: 404 })
    }

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        // Subscribe to job events (progress/status/item/error)
        const unsubscribe = jobEventEmitter.subscribe(jobId, (event) => {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))

          if (
            event.type === "status" &&
            (event.status === "completed" || event.status === "failed")
          ) {
            controller.close()
          }
        })

        // Cleanup on disconnect
        request.signal.addEventListener('abort', () => {
          unsubscribe()
          controller.close()
        })

        // Keep-alive ping
        const ping = setInterval(() => {
          controller.enqueue(encoder.encode(": ping\n\n"))
        }, 30000)

        request.signal.addEventListener('abort', () => clearInterval(ping))
      }
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }
    })
  }
})
```

**Event payloads:**
- `type: "progress"` → `done`, `total`, `succeeded`, `failed`
- `type: "status"` → `status` (`pending` | `running` | `completed` | `failed`)
- `type: "item"` → `itemId`, `itemKind`, `status`, optional `label`/`index`
- `type: "error"` → `message`

### `deepinfra/service.ts` (Implemented)

Replaces local Python vectorization service. Calls DeepInfra-hosted models (#053, #054, #056).

```ts
// src/lib/integrations/deepinfra/service.ts
import { Result } from "better-result";

// Embedding (1024 dims via intfloat/multilingual-e5-large-instruct)
export async function embedText(
  text: string,
  options?: { prefix?: "query:" | "passage:" }
): Promise<Result<EmbeddingResult, DeepInfraServiceError>>

export async function embedBatch(
  texts: string[],
  options?: { prefix?: "query:" | "passage:" }
): Promise<Result<EmbeddingResult[], DeepInfraServiceError>>

// Reranking (Qwen/Qwen3-Reranker-0.6B)
export async function rerank(
  query: string,
  documents: string[],
  options?: { topN?: number }
): Promise<Result<RerankResult, DeepInfraServiceError>>

// Utilities
export function getEmbeddingModel(): string  // "intfloat/multilingual-e5-large-instruct"
export function getEmbeddingDims(): number   // 1024
export function isAvailable(): Promise<boolean>
```

**Environment:**
- `DEEPINFRA_API_KEY` — API key for authentication

**Notes:**
- Uses E5 model prefixes: `query:` for search queries, `passage:` for documents
- All functions return `Result<T, Error>` for composable error handling
- Rate limiting handled via `RateLimitError` with retry-after extraction

---

## Directory Structure (v2 - Actual)

```
src/lib/
├── data/                         # Server-side DB access (Result-based)
│   ├── client.ts                 # Supabase admin client
│   ├── song.ts                   # Songs
│   ├── liked-song.ts             # Liked songs + item status
│   ├── playlists.ts              # Playlists + playlist songs
│   ├── song-analysis.ts          # Song LLM analysis
│   ├── playlist-analysis.ts      # Playlist LLM analysis
│   ├── song-audio-feature.ts     # Audio feature storage
│   ├── vectors.ts                # Song embeddings + playlist profiles
│   ├── matching.ts               # Match context + results
│   ├── jobs.ts                   # Job lifecycle management
│   ├── accounts.ts               # Account CRUD
│   ├── newness.ts                # Item status (new/seen/actioned)
│   ├── preferences.ts            # User preferences
│   ├── auth-tokens.ts            # Token refresh support
│   └── database.types.ts         # Generated Supabase types
├── capabilities/
│   ├── analysis/
│   │   ├── song-analysis.ts      # LLM song analysis (Zod schemas)
│   │   ├── playlist-analysis.ts  # LLM playlist analysis (Zod schemas)
│   │   └── pipeline.ts           # Batch orchestrator with job tracking
│   ├── genre/
│   │   └── service.ts            # Last.fm genre enrichment
│   ├── lyrics/
│   │   └── service.ts            # Genius lyrics fetching
│   ├── matching/
│   │   ├── cache.ts              # Match caching
│   │   ├── config.ts             # Matching configuration
│   │   ├── semantic.ts           # Semantic matcher
│   │   └── service.ts            # Matching service
│   ├── profiling/
│   │   └── service.ts            # Playlist profiling
│   └── sync/
│       ├── orchestrator.ts       # Full sync coordinator
│       └── playlist-sync.ts      # Playlist Spotify API sync
├── integrations/
│   ├── audio/
│   │   └── service.ts            # Audio feature retrieval
│   ├── deepinfra/
│   │   └── service.ts            # DeepInfra API (embeddings + reranking)
│   ├── lastfm/
│   │   ├── normalize.ts          # Artist/album normalization
│   │   ├── service.ts            # Last.fm API client
│   │   └── whitelist.ts          # Genre whitelist
│   ├── reccobeats/
│   │   └── service.ts            # ReccoBeats audio features
│   └── spotify/
│       └── service.ts            # Spotify API client
├── jobs/
│   ├── lifecycle.ts              # Job state transitions
│   └── progress/
│       ├── emitter.ts            # Job progress event emitter
│       ├── helpers.ts            # Emit helper utilities
│       └── types.ts              # SSE event types
├── ml/
│   ├── embedding/
│   │   ├── extractors.ts         # Embedding text extraction
│   │   ├── hashing.ts            # Embedding hashing
│   │   ├── service.ts            # Song embedding with caching
│   │   └── versioning.ts         # Embedding versioning
│   ├── llm/
│   │   └── service.ts            # AI SDK wrapper (Google/Anthropic/OpenAI)
│   └── reranker/
│       └── service.ts            # Cross-encoder reranking
└── shared/
    ├── errors/
    │   ├── data.ts               # DbError types
    │   └── service.ts            # Service error types (TaggedError)
    └── utils/
        ├── concurrency.ts        # Concurrency limiter
        └── result-wrappers/      # Supabase → Result adapters
            └── supabase.ts
```

**Notes:**
- All services use `Result<T, Error>` from `better-result`
- Error types follow `TaggedError` pattern for exhaustive matching
- No barrel exports (index.ts) - use direct imports
- Zod schemas colocated in service files (not separate schemas/ folder)

---

## Migration Sequence

1. ✅ **Phase 1: Schema** — Create all 17 tables with RLS
2. ✅ **Phase 2: Extensions** — Enable pgvector, generate TypeScript types
3. ✅ **Phase 3: Query modules** — Create 9+ data modules with Result-based API
4. **Phase 4: Service layer** — Port all services
   - 4a: ✅ Factory removal (N/A for v1 fresh port)
   - 4b: ✅ Song/Analysis services with Zod schemas
   - 4c: ✅ Playlist/Sync services
   - 4d: ✅ DeepInfra migration
   - 4e: ⬜ **Matching Pipeline** (~3,100 lines) — Core matching algorithm
   - 4f: ⬜ **Genre Enrichment** (~1,260 lines) — Last.fm integration
   - 4g: ⬜ **Playlist Profiling** (~1,040 lines) — Playlist vector computation
5. ⬜ **Phase 5: SSE migration** — Replace WebSocket with Server-Sent Events
6. ⬜ **Phase 6: Cleanup** — Delete old_app, unused dependencies

> ⚠️ **Gap Note**: Phases 4e-4g contain ~5,400 lines of core business logic that was originally marked "KEEP" but not tracked for migration. Without these, the app can analyze songs but cannot match them to playlists.

---

## Resolved Decisions

| #   | Question                                 | Decision                                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Q1  | Query module location?                   | `data/` — clear, doesn't conflict with client-side `queries/`            |
| Q2  | Merge SyncService + PlaylistSyncService? | Keep separate — SyncOrchestrator orchestrates both songs + playlists     |
| Q3  | Keep `matching-config.ts`?               | Keep separate → `matching.config.ts` (tuning without touching algorithm) |
| Q4  | Newness tracking?                        | `item_status` table — flexible for songs, matches, playlists             |

---

*Last updated: January 20, 2026 — Phases 4e-4g identified and documented*
