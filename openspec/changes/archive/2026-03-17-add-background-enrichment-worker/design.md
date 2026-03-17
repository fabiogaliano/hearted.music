## Context

The current enrichment flow is split across two request-bound paths:

- `src/routes/api/extension/sync.tsx` persists extension data, creates sync-phase jobs, then calls `runSongEnrichment(accountId)` inline before returning
- `src/lib/server/onboarding.functions.ts` saves destination playlists, then starts `runDestinationProfiling()` and `runMatching()` inside a fire-and-forget async closure

That design depends on Cloudflare Worker request lifetime and in-memory SSE. It works for small batches, but it is a poor fit for libraries that can take tens of minutes to process because:

- work can be lost when request-scoped execution is terminated
- sync responses stay coupled to long-running enrichment behavior
- cross-process progress cannot be surfaced through the current in-memory SSE emitter
- one large sync can monopolize execution unless enrichment is broken into durable queue units

The codebase already has several pieces that make a low-complexity queue architecture viable:

- `job` table and job lifecycle helpers in `src/lib/data/jobs.ts` and `src/lib/platform/jobs/lifecycle.ts`
- idempotent stage-level readiness filtering under `src/lib/workflows/enrichment-pipeline/*`
- `job_failure` table for per-item failure visibility
- account-scoped persisted job metadata via `src/lib/domains/library/accounts/preferences-queries.ts`

Operational constraints for this design:

- background execution must run on the existing VPS through Coolify + Docker
- the app should avoid introducing a second queueing platform for a 10-50 user product
- the worker must tolerate long-running libraries but still surface an early onboarding result quickly
- the confirmed host has enough headroom for conservative parallelism, but provider rate limits remain the dominant constraint

## Goals / Non-Goals

**Goals:**
- move enrichment execution out of request lifetime while keeping sync phases 1-3 inline
- use the existing Supabase `job` table as a durable queue for background enrichment
- process libraries in fair, interleaved chunks with onboarding-first progression `1 → 5 → 10 → 25 → 50`, then `50`
- preserve stage idempotency so retries and reruns skip already-completed work safely
- provide cross-process progress visibility by polling persisted job state instead of using in-memory realtime primitives
- make worker recovery explicit with atomic claims, heartbeats, stale sweeps, bounded retries, and health checks
- avoid duplicate enrichment chains per account when sync and onboarding triggers overlap

**Non-Goals:**
- moving extension fetch/persistence phases (liked songs, playlists, playlist tracks) out of `POST /api/extension/sync`
- introducing Cloudflare Queues, SQS, Redis, or a separate queue service
- redesigning the matching algorithm, playlist profiling math, or analysis output contracts
- replacing the existing SSE path for request-local sync phase progress
- delivering chain-level whole-library aggregate progress in v1; the persisted progress contract is chunk-scoped

## Decisions

### 1. Use the Supabase `job` table as the durable queue

**Decision:** Add a first-class `enrichment` job type to the existing `job` table and extend the table with worker metadata needed for safe background execution: `heartbeat_at`, `attempts`, and `max_attempts`. Queue claiming and stale-job recovery will be implemented as SQL functions called via Supabase RPC from the worker.

**Why:** The app already stores jobs durably in Postgres and already uses service-role access plus job lifecycle helpers. Reusing that table avoids a second durability layer while still giving the worker restart-safe work discovery.

**Alternatives considered:**
- **Cloudflare Queues / SQS**: more durable queue semantics out of the box, but unnecessary operational surface area for this scale
- **Direct HTTP from Cloudflare to VPS**: simplest request handoff, but loses work if the VPS is unavailable at request time
- **pg_cron / Edge Function triggers**: serverless-friendly, but constrained by function execution limits and less suitable for hour-scale libraries

### 2. Keep the worker in the same repo under `src/worker/*` and deploy via Coolify Docker

**Decision:** Add a separate Bun entry point under `src/worker/` and deploy it with `Dockerfile.worker` through Coolify on the existing VPS. The worker exposes `GET /health` on a dedicated port for container health checks.

**Why:** The worker reuses existing data access, pipeline code, and environment setup. Same-repo deployment minimizes drift and avoids maintaining a second package for a tightly coupled internal runtime.

