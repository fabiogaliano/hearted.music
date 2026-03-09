## Why

The matching service, database schema, and UI components all exist but are completely disconnected. The pipeline has never run (0 rows in song_analysis, song_embedding, playlist_profile, match_result), and no trigger exists to start it after sync completes.

This change makes the pipeline actually run — producing real match results that the UI can consume (UI wiring is a separate follow-up change).

## What Changes

- **Pipeline Orchestrator Implementation**: Create `runEnrichmentPipeline()` function to coordinate existing services in sequence with proper error handling and job tracking
- **Sync Endpoint Integration**: Add pipeline trigger after sync Phase 3 completion, include pipeline job IDs and results in response
- **Pipeline Job Chain**: Sequential job execution where each stage creates its own job for SSE progress. Reuses existing job lifecycle and progress infrastructure
- **Batch limit**: First run capped at 5 songs. Full library processing gated behind manual uncap to control LLM costs during development
- **Pipeline progress visibility**: Surface enrichment job progress via existing SSE infrastructure so the frontend can subscribe and display status
- **Error Handling**: Graceful degradation where pipeline failures don't break sync, with detailed error reporting in response

### Out of scope (separate changes)

- **UI wiring** (Change B): Route loader, real types, server function for match session, handler wiring to server actions — depends on this change producing data
- Spotify playlist mutation (actually adding tracks via Pathfinder API)
- Extension sync optimization (incremental pagination, early stopping)
- Onboarding "First Match Demo" (single-song pipeline path)

## Capabilities

### New Capabilities

- **pipeline-orchestration**: Post-sync job chain that sequences enrichment stages (audio → analysis → embedding → profiling → matching) with dependency management, batch limits, incremental processing, and SSE progress. Defines the trigger contract between sync completion and downstream processing.

### Modified Capabilities

- **matching-pipeline**: Add trigger specification — when and how the pipeline is invoked (post-sync automatic, re-sync incremental for new songs only), batch size limits, and how completion is signaled
- **data-flow**: Add job chaining pattern — how one job's completion triggers the next in a pipeline sequence

## Impact

- **Sync endpoint**: `src/routes/api/extension/sync.tsx` — add pipeline trigger after sync phases complete
- **Capabilities**: `src/lib/capabilities/` — new pipeline orchestrator module coordinating existing services (analysis, embedding, profiling, matching)
- **Jobs**: `src/lib/jobs/` — job chaining logic, new job types for each pipeline stage
- **Data layer**: Existing `src/lib/data/` modules (matching, song-audio-feature, etc.) already have the write operations; orchestrator calls them in sequence
- **API keys**: `GEMINI_API_KEY` (app-level env var) for song analysis; embedding provider auto-selects from available keys (`DEEPINFRA_API_KEY` or HuggingFace free tier fallback)
- **Cost**: Song analysis via LLM is the main cost, mitigated by 5-song batch cap. Audio features (ReccoBeats) and embeddings (HuggingFace) are free
