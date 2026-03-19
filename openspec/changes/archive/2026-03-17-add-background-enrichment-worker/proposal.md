## Why

The current enrichment flow still depends on request lifetime: `POST /api/extension/sync` runs song-side enrichment inline, while onboarding kicks destination work off with fire-and-forget async work. That makes large-library processing fragile on Cloudflare Workers, risks lost work on request teardown, and prevents a durable progress model for libraries that can take tens of minutes to process.

For hearted.'s expected scale, a VPS-hosted Bun worker backed by the existing Supabase `job` table gives the app durable background execution, fair interleaving across users, and cross-process progress visibility without introducing a separate managed queue.

## What Changes

- Introduce a VPS-hosted Bun background worker that claims `enrichment` jobs from Supabase and executes all enrichment stages (`audio_features`, `genre_tagging`, `song_analysis`, `song_embedding`, `playlist_profiling`, `matching`) outside the request lifecycle
- Change sync and onboarding follow-on work to create or reuse an active background enrichment job instead of running inline or fire-and-forget request-bound work
- Process enrichment as chunked jobs with onboarding-first batch progression `1 → 5 → 10 → 25 → 50`, then steady-state `50`, with FIFO auto-chaining so large libraries interleave fairly with newer jobs from other accounts
- Persist chunk-scoped stage progress, retry state, and recovery metadata on the `job` row so the web app can poll background progress from the database without depending on Supabase Realtime or in-memory SSE
- Add queue safety and operational hardening: atomic job claiming, heartbeat + stale sweep recovery, one active enrichment chain per account, process-wide singleton provider limiters, terminal per-song failure exclusion, Docker/Coolify deployment, and worker health checks
- Keep sync phases 1-3 request-local and extension-driven; only the durable enrichment follow-on work moves to the worker

## Affected specs

- `background-enrichment-worker`
- `extension-data-pipeline`
- `data-flow`
- `onboarding`

## Capabilities

### New Capabilities
- `background-enrichment-worker`: Durable, chunked background enrichment execution using the Supabase `job` table as a queue and a Bun worker on the VPS

### Modified Capabilities
- `extension-data-pipeline`: Extension sync persists Spotify data, creates or reuses a background enrichment job, and returns the enrichment job identifier instead of running inline follow-on enrichment
- `data-flow`: Cross-process background enrichment progress is read from persisted job state by polling, while request-local sync phases continue to use SSE
- `onboarding`: Destination playlist save creates or reuses background enrichment follow-on work without blocking the save response

## Impact

- **Database**: `supabase/migrations/` plus regenerated `src/lib/data/database.types.ts` for `job_type = 'enrichment'`, worker recovery columns, queue SQL helpers, and persisted account-level enrichment job tracking
- **Worker runtime**: new `src/worker/*` entry point modules plus `Dockerfile.worker` for Bun + Coolify deployment
- **Data layer**: `src/lib/data/jobs.ts`, `src/lib/platform/jobs/progress/types.ts`, and `src/lib/domains/library/accounts/preferences-queries.ts` for background job creation/reuse, chunk progress, and active enrichment job lookup
- **Trigger boundaries**: `src/routes/api/extension/sync.tsx` and `src/lib/server/onboarding.functions.ts` for queue-based follow-on work instead of inline/fire-and-forget enrichment
- **Pipeline execution**: `src/lib/workflows/enrichment-pipeline/*` for chunk selection, terminal failure exclusion, and parent-job progress reporting from the worker path
- **External API safety**: provider integrations under `src/lib/integrations/` and `src/lib/domains/enrichment/` for process-wide singleton rate limiters across concurrent worker jobs
- **UI progress consumption**: polling-based consumers built on top of existing job state, alongside the existing SSE path for sync-phase jobs
