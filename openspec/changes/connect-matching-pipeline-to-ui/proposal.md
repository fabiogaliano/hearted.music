## Why

The matching service, database schema, and UI components were originally disconnected, so the post-sync enrichment pipeline had to be wired into the sync request lifecycle.

That implementation now exists, but the most recent pipeline refactor changed the shape of the shipped workflow: the pipeline is no longer a simple five-stage sequential chain, and the active OpenSpec proposal no longer matches the code.

This revision updates the change artifacts so they describe the pipeline that actually shipped, while leaving playlist-profile bootstrap improvements to a separate follow-up change.

## What Changes

- **Pipeline orchestrator implementation**: `runEnrichmentPipeline()` coordinates a six-stage enrichment flow inside the sync request lifecycle
- **Dependency-aware execution**: the pipeline runs a parallel-safe prep phase (`audio_features`, `genre_tagging`, `playlist_profiling`) followed by dependent stages (`song_analysis`, `song_embedding`, `matching`)
- **Sync endpoint integration**: `POST /api/extension/sync` triggers the pipeline after Phase 3 and returns stage results plus `pipelineJobIds`
- **Batch sizing**: the orchestrator uses `batchSize` semantics with `PIPELINE_BATCH_SIZE` as the primary environment override and `PIPELINE_MAX_SONGS` as a legacy fallback
- **Pipeline progress visibility**: each stage owns its own job and SSE lifecycle so the UI can subscribe independently
- **Non-fatal failures**: stage failures are reported inline on stage results, while bootstrap failures surface as a top-level pipeline error without failing sync itself

### Out of scope (separate changes)

- **UI wiring**: Route loader, real types, server function for match session, and handler wiring to server actions
- Spotify playlist mutation (actually adding tracks via Pathfinder API)
- Extension sync optimization (incremental pagination, early stopping)
- Playlist-profile bootstrap from playlist descriptions and free member-song enrichment

## Affected specs

- `pipeline-orchestration`
- `data-flow`
- `matching-pipeline`

## Capabilities

### New Capabilities

- **pipeline-orchestration**: Post-sync orchestration for the six-stage enrichment pipeline and the sync-response contract that exposes stage results and job IDs

### Modified Capabilities

- **matching-pipeline**: Clarify how destination-playlist matching is triggered from the post-sync pipeline
- **data-flow**: Clarify dependency-ordered job chains, including safe parallel prep work and the shape of `pipelineJobIds`

## Impact

- **Sync endpoint**: `src/routes/api/extension/sync.tsx` — trigger the pipeline after sync phases complete and include pipeline status in the response
- **Workflows**: `src/lib/workflows/enrichment-pipeline/` — orchestrator, batch selection, and six stage modules (`audio_features`, `genre_tagging`, `playlist_profiling`, `song_analysis`, `song_embedding`, `matching`)
- **Jobs**: `src/lib/platform/jobs/` plus `supabase/migrations/` — per-stage job tracking, including `genre_tagging`
- **Tests**: `src/lib/workflows/enrichment-pipeline/__tests__/` — orchestrator and integration coverage for stage order, isolation, and response shape
- **API keys**: `GEMINI_API_KEY` for song analysis and `LASTFM_API_KEY` for genre enrichment when available; audio features remain on ReccoBeats
- **Cost**: Song analysis remains the only paid stage. Audio features and genre enrichment are free-tier/bootstrap signals