**Alternatives considered:**
- **Separate repo/package**: cleaner isolation, but higher operational overhead and more duplication for a small product
- **systemd/pm2 directly on host**: workable, but Coolify already provides restarts, environment management, and Docker-based deploy workflows

### 3. Use one queued job per chunk, with one active enrichment chain per account

**Decision:** Each queued `enrichment` row represents one chunk of work. The worker processes a single chunk, then enqueues the next chunk at the tail of the queue when more unenriched songs remain. The system enforces at most one pending/running enrichment chain per account; triggers reuse the existing active job rather than enqueueing duplicates.

**Why:** Chunk jobs give fair interleaving across users. A single huge job is simpler, but a 2,000-song initial sync would monopolize the worker. One job per song is too noisy and too expensive in coordination overhead.

**Chunk sizing:**
- onboarding progression: `1 → 5 → 10 → 25 → 50`
- steady state: `50`
- initial worker concurrency: `2`

**Alternatives considered:**
- **One monolithic job per account**: simplest recovery model, but poor fairness and weaker UX for users arriving after a large sync begins
- **One job per song**: maximum granularity, but too many rows and too much orchestration complexity for this product

### 4. Persist the current background job pointer per account

**Decision:** Add `user_preferences.enrichment_job_id` as the persisted pointer to the current active chunk job for the account. `POST /api/extension/sync` returns `enrichmentJobId` in its response, and the worker updates the persisted pointer when it chains the next chunk. The pointer is cleared when the chain finishes with no more pending/running enrichment jobs.

**Why:** Chunk chaining changes job IDs over time. Persisting the current active chunk ID gives the UI a stable account-level lookup path without needing a separate root/child queue model in v1.

**Trade-off:** The progress contract remains chunk-scoped rather than whole-library aggregate progress. That is acceptable for v1 because the UI can continue from the latest active chunk after each terminal transition.

**Alternatives considered:**
- **Single root job plus child chunk jobs**: better aggregate progress semantics, but more schema and state-management complexity than needed now
- **Response-only job IDs**: insufficient once successor chunks are chained asynchronously

### 5. Refactor the worker path to use one parent chunk job with stage progress in `job.progress`

**Decision:** Background enrichment will stop using the existing per-stage tracked job pattern for the worker path. Instead, the worker-owned chunk job stores stage-level status and counts inside `job.progress`, including:

- aggregate counts: `total`, `done`, `succeeded`, `failed`
- current stage name
- per-stage status and counts
- `batchSize`
- `batchSequence`

The worker still invokes the existing enrichment stages under `src/lib/workflows/enrichment-pipeline/*`, but those stages will report progress back to the parent chunk job instead of creating their own standalone job rows for the background path.

**Why:** A parent chunk job is the smallest cross-process progress unit that matches the queue architecture. Reusing stage-owned SSE jobs would create redundant background rows and produce the wrong UI abstraction for chunked worker execution.

**Stage execution model:**
- each chunk attempts all enrichment stages: `audio_features`, `genre_tagging`, `song_analysis`, `song_embedding`, `playlist_profiling`, `matching`
- profiling + matching run after every chunk for better onboarding UX
- existing stage-specific readiness filters remain authoritative for idempotency

**Alternatives considered:**
- **Keep existing per-stage jobs**: lower refactor cost, but weaker queue-level visibility and more internal job churn
- **Inline “fast” stages, worker-only slow stages**: reduces worker time per chunk, but reintroduces request-bound fragility and mixed execution semantics

### 6. Background progress uses polling; SSE remains request-local

**Decision:** Background enrichment progress is read from persisted job state by polling the `job` row identified by `enrichmentJobId` or the latest active account pointer. The existing SSE endpoint at `src/routes/api/jobs/$id/progress.tsx` remains for in-process sync-phase jobs created during `POST /api/extension/sync`.

**Why:** The worker runs in a different process on the VPS. Polling the database is portable, cheap at this scale, and does not depend on Supabase Realtime or a cross-process event bus.

**Alternatives considered:**
- **Supabase Realtime**: feasible, but unnecessary vendor-specific complexity and message accounting for this scale
- **SSE streamed directly from the VPS worker**: possible, but would require new auth, routing, and connection handling rather than reusing persisted state

### 7. Queue safety uses atomic claim + heartbeat + stale sweep

