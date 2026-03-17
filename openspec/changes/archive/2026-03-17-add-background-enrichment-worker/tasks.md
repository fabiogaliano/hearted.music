## 1. Database queue and account state

- [x] 1.1 Add a Supabase migration via supabase cli in local, migrate up, under `supabase/migrations/` to add `enrichment` to `job_type`, add `job.heartbeat_at`, `job.attempts`, `job.max_attempts`, and add `user_preferences.enrichment_job_id`
- [x] 1.2 Add queue SQL helpers under `supabase/migrations/` for atomic claim and recovery (`claim_pending_enrichment_job()`, `sweep_stale_enrichment_jobs(...)`, `mark_dead_enrichment_jobs(...)`) plus worker polling indexes
- [x] 1.3 Regenerate `src/lib/data/database.types.ts` after the migration changes with script command "bun run gen:types"

## 2. Job data layer and progress models

- [x] 2.1 Extend `src/lib/platform/jobs/progress/types.ts` with a chunk-scoped enrichment progress shape that can represent stage status, aggregate counts, `batchSize`, and `batchSequence`
- [x] 2.2 Extend `src/lib/data/jobs.ts` with helpers for create-or-reuse enrichment jobs, active enrichment lookup, atomic claim RPC calls, heartbeat updates, and terminal job transitions
- [x] 2.3 Extend `src/lib/domains/library/accounts/preferences-queries.ts` with helpers to read, write, and clear `enrichment_job_id`
- [x] 2.4 Add a data-layer helper under `src/lib/data/` or `src/lib/workflows/enrichment-pipeline/` to record terminal per-song failures in `job_failure` and exclude them from future chunk selection

## 3. Worker runtime

- [x] 3.1 Create the worker runtime modules under `src/worker/` (`index.ts`, `config.ts`, `poll.ts`, `execute.ts`, `heartbeat.ts`, `sweep.ts`, `chain.ts`, `batch-size.ts`, `health.ts`)
- [x] 3.2 Add `Dockerfile.worker` to run the Bun worker through Coolify with the same repository and environment source as the web app
- [x] 3.3 Implement graceful shutdown and `/health` reporting in `src/worker/index.ts` and `src/worker/health.ts`, including stop-claiming behavior on termination, bounded draining of in-flight jobs, and safe stale-job recovery when shutdown interrupts active work

## 4. Pipeline refactor for worker-owned chunk jobs

- [x] 4.1 Refactor `src/lib/workflows/enrichment-pipeline/orchestrator.ts` so the worker path updates one parent chunk job instead of creating worker-path per-stage jobs
- [x] 4.2 Update `src/lib/workflows/enrichment-pipeline/batch.ts` to select only songs still needing enrichment and exclude terminally failed songs
- [x] 4.3 Update `src/lib/workflows/enrichment-pipeline/stages/*.ts` to report progress into the parent chunk job while preserving existing readiness/idempotency checks
- [x] 4.4 Ensure `playlist_profiling` and `matching` are attempted after every chunk and remain safe to rerun when cached or when prerequisites are missing
- [x] 4.5 Implement onboarding-first chunk progression and successor chunk chaining in `src/worker/batch-size.ts` and `src/worker/chain.ts`

## 5. Trigger integration and UI progress consumption

- [x] 5.1 Modify `src/routes/api/extension/sync.tsx` to create or reuse background `enrichment` jobs, stop calling inline `runSongEnrichment()`, and return `enrichmentJobId` alongside `phaseJobIds`
- [x] 5.2 Modify `src/lib/server/onboarding.functions.ts` to replace fire-and-forget destination work with create-or-reuse background enrichment job behavior
- [x] 5.3 Add a polling-based background progress consumer in `src/lib/hooks/useJobProgress.ts` or a sibling hook and wire onboarding/dashboard progress surfaces to use `enrichmentJobId` or persisted active job lookup
- [x] 5.4 Update `src/lib/domains/library/accounts/preferences-queries.ts` and related trigger paths so the active enrichment job pointer advances when successor chunks are chained and clears when the chain finishes

## 6. Provider rate limiting and worker observability

- [x] 6.1 Convert provider limiters in `src/lib/integrations/reccobeats/service.ts`, `src/lib/integrations/lastfm/service.ts`, `src/lib/domains/enrichment/lyrics/service.ts`, `src/lib/integrations/deepinfra/service.ts`, and `src/lib/integrations/llm/service.ts` to shared process-wide limiters where needed
- [x] 6.2 Add structured worker logging in `src/worker/*` for claims, stage transitions, chaining, failures, and stale-job sweeps
- [x] 6.3 Add simple operational read paths (queries, scripts, or protected server helpers) for active, failed, and dead-letter enrichment jobs using `src/lib/data/jobs.ts` and existing admin-safe data access patterns

## 7. Testing and verification

- [x] 7.1 Add unit tests for chunk sizing, active-chain dedupe, pointer advancement, heartbeat/sweep behavior, and background progress shape under `src/worker/__tests__/` and/or `src/lib/workflows/enrichment-pipeline/__tests__/`
- [x] 7.2 Add integration coverage for sync-triggered queueing, onboarding-triggered queue reuse, atomic claim behavior, and chunk continuation after simulated worker restart
- [ ] 7.3 Verify end-to-end in a dev/staging environment that sync returns `enrichmentJobId`, the worker claims jobs, progress is pollable, successor chunks interleave fairly, and stale jobs recover correctly
