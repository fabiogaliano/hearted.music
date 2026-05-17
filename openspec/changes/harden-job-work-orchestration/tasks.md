## 1. Tighten Semantic Change Constructors

- [x] 1.1 Add `src/lib/workflows/library-processing/changes/playlist-management.ts` for `playlist_management_session_flushed`.
- [x] 1.2 Audit production callers under `src/lib/server`, `src/routes`, `src/lib/domains/billing`, and `src/lib/workflows/library-processing/runner.ts`; migrate any inline library-processing change construction to `src/lib/workflows/library-processing/changes/*` modules.
- [x] 1.3 Update existing change factories to return exact `Extract<LibraryProcessingChange, { kind: ... }>` union members rather than broad intersections.
- [x] 1.4 Keep pure reconciler tests free to use object literals, but add one boundary test proving the playlist-management source emits the factory-shaped change.

## 2. Characterization Tests

- [x] 2.1 Add `src/worker/__tests__/sweep.test.ts` covering current sweep/dead-letter RPC calls after extracting the module seam.
- [x] 2.2 Extend `src/lib/workflows/library-processing/__tests__/runner.test.ts` to assert runner writes measurements before applying library-processing outcome changes.
- [x] 2.3 Add a regression test for a failed/dead-lettered active job ref: after recovery, `library_processing_state.enrichment.activeJobId` or `matchSnapshotRefresh.activeJobId` is cleared and `settledAt` remains stale.
- [x] 2.4 Add a regression test for completed active ref recovery using a measurement row to reconstruct `enrichment_completed` metadata.

## 3. Make Apply Outcomes Explicit

- [x] 3.1 Change `applyLibraryProcessingChange(...)` to return `Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>`.
- [x] 3.2 Define `LibraryProcessingApplyError` in `src/lib/workflows/library-processing/types.ts` or a sibling errors module; include load-state, persist-state, effect, and final-persist variants.
- [x] 3.3 Return effect results for successful `ensure_enrichment_job` and `ensure_match_snapshot_refresh_job` effects, including ensured job IDs.
- [x] 3.4 Update `/api/extension/sync` to return a 500 when sync persistence succeeded but library-processing apply failed, including `phaseJobIds` in the response body.
- [x] 3.5 Update onboarding, playlist management, billing, billing bridge, and runner call sites to handle `Result.isError(...)` explicitly instead of relying on thrown exceptions or logs.
- [x] 3.6 Update tests and mocks that currently expect `applyLibraryProcessingChange` to resolve `void`.

## 4. Deepen Library-Processing Scheduler (Deferred Cleanup)

- [x] 4.1 Create `src/lib/workflows/library-processing/scheduler.ts` and move effect execution from `src/lib/workflows/library-processing/service.ts`.
- [x] 4.2 Keep pure reconciliation in `reconciler.ts`; scheduler owns billing reads, queue-priority mapping, batch progress initialization, and `needsTargetSongEnrichment` derivation.
- [x] 4.3 Make scheduler effect failures return typed apply errors without mutating success-shaped active-job refs.
- [x] 4.4 Add scheduler tests for enrichment ensure, match snapshot refresh ensure, billing priority fallback, target-song enrichment hints, and ensure failure propagation.

## 5. Extract Worker Sweep Seam

- [x] 5.1 Create `src/worker/sweep.ts` and move the existing `runSweepTick()` implementation out of `src/worker/index.ts` without changing runtime behavior.
- [x] 5.2 Keep `src/worker/index.ts` responsible only for startup, timer wiring, health, polling, and shutdown.
- [x] 5.3 Add dependency-injected or mockable exports so tests can verify sweep, dead-letter, and recovery calls without starting the worker.

## 6. Add Dead-Letter Recovery

- [x] 6.1 Create `src/lib/workflows/library-processing/terminal-recovery.ts`.
- [x] 6.2 Implement `recoverDeadLetteredLibraryProcessingJob(job)` mapping `enrichment` to `EnrichmentChanges.stopped({ reason: "error" })` and `match_snapshot_refresh` to `MatchSnapshotChanges.failed(...)`.
- [x] 6.3 Call the recovery helper for every job returned by `markDeadLibraryProcessingJobs(...)` in `src/worker/sweep.ts`.
- [x] 6.4 Add tests proving dead-letter recovery clears the matching active-job ref and does not immediately ensure another job in the same apply cycle.
- [x] 6.5 Log structured recovery failures without stopping recovery for later dead-lettered jobs in the same sweep tick.

