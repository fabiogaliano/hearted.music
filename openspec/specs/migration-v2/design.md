# Migration v2 Design

> Technical decisions and architectural patterns for the v2 migration.

**Full decision log**: `docs/migration_v2/00-DECISIONS.md` (56 decisions)

---

## Schema Mapping

| Old (v0)                  | New (v2)                  | Change                       |
| ------------------------- | ------------------------- | ---------------------------- |
| `tracks`                  | `song`                    | Rename                       |
| `audio_features`          | `song_audio_feature`      | Rename                       |
| `saved_tracks`            | `liked_song`              | Rename + soft delete         |
| `playlist_tracks`         | `playlist_song`           | Drop `user_id`               |
| `track_analyses`          | `song_analysis`           | Rename + metadata            |
| `playlist_analyses`       | `playlist_analysis`       | Rename + metadata            |
| `track_embeddings`        | `song_embedding`          | Rename                       |
| `track_genres`            | `song.genres`             | Moved into song genres array |
| `playlist_profiles`       | `playlist_profile`        | Rename                       |
| `playlists.is_flagged`    | `playlist.is_destination` | Rename                       |
| `users`                   | `account`                 | Rename + simplify            |
| `user_preferences`        | —                         | DROP (#017)                  |
| `provider_keys`           | —                         | DROP (#016)                  |
| `analysis_jobs`           | `job`                     | Unified (#021)               |
| `track_analysis_attempts` | `job_failure`             | Rename                       |
| —                         | `item_status`             | NEW (newness)                |
| —                         | `user_preferences`        | NEW (settings)               |

---

## Key Architectural Decisions

### Data Layer

| #    | Decision                               | Rationale                                            |
| ---- | -------------------------------------- | ---------------------------------------------------- |
| #030 | 9 query modules, no repository classes | Domain-organized functions with inferred types       |
| #031 | Supabase JS client (no ORM)            | RLS works automatically; avoids schema sync overhead |
| #029 | Query functions only (defer RPCs)      | Fresh UI = unknown data needs. Start simple.         |

### Service Layer

| #    | Decision                                      | Rationale                                                        |
| ---- | --------------------------------------------- | ---------------------------------------------------------------- |
| #032 | Keep SpotifyService, delete TrackService      | SpotifyService is API client. TrackService is thin wrapper.      |
| #033 | Merge batch+prefetch+progress → `pipeline.ts` | Tightly coupled orchestration. Keep retry/rate-limiter separate. |
| #034 | Delete all factory files                      | Query modules are pure functions. Services are singletons.       |

### Infrastructure

| #        | Decision                           | Rationale                                               |
| -------- | ---------------------------------- | ------------------------------------------------------- |
| #035     | SSE replaces WebSocket             | Simpler, auto-reconnects, Cloudflare Workers compatible |
| #051     | Cloudflare Workers                 | Free tier (100K req/day), global edge, native SSR       |
| #052     | Supabase Cloud Free                | Free tier with ping to prevent pause                    |
| #053-054 | DeepInfra for embeddings/reranking | Same models as local, no reindexing needed              |
| #055-056 | Drop Python vectorization          | Replaced by DeepInfra API calls                         |

### Data Model

| #        | Decision                            | Rationale                                     |
| -------- | ----------------------------------- | --------------------------------------------- |
| #007     | UUID primary keys                   | Platform independence; Supabase RLS patterns  |
| #008     | Separate `song_audio_feature` table | Different source/lifecycle; keeps `song` lean |
| #010     | Soft delete with `unliked_at`       | Preserves timeline for archival               |
| #021-023 | Unified `job` + `job_failure`       | Single query for "what's running?"            |
| #044-046 | Separate `user_preferences` table   | Clean separation from account identity        |

---

## Query Module Structure

```
lib/data/
├── client.ts       # Supabase client setup
├── songs.ts        # getSongById, getLikedSongs, upsertSongs...
├── playlists.ts    # getPlaylists, getDestinationPlaylists...
├── analysis.ts     # getSongAnalysis, insertSongAnalysis...
├── vectors.ts      # getSongEmbedding, upsertPlaylistProfile...
├── matching.ts     # getMatchContext, insertMatchResults...
├── jobs.ts         # getActiveJob, updateJobProgress...
├── accounts.ts     # getAccountById, upsertAccount...
├── newness.ts      # getNewCounts, markSeen, markItemsNew...
└── preferences.ts  # getPreferences, updateTheme, updateOnboardingStep...
```

---

## Service Layer Structure

```
lib/capabilities/
├── sync/
│   ├── orchestrator.ts        # Orchestrates songs + playlists sync
│   └── playlist-sync.ts       # Spotify API sync operations
├── analysis/
│   ├── song-analysis.ts
│   ├── playlist-analysis.ts
│   ├── pipeline.ts            # Merged batch orchestration
│   ├── retry-policy.ts
│   └── rate-limit-gate.ts
├── matching/
│   ├── service.ts
│   ├── cache.ts
│   └── config.ts
├── genre/
│   └── service.ts
└── profiling/
    └── service.ts

lib/integrations/
├── spotify/
│   └── service.ts             # Spotify API client
├── deepinfra/
│   └── service.ts             # Embeddings + reranking API
├── lastfm/
│   └── service.ts
├── reccobeats/
│   └── service.ts
└── audio/
    └── service.ts

lib/ml/
├── embedding/                 # Embedding helpers + service
├── reranker/                  # Cross-encoder reranking
└── llm/                       # AI SDK wrapper

lib/jobs/
├── lifecycle.ts               # Job state transitions
└── progress/                  # SSE progress emitter/types

lib/shared/
├── errors/
└── utils/
```

---

## Database Table Tiers

```
Tier 1 (no deps):     account, song

Tier 2:               liked_song, playlist, song_audio_feature,
                      song_analysis, song_embedding, job

Tier 3:               playlist_song, playlist_analysis, playlist_profile,
                      job_failure, match_context, item_status, user_preferences

Tier 4:               match_result
```

Migration must respect foreign key dependencies.

---

## RLS Patterns

### Direct Ownership
```sql
CREATE POLICY "Users can view own X"
  ON table_name FOR SELECT
  USING (account_id = auth.uid());
```

### Junction Table via Subquery
```sql
CREATE POLICY "Users can view own playlist songs"
  ON playlist_song FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM playlist
      WHERE playlist.id = playlist_song.playlist_id
      AND playlist.account_id = auth.uid()
    )
  );
```

### Global Read, Service Write
```sql
CREATE POLICY "Anyone can read songs"
  ON song FOR SELECT
  USING (true);
-- No INSERT/UPDATE policy = service_role only
```

---

## SSE Pattern

```typescript
// routes/api/jobs/$id/progress.tsx
export const Route = createAPIFileRoute('/api/jobs/$id/progress')({
  GET: async ({ request, params }) => {
    const session = await requireUserSession(request)
    const jobId = params.id

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        const unsubscribe = jobEventEmitter.subscribe(jobId, (progress) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`))

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

---

## Anti-Patterns to Avoid

From `docs/LESSONS-LEARNED.md`:

| Anti-Pattern                | Solution                        |
| --------------------------- | ------------------------------- |
| N+1 queries in loops        | Batch queries with `getByIds()` |
| Giant 500+ line components  | Compose small, focused pieces   |
| Type assertions (`as X`)    | Typed transformer functions     |
| Mixed fetching strategies   | Consistent TanStack Query       |
| Local interface definitions | Shared domain models            |
| Error swallowing            | Explicit error states           |
| Hardcoded UI logic          | Design system utilities         |
| Defensive guards            | Validate at boundaries          |

---

## References

- `docs/migration_v2/00-DECISIONS.md` - Full decision log
- `docs/migration_v2/01-SCHEMA.md` - Column-level schema mapping
- `docs/migration_v2/02-SERVICES.md` - Service consolidation details
- `docs/migration_v2/03-IMPLEMENTATION.md` - Phase tasks with SQL
- `docs/migration_v2/ROADMAP.md` - Task tracking board