**Decision:** The worker uses SQL functions that claim jobs atomically with `FOR UPDATE SKIP LOCKED`, updates `heartbeat_at` while a job is running, and periodically sweeps stale running jobs back to `pending` or permanently `failed` once `max_attempts` is exhausted.

**Why:** This gives safe multi-worker semantics, restart recovery, and bounded retry behavior while preserving a simple operational model.

**Proposed SQL helpers:**
- `claim_pending_enrichment_job()`
- `sweep_stale_enrichment_jobs(stale_threshold)`
- `mark_dead_enrichment_jobs(stale_threshold)`

### 8. Terminal per-song failures use existing `job_failure` infrastructure

**Decision:** The worker records item-level failures into `job_failure`. Errors classified as terminal for automatic retries (for example validation/unsupported/auth-related song failures) are excluded from future chunk selection until manually retried or cleared.

**Why:** The schema already has `job_failure`, so v1 can reuse existing failure visibility instead of adding a dedicated song-failure table. This keeps the design smaller while still preventing obviously doomed songs from being retried forever.

**Alternatives considered:**
- **Retry every failure forever**: simplest, but wastes API budget and creates noisy reruns
- **Add a new per-song failure state table**: cleaner long-term model, but not necessary for the first background-worker version

### 9. Provider rate limiting must be shared across concurrent jobs

**Decision:** The worker uses process-wide singleton limiters per external provider. Implementations may either move limiter instances to module scope in existing service files or centralize them in a shared worker-facing module that is injected into provider factories.

**Primary files affected:**
- `src/lib/integrations/reccobeats/service.ts`
- `src/lib/integrations/lastfm/service.ts`
- `src/lib/domains/enrichment/lyrics/service.ts`
- `src/lib/integrations/deepinfra/service.ts`
- `src/lib/integrations/llm/service.ts`

**Why:** Per-instance limiters multiply request concurrency when multiple worker jobs run in the same Bun process. A shared limiter per provider keeps the configured request envelope true regardless of worker concurrency.

## Risks / Trade-offs

- **[Chunk-scoped progress can jump between job IDs]** → Persist `user_preferences.enrichment_job_id`, update it when chaining successor chunks, and have UI refresh the pointer when a chunk reaches a terminal state
- **[Profiling + matching after every chunk can repeat work]** → rely on existing playlist-profile caching and match-context hashing to make unchanged reruns cheap; move to final-chunk-only later if measurement proves it necessary
- **[External API limits remain the dominant bottleneck]** → start at worker concurrency `2`, share provider limiters across jobs, and keep concurrency configurable through worker env vars
- **[Worker crashes mid-job]** → use heartbeat + stale sweep recovery and preserve stage-level idempotency so reruns skip completed outputs
- **[Terminal failure exclusion may need manual cleanup]** → restrict exclusion to clearly non-retryable error classes and provide a manual/admin reset path later if a previously terminal song should be retried
- **[Large libraries still take a long time]** → request lifetime is no longer the limiter, and onboarding-first chunk progression surfaces the first result quickly even when the full library will take much longer

## Migration Plan

1. Add an additive Supabase migration for:
   - `job_type = 'enrichment'`
   - `job.heartbeat_at`, `job.attempts`, `job.max_attempts`
   - worker claim/sweep SQL functions
   - `user_preferences.enrichment_job_id`
2. Regenerate `src/lib/data/database.types.ts`
3. Deploy the worker container through Coolify and verify `/health` plus idle polling before any trigger path enqueues real work
4. Refactor the enrichment worker path and queue helpers while keeping schema changes backward compatible
5. Cut over `src/routes/api/extension/sync.tsx` from inline `runSongEnrichment()` to create/reuse queue jobs and return `enrichmentJobId`
6. Cut over `src/lib/server/onboarding.functions.ts` from fire-and-forget destination work to create/reuse queue jobs
7. Validate end-to-end on a dev/staging account: sync → chunk claim → progress polling → auto-chaining → completion → pointer clear

**Rollback:**
- revert the sync and onboarding trigger changes so no new background enrichment jobs are created
- leave the worker deployed but idle, or scale it down in Coolify
- keep additive schema changes in place; they are safe to leave unused during rollback

## Open Questions

None blocking for this change.

Known future refinement: if whole-library aggregate progress becomes important, the queue model can evolve from a current-chunk pointer to a root-job/child-job model without replacing the worker architecture.
