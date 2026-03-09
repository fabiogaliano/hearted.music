## Context

The sync endpoint (`src/routes/api/extension/sync.tsx`) successfully writes liked songs and playlists to the database, but nothing happens after. The enrichment services (analysis, embedding, profiling, matching) are all implemented but have no trigger. All enrichment tables are empty (0 rows in `song_analysis`, `song_embedding`, `song_audio_feature`, `playlist_profile`, `match_context`, `match_result`).

Existing infrastructure:
- `AnalysisPipeline` (`src/lib/capabilities/analysis/pipeline.ts`) — batch song analysis with job tracking and SSE progress, includes `getSongsNeedingAnalysis()` for incremental filtering
- `EmbeddingService` (`src/lib/ml/embedding/service.ts`) — embeds analysis text, stores in `song_embedding`, supports batch with content hashing for cache invalidation
- `PlaylistProfilingService` (`src/lib/capabilities/profiling/service.ts`) — computes centroid embeddings + audio centroids + genre distributions for playlists
- `MatchingService` (`src/lib/capabilities/matching/service.ts`) — multi-factor scoring with `matchBatch()` and SSE progress
- `AudioFeaturesService` (`src/lib/integrations/audio/service.ts`) — fetches from ReccoBeats (free, no API key), has `getOrFetchFeatures()` and `backfillMissingFeatures()` for batch processing
- Job lifecycle (`src/lib/jobs/lifecycle.ts`) — `startJob`/`finalizeJob`/`completeJob`/`failJob` with retry
- SSE progress (`src/lib/jobs/progress/helpers.ts`) — `emitProgress`/`emitItem`/`emitStatus`

## Goals / Non-Goals

**Goals:**
- After sync completes, automatically run the enrichment pipeline: audio features → song analysis → song embeddings → playlist profiling → matching
- Each stage runs as a tracked job with SSE progress
- Incremental: on re-sync, only process new/unprocessed songs
- Batch cap: limit first run to N songs (default 5, configurable) to control LLM cost during development
- Populate `match_result` with real scores so the UI wiring change (Change B) has data to consume

**Non-Goals:**
- UI changes (route loader, component rewiring, real types) — separate Change B
- Running the pipeline outside of post-sync context (manual trigger, cron, etc.)
- Spotify playlist mutations (adding tracks via Pathfinder)
- Pipeline retry/resume after partial failure (jobs are marked failed; user re-syncs to retry)
- Genre enrichment via Last.fm (song.genres is already populated from Spotify data in sync)

## Decisions

### 1. Pipeline orchestrator as a single function, not a class

**Decision:** Create a `runEnrichmentPipeline(accountId, options)` function in `src/lib/capabilities/pipeline/orchestrator.ts` rather than a class.

**Rationale:** The existing `AnalysisPipeline` class works well for its scope (analysis + lyrics prefetch), but the orchestrator is simpler — it just calls existing services in sequence. No internal state to manage, no constructor dependencies to inject. A plain async function with Result return is the lightest approach.

**Alternative considered:** A `PipelineOrchestrator` class mirroring `AnalysisPipeline`. Rejected because the orchestrator doesn't hold service instances — each stage creates its own via existing factory functions.

### 2. Sequential stages within one request, not job-per-stage

**Decision:** The orchestrator runs all stages sequentially within the sync endpoint's response lifecycle. Each stage creates its own job for progress tracking, but the stages are not independently schedulable.

**Rationale:** The sync endpoint already runs 3 phases sequentially (liked songs → playlists → playlist tracks). Adding 5 more stages to the same pattern is consistent. The alternative (a job queue where each stage enqueues the next) adds infrastructure complexity we don't need — there's no worker pool, no SQS, just a single request.

**Trade-off:** If the sync endpoint times out (Cloudflare Workers has a time limit), the pipeline will be cut short. Mitigation: the 5-song batch cap makes the total wall time manageable (~30-60s for 5 songs). Full library runs will need the job queue approach later.

**Alternative considered:** Fire-and-forget after returning the sync response. Rejected because Cloudflare Workers terminate execution after response is sent — background work is not guaranteed to complete.

### 3. Batch cap via orchestrator config, not database flag

**Decision:** The orchestrator accepts a `maxSongs` option (default 5). The sync endpoint passes this value. To uncap, change the value in the sync endpoint code or make it an env var.

**Rationale:** Simple, no database migration needed. During development, the cap is hardcoded. When ready for production, promote to `PIPELINE_MAX_SONGS` env var.

**Alternative considered:** A flag in `user_preferences` table. Rejected — this is a development safeguard, not a user-facing preference. The user doesn't decide how many songs to analyze.

### 4. Trigger point: after Phase 3 in sync endpoint, before response