## 7. Add Terminal Active-Ref Recovery

- [x] 7.1 Add a query helper that finds `library_processing_state` rows whose active job refs point at terminal `job` rows.
- [x] 7.2 Add `getLatestExecutionMeasurementForJob(jobId)` to `src/lib/data/job-measurements.ts` or the new measurement repository module.
- [x] 7.3 Implement `recoverTerminalLibraryProcessingRefs()`:
  - failed enrichment -> `EnrichmentChanges.stopped({ reason: "error" })`;
  - failed refresh -> `MatchSnapshotChanges.failed(...)`;
  - completed enrichment with valid measurement details -> `EnrichmentChanges.completed(...)`;
  - completed refresh with valid measurement details -> `MatchSnapshotChanges.published(...)`;
  - completed job without reconstructable details -> conservative failure recovery that clears the ref and leaves the workflow stale.
- [x] 7.4 Validate measurement details before reconstructing completed changes; missing or invalid details must not produce success-shaped settlement.
- [x] 7.5 Run terminal-ref recovery after the startup sweep and after every dead-letter pass.
- [x] 7.6 Add tests for failed refs, completed refs with measurement details, completed refs with missing details, and apply failure logging.

## 8. Harden Runner Settlement

- [x] 8.1 Update `src/lib/workflows/library-processing/runner.ts` so library-processing settlement is retried locally with the existing DB retry policy.
- [x] 8.2 Extend `RunJobOutcome` with settlement status (`settled` / `settlement_failed`) without changing successful workflow result payloads.
- [x] 8.3 Ensure failed settlement logs include `jobId`, `accountId`, `workflow`, `changeKind`, and the structured apply error.
- [x] 8.4 Add runner tests for settlement success, settlement retry success, settlement retry exhaustion, and failure-path settlement errors.

## 9. Split Job Modules by Role (Deferred Cleanup)

- [x] 9.1 Create `src/lib/platform/jobs/repository.ts` with raw job row operations from `src/lib/data/jobs.ts`: `getJobById`, `getActiveJob`, `getLatestJob`, `getJobs`, `createJob`, `updateJobProgress`, `markJobRunning`, `markJobCompleted`, `markJobFailed`, `updateHeartbeat`.
- [x] 9.2 Move sync-specific helpers (`getLastCompletedSync`, sync phase creation if retained) into `src/lib/platform/jobs/sync-phase-jobs.ts` or the existing `src/lib/workflows/spotify-sync/*` modules.
- [x] 9.3 Create `src/lib/platform/jobs/library-processing-queue.ts` for existing library-processing queue helpers: `ensureEnrichmentJob`, `ensureMatchSnapshotRefreshJob`, `claimLibraryProcessingJob`, `sweepStaleLibraryProcessingJobs`, and `markDeadLibraryProcessingJobs`.
- [x] 9.4 Create `src/lib/platform/jobs/walkthrough-preview-queue.ts` for walkthrough preview ensure/claim/sweep/dead-letter helpers.
- [x] 9.5 Update imports across `src/lib`, `src/routes`, `src/worker`, and tests. Do not add barrel exports.
- [x] 9.6 Delete `src/lib/data/jobs.ts` once all consumers are migrated, or leave it out of the final branch if any wrapper would only re-export moved functions.

## 10. Verification

- [x] 10.1 Run focused tests: `bun run test src/lib/workflows/library-processing src/worker`.
- [x] 10.2 Run `bun run typecheck`.
- [x] 10.3 Run full `bun run test`. (1 unrelated failure: SyncingStep.test.tsx UI rendering — not touched by this change)
- [x] 10.4 Grep for remaining imports from `@/lib/data/jobs`; ensure none remain unless the final branch intentionally keeps a non-wrapper module.
- [x] 10.5 Grep production code for inline `LibraryProcessingChange` object literals; ensure source boundaries use `src/lib/workflows/library-processing/changes/*`.
- [x] 10.6 Run `openspec validate harden-job-work-orchestration --strict --no-interactive` and `openspec validate harden-enrichment-stage-outcomes --strict --no-interactive`.
- [ ] 10.7 Manually inspect worker startup logs in dev with one pending job and one artificially failed active ref.
