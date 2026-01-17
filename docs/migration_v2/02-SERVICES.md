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
| Query modules      | 0 files   | 9   | NEW (domain-organized) (#030)             |
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

| File                           | Replacement          | Reason                 |
| ------------------------------ | -------------------- | ---------------------- |
| `TrackService.ts`              | → `data/songs.ts`    | Thin DB wrapper (#032) |
| `UserService.ts`               | → `data/accounts.ts` | Thin DB wrapper        |
| `vectorization/VectorCache.ts` | —                    | In-memory → DB-backed  |
| `llm/ProviderKeyService.ts`    | —                    | Table dropped (#016)   |

### Python Service (entire folder) — #056

| File/Folder                           | Replacement             | Reason                                              |
| ------------------------------------- | ----------------------- | --------------------------------------------------- |
| `services/vectorization/` (Python)    | → `DeepInfraService.ts` | DeepInfra hosts same models; no self-hosting needed |
| `VectorizationService.ts` (TS client) | → `DeepInfraService.ts` | Single service for embeddings + reranking           |

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

## Query Modules (9 new files)

> Location: `data/`

### 1. `songs.ts`

From: `TrackService`, `trackRepository`

```ts
// Core queries
export function getSongById(id: string)
export function getSongBySpotifyId(spotifyId: string)
export function getSongsBySpotifyIds(spotifyIds: string[])
export function upsertSongs(songs: SongInsert[])

// Liked songs
export function getLikedSongs(accountId: string)
export function getLikedSongsWithAnalysis(accountId: string)
export function upsertLikedSongs(likedSongs: LikedSongInsert[])
export function softDeleteLikedSong(accountId: string, songId: string)

// Filtering
export function getUnmatchedLikedSongs(accountId: string)  // status IS NULL
export function updateLikedSongStatus(accountId: string, songId: string, status: 'matched' | 'ignored')
```

### 2. `playlists.ts`

From: `PlaylistService` (DB ops), `playlistRepository`

```ts
// Playlists
export function getPlaylists(accountId: string)
export function getPlaylistById(id: string)
export function getDestinationPlaylists(accountId: string)  // is_destination = true
export function upsertPlaylists(playlists: PlaylistInsert[])
export function deletePlaylist(id: string)

// Playlist songs
export function getPlaylistSongs(playlistId: string)
export function getPlaylistSongsWithDetails(playlistId: string)
export function upsertPlaylistSongs(playlistSongs: PlaylistSongInsert[])
export function removePlaylistSongs(playlistId: string, songIds: string[])
```

### 3. `analysis.ts`

From: `trackAnalysisRepository`, `playlistAnalysisRepository`

```ts
// Song analysis
export function getSongAnalysis(songIds: string | string[])
export function insertSongAnalysis(analysis: SongAnalysisInsert)

// Playlist analysis
export function getPlaylistAnalysis(playlistId: string)
export function insertPlaylistAnalysis(analysis: PlaylistAnalysisInsert)

// Audio features
export function getSongAudioFeatures(songId: string)
export function upsertSongAudioFeatures(features: SongAudioFeatureInsert[])
```

### 4. `vectors.ts`

From: `EmbeddingService` (DB ops), `embeddingRepository`

```ts
// Song embeddings
export function getSongEmbedding(songId: string, kind: string, model: string)
export function upsertSongEmbedding(embedding: SongEmbeddingInsert)
export function getSongEmbeddingsByContentHash(songId: string, kind: string, contentHash: string)

// Playlist profiles
export function getPlaylistProfile(playlistId: string, kind: string)
export function upsertPlaylistProfile(profile: PlaylistProfileInsert)
export function getPlaylistProfilesByModelBundle(playlistId: string, modelBundleHash: string)
```

### 5. `matching.ts`

From: `matchContextRepository`, `matchResultRepository`

```ts
// Match context
export function getMatchContext(contextHash: string)
export function createMatchContext(context: MatchContextInsert)
export function getMatchContextsForAccount(accountId: string)

// Match results
export function getMatchResults(contextId: string)
export function getMatchResultsForSong(contextId: string, songId: string)
export function insertMatchResults(results: MatchResultInsert[])
export function getTopMatchesPerPlaylist(contextId: string, limit: number)
```

### 6. `jobs.ts`

From: `JobPersistenceService`, `analysisJobRepository`

```ts
// Jobs
export function getActiveJob(accountId: string)
export function getJobById(id: string)
export function createJob(job: JobInsert)
export function updateJobProgress(id: string, progress: JobProgress)
export function markJobCompleted(id: string)
export function markJobFailed(id: string)

// Job failures
export function getJobFailures(jobId: string)
export function insertJobFailure(failure: JobFailureInsert)
```

### 7. `accounts.ts`

From: `UserService`, `userRepository`

```ts
export function getAccountById(id: string)
export function getAccountBySpotifyId(spotifyId: string)
export function upsertAccount(account: AccountInsert)
// Note: theme + onboarding live in preferences.ts (#044)
```

### 8. `newness.ts`

From: NEW (`item_status` table)

```ts
// Counts for UI badges
export function getNewCounts(accountId: string): Promise<{ songs: number; matches: number; playlists: number }>
export function getNewItemIds(accountId: string, itemType: ItemType): Promise<string[]>

// Creating newness (called by sync/analysis services)
export function markItemsNew(accountId: string, itemType: ItemType, itemIds: string[]): Promise<void>

// Clearing newness
export function markSeen(accountId: string, itemType: ItemType, itemIds: string[]): Promise<void>
export function markAllSeen(accountId: string, itemType: ItemType): Promise<void>
```

### 9. `preferences.ts`

From: NEW (`user_preferences` table)

```ts
// Get preferences (auto-creates on first access)
export function getPreferences(accountId: string): Promise<UserPreferences>

// Theme (color palette)
export function updateTheme(accountId: string, theme: ThemeColor): Promise<void>

// Onboarding
export function getOnboardingStep(accountId: string): Promise<OnboardingStep>
export function updateOnboardingStep(accountId: string, step: OnboardingStep): Promise<void>
export function completeOnboarding(accountId: string): Promise<void>  // Sets step to 'complete'

// Types
type ThemeColor = 'blue' | 'green' | 'rose' | 'lavender'
type OnboardingStep = 'welcome' | 'pick-color' | 'connecting' | 'syncing' | 'flag-playlists' | 'ready' | 'complete'
```

---

## Services to KEEP

### Core Algorithm (unchanged)

| Service                           | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `matching/MatchingService.ts`     | Core matching algorithm                        |
| `matching/MatchCachingService.ts` | Cache-first orchestration                      |
| `matching/matching.config.ts`     | Algorithm weights & thresholds (keep separate) |
| `semantic/SemanticMatcher.ts`     | Theme/mood similarity                          |
| `reranker/RerankerService.ts`     | Two-stage reranking                            |

### API Clients (unchanged)

| Service                           | Purpose                   |
| --------------------------------- | ------------------------- |
| `SpotifyService.ts`               | Spotify API client (#032) |
| `lastfm/LastFmService.ts`         | Last.fm API               |
| `lyrics/LyricsService.ts`         | Genius API                |
| `reccobeats/ReccoBeatsService.ts` | ReccoBeats API            |

### LLM (unchanged)

| Service                              | Purpose                |
| ------------------------------------ | ---------------------- |
| `llm/LlmProviderManager.ts`          | Provider orchestration |
| `llm/providers/GoogleProvider.ts`    | Gemini                 |
| `llm/providers/OpenAIProvider.ts`    | GPT-4                  |
| `llm/providers/AnthropicProvider.ts` | Claude                 |

### Analysis (simplified)

| Service                               | v2 Change                  |
| ------------------------------------- | -------------------------- |
| `analysis/SongAnalysisService.ts`     | Keep (LLM calls)           |
| `analysis/PlaylistAnalysisService.ts` | Keep (LLM calls)           |
| `analysis/pipeline.ts`                | NEW (merged orchestration) |
| `analysis/RetryPolicy.ts`             | Keep                       |
| `analysis/RateLimitGate.ts`           | Keep                       |

### Vectorization (replaced by DeepInfra)

| Service                                 | v2 Change                               |
| --------------------------------------- | --------------------------------------- |
| `embedding/EmbeddingService.ts`         | UPDATE → calls `DeepInfraService`       |
| `vectorization/VectorizationService.ts` | DELETE → replaced by `DeepInfraService` |
| `genre/GenreEnrichmentService.ts`       | Keep (Last.fm API)                      |
| `deepinfra/DeepInfraService.ts`         | NEW (embeddings + reranking)            |

### Other

| Service                                 | v2 Change                                                            |
| --------------------------------------- | -------------------------------------------------------------------- |
| `SyncService.ts`                        | RENAME → `SyncOrchestrator.ts` (orchestrates songs + playlists sync) |
| `AuthService.ts`                        | Keep                                                                 |
| `DatabaseService.ts`                    | → `data/client.ts`                                                   |
| `profiling/PlaylistProfilingService.ts` | Keep                                                                 |
| `audio/AudioFeaturesService.ts`         | Keep                                                                 |

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

        // Subscribe to job progress updates
        const unsubscribe = jobEventEmitter.subscribe(jobId, (progress) => {
          const data = `data: ${JSON.stringify(progress)}\n\n`
          controller.enqueue(encoder.encode(data))

          // Close stream when job completes
          if (progress.status === 'completed' || progress.status === 'failed') {
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
          controller.enqueue(encoder.encode(': ping\n\n'))
        }, 30000)

        request.signal.addEventListener('abort', () => clearInterval(ping))
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }
})
```

### `DeepInfraService.ts`

Replaces local Python vectorization service. Calls DeepInfra-hosted models (#053, #054, #056).

```ts
// lib/services/deepinfra/DeepInfraService.ts
const EMBEDDING_URL = 'https://api.deepinfra.com/v1/openai/embeddings'
const RERANKER_URL = 'https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B'

export async function embedText(text: string): Promise<number[]> {
  // POST to EMBEDDING_URL with:
  // { input: "query: " + text, model: "intfloat/multilingual-e5-large-instruct", encoding_format: "float" }
  // Note: Prefix with "query:" or "passage:" for optimal results
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // POST with input as array of strings
}

export async function rerank(query: string, documents: string[]): Promise<RerankResult[]> {
  // POST to RERANKER_URL with: { queries: [query], documents }
  // Returns: { scores: number[] }
}
```

**Environment:**
- `DEEPINFRA_API_KEY` — API key for authentication

---

## Directory Structure (v2)

```
lib/
├── data/                       # Server-side DB access
│   ├── client.ts               # Supabase client (from DatabaseService)
│   ├── songs.ts
│   ├── playlists.ts
│   ├── analysis.ts
│   ├── vectors.ts
│   ├── matching.ts
│   ├── jobs.ts
│   ├── accounts.ts
│   ├── newness.ts              # NEW (item_status table)
│   └── preferences.ts          # NEW (user_preferences table)
├── services/
│   ├── sync/
│   │   ├── SyncOrchestrator.ts # Renamed from SyncService
│   │   └── PlaylistSyncService.ts
│   ├── spotify/
│   │   └── SpotifyService.ts
│   ├── analysis/
│   │   ├── SongAnalysisService.ts
│   │   ├── PlaylistAnalysisService.ts
│   │   ├── pipeline.ts         # NEW (merged)
│   │   ├── RetryPolicy.ts
│   │   └── RateLimitGate.ts
│   ├── deepinfra/
│   │   └── DeepInfraService.ts  # NEW (replaces Python vectorization)
│   ├── matching/
│   │   ├── MatchingService.ts
│   │   ├── MatchCachingService.ts
│   │   └── matching.config.ts  # Kept separate
│   ├── llm/
│   │   ├── LlmProviderManager.ts
│   │   └── providers/...
│   ├── embedding/
│   │   └── EmbeddingService.ts
│   ├── semantic/
│   │   └── SemanticMatcher.ts
│   ├── reranker/
│   │   └── RerankerService.ts
│   └── external/               # External API clients
│       ├── LastFmService.ts
│       ├── LyricsService.ts
│       └── ReccoBeatsService.ts
├── schemas/                    # Valibot schemas (#037)
│   ├── song.schema.ts
│   ├── playlist.schema.ts
│   ├── analysis.schema.ts
│   └── job.schema.ts
└── auth/
    └── AuthService.ts
```

---

## Migration Sequence

1. **Phase 1: Query modules** — Extract DB operations, keep old services as facades
2. **Phase 2: Delete factories** — Update imports to direct
3. **Phase 3: Merge pipeline** — Combine batch/prefetch/progress
4. **Phase 4: Split PlaylistService** — Extract sync logic
5. **Phase 5: SSE migration** — Replace JobSubscriptionManager
6. **Phase 6: Cleanup** — Delete thin wrappers, unused files

---

## Resolved Decisions

| #   | Question                                 | Decision                                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Q1  | Query module location?                   | `data/` — clear, doesn't conflict with client-side `queries/`            |
| Q2  | Merge SyncService + PlaylistSyncService? | Keep separate — SyncOrchestrator orchestrates both songs + playlists     |
| Q3  | Keep `matching-config.ts`?               | Keep separate → `matching.config.ts` (tuning without touching algorithm) |
| Q4  | Newness tracking?                        | `item_status` table — flexible for songs, matches, playlists             |

---

*Next: 03-IMPLEMENTATION.md (phased tasks with checkboxes)*