**Decision:** Add pipeline invocation after the existing 3 sync phases complete (line ~382 in `sync.tsx`), before `Response.json()`. The pipeline result is included in the response alongside sync results.

**Data flow:**
```
POST /api/extension/sync
  → Phase 1: Liked songs sync
  → Phase 2: Playlists sync
  → Phase 3: Playlist tracks (no-op)
  → Phase 4: Enrichment pipeline (NEW)
      → 4a: Audio features (ReccoBeats, free) - AudioFeaturesService.getOrFetchFeatures()
      → 4b: Song analysis (LLM via AnalysisPipeline) - AnalysisPipeline.analyzeSongs()
      → 4c: Song embeddings (ML provider) - EmbeddingService.embedBatch()
      → 4d: Playlist profiling (computed from embeddings + audio + genres) - PlaylistProfilingService.computeProfile()
      → 4e: Matching (MatchingService.matchBatch)
  → Response: { ok: true, results: { ...sync, pipeline: { ... } }, phaseJobIds, pipelineJobIds }
```

**Implementation Details:**
- Each stage creates its own job via existing `createJob()` function
- Stage job IDs collected and returned as `pipelineJobIds` array
- Pipeline results aggregated into structured response object
- Errors captured per-stage but don't fail overall sync response

**Rationale:** Keeps the pipeline tightly coupled to sync completion — no orphaned pipeline runs, no need for a separate trigger mechanism. The pipeline only runs when there's fresh data.

### 5. Each stage filters its own work (incremental by design)

**Decision:** Each stage queries the database for items that haven't been processed yet, rather than the orchestrator passing explicit lists between stages.

**Implementation Details:**
- Audio features: `AudioFeaturesService.getOrFetchFeatures()` — fetches existing from DB, backfills missing from ReccoBeats
- Analysis: `AnalysisPipeline.getSongsNeedingAnalysis()` - already implemented (line 427 in pipeline.ts)
- Embeddings: Songs with `song_analysis` but no `song_embedding` - filter in orchestrator
- Profiling: Destination playlists with no `playlist_profile` or stale `content_hash` - `PlaylistProfilingService.computeProfile()` handles caching
- Matching: Songs with no `item_status` against profiled destination playlists - `MatchingService.matchBatch()` with filtered inputs

**Batch Selection Logic:**
- Apply `maxSongs` limit after filtering to "most recently liked" songs
- Use `ORDER BY liked_at DESC LIMIT maxSongs` in song selection queries
- Each stage respects the same limited song set for consistency

### 6. Pipeline failures are non-fatal to sync

**Decision:** If any pipeline stage fails, log the error and continue with the next stage. The sync response still returns `ok: true` because the sync itself succeeded. Pipeline failures are reported in a separate `pipeline` field in the response.

**Rationale:** A user's data sync should never fail because the LLM is down or ReccoBeats is unreachable. The pipeline is a best-effort enrichment pass. Users can re-sync to retry.

### 7. Matching runs against destination playlists only

**Decision:** `MatchingService.matchBatch()` is called with only playlists where `is_destination = true` (currently 26 playlists). Songs are matched against these, not all 134 playlists.

**Rationale:** The whole point of "flag playlists" in onboarding is to mark which playlists are sorting targets. Non-destination playlists are irrelevant to matching.

## Risks / Trade-offs

**[Cloudflare Workers timeout]** → The 5-song batch cap keeps wall time under 60s. Full library support will need a different execution model (e.g., Durable Objects, external worker, or chunked re-invocation). Deferred.

**[LLM rate limits]** → Gemini Flash has generous rate limits. The 5-song cap and concurrency=5 in `AnalysisPipeline` keep request rates low. If rate-limited, `LlmService` returns errors and `AnalysisPipeline` records them as failed items.

**[ReccoBeats API unreliability]** → Audio features stage fails gracefully. `MatchingService` uses adaptive weights — if audio features are missing, it redistributes weight to embedding + genre factors.

**[Empty embeddings for songs without analysis]** → If song analysis fails for a song, it won't have an embedding, and matching will rely only on genre overlap (audio centroid if available). This is acceptable for v1.

**[Playlist profiling requires track embeddings]** → If no songs in a destination playlist have embeddings yet (first-ever run), the playlist profile will have null embedding centroid. Matching falls back to audio + genre factors only.

**[Re-sync creates duplicate match results]** → `match_result` has a unique constraint on `(context_id, song_id, playlist_id)`. Each pipeline run creates a new `match_context`, so old results coexist with new ones. The UI (Change B) should query the latest context.

## Open Questions

1. **Job type enum values.** The existing `job_type` enum has `song_analysis`, `playlist_analysis`, `matching`. Audio features and embedding stages may need new job types added to the enum, or they can reuse existing types. Verify alignment before implementation.
