## Context

Current job orchestration is spread across a few large seams:

- `src/lib/data/jobs.ts` contains generic job reads/writes, progress JSON conversion, sync helper creation, library-processing `ensure*` helpers, walkthrough-preview `ensure*` and claim helpers, library-processing claim/sweep/dead-letter RPC wrappers, heartbeat updates, and active-job reads.
- `src/lib/platform/jobs/lifecycle.ts` wraps a few state transitions with retry, but still imports the broad `jobs.ts` module.
- `src/lib/workflows/library-processing/service.ts` owns reconciliation, effect execution, queue priority resolution, billing reads, target-song enrichment hint derivation, and active-job persistence.
- `src/worker/index.ts` owns sweep/dead-letter orchestration inline.
- `src/lib/workflows/library-processing/runner.ts` marks jobs terminal, records execution measurement rows, then applies library-processing outcome changes; settlement failures are logged but not represented in the outcome.
- `src/lib/workflows/library-processing/changes/*` already contains semantic change constructors for most boundaries, but production callers are not uniformly forced through that seam and playlist-management changes still use an object literal.

Relevant current tests:

- `src/lib/workflows/library-processing/__tests__/reconciler.test.ts` covers pure requested/settled reconciliation.
- `src/lib/workflows/library-processing/__tests__/runner.test.ts` covers basic dispatch and terminal marking.
- There is no focused test seam for worker sweep/dead-letter recovery or for repairing stale `activeJobId` references.

## Goals / Non-Goals

**Goals:**

- Deepen job orchestration modules around actual seams: raw job row access, queue claim/recovery, sync-phase jobs, library-processing scheduling, and runner settlement.
- Make expected scheduling and settlement failures explicit with typed `Result` values.
- Ensure dead-lettered library-processing jobs cannot leave `library_processing_state` wedged with terminal `activeJobId` references.
- Add tests that exercise production interfaces, not private implementation details.
- Make `src/lib/workflows/library-processing/changes/*` the canonical production boundary for constructing semantic changes, including worker recovery changes.
- Preserve successful runtime behavior and existing database RPC names.

**Non-Goals:**

- Replacing Supabase claim/sweep RPCs with a new queue technology.
- Changing job enum values or introducing a new job table.
- Redesigning enrichment or match snapshot algorithms.
- Changing UI polling behavior beyond making existing active-job reads accurate after recovery.
- Moving unrelated data modules out of `src/lib/data` in this change.

## Decisions

### 1. Library-processing change constructors are the source-boundary interface

**Decision:** Treat `src/lib/workflows/library-processing/changes/*` as the canonical factory seam for production `LibraryProcessingChange` values.

Rules:

- Existing sync, onboarding, billing, enrichment, and match-snapshot factories stay in their domain-named files.
- Add a missing playlist-management factory instead of constructing `playlist_management_session_flushed` inline at the server boundary.
- Terminal recovery must emit `EnrichmentChanges` and `MatchSnapshotChanges` so normal runner outcomes and recovery outcomes cannot drift.
- Factories should return exact extracted union members, e.g. `Extract<LibraryProcessingChange, { kind: "enrichment_completed" }>`, so future required fields fail at the constructor seam.
- Production call sites use factories; pure reconciler tests may keep object literals when that makes state-machine examples clearer.

**Rationale:** The change constructors are the language of the control plane. Keeping all production source boundaries on that seam makes the later `Result` return and recovery work easier to audit.

### 2. Split job modules by role, not by table

**Decision:** Replace the broad `src/lib/data/jobs.ts` **Interface** with role-specific modules. By the end of this change, production callers should import from the role module they actually need; `src/lib/data/jobs.ts` should be deleted or reduced only if all consumers are migrated in the same branch.

Planned target modules:

| Target module | Owns | Primary callers |
| --- | --- | --- |
| `src/lib/platform/jobs/repository.ts` | Raw `job` row reads/writes: `getJobById`, `getActiveJob`, `getLatestJob`, `getJobs`, `createJob`, `updateJobProgress`, `markJobRunning`, `markJobCompleted`, `markJobFailed`, `updateHeartbeat` | lifecycle, server read models, runners |
| `src/lib/platform/jobs/sync-phase-jobs.ts` | Sync phase job creation and phase lifecycle helpers that are not worker-claimed | `/api/extension/sync`, `spotify-sync` helpers |
| `src/lib/platform/jobs/library-processing-queue.ts` | Library-processing claim, sweep, dead-letter RPC wrappers and job-family type guards | worker polling, sweep/recovery |
| `src/lib/platform/jobs/walkthrough-preview-queue.ts` | Walkthrough preview claim/sweep/dead-letter/ensure wrappers | walkthrough preview ensure + polling |
| `src/lib/workflows/library-processing/scheduler.ts` | Effect execution for `ensure_enrichment_job` / `ensure_match_snapshot_refresh_job`, queue priority, progress initialization | `applyLibraryProcessingChange` |
| `src/lib/workflows/library-processing/terminal-recovery.ts` | Mapping terminal/dead-lettered jobs back into library-processing state repair changes | worker sweep/startup recovery |
| `src/worker/sweep.ts` | Orchestrates sweep/dead-letter/recovery ticks for worker startup and intervals | `src/worker/index.ts`, tests |

**Rationale:** Each new **Interface** hides more behavior with less caller knowledge. Callers that only need heartbeat updates should not need to know about match snapshot progress JSON, preview job uniqueness, or library-processing queue priority.

**Alternative considered:** Keep `src/lib/data/jobs.ts` and add tests around it. Rejected because the deletion test fails: deleting it would scatter complexity across many callers, but keeping it also forces every caller to learn unrelated job-family rules.

### 3. `applyLibraryProcessingChange` returns a typed Result outcome

**Decision:** Change `applyLibraryProcessingChange(change)` from `Promise<void>` to `Promise<Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>>`.

Proposed outcome shape:

```ts
export type LibraryProcessingApplyOutcome = {
  accountId: string;
  changeKind: LibraryProcessingChange["kind"];
  state: LibraryProcessingState;
  effects: LibraryProcessingEffect[];
  effectResults: LibraryProcessingEffectResult[];
};

export type LibraryProcessingEffectResult =
  | { kind: "ensure_enrichment_job"; status: "ensured"; jobId: string }
  | { kind: "ensure_match_snapshot_refresh_job"; status: "ensured"; jobId: string }
  | { kind: LibraryProcessingEffect["kind"]; status: "failed"; error: LibraryProcessingApplyError };
```

`LibraryProcessingApplyError` should be a discriminated union over load-state, persist-state, read-billing, ensure-job, and final-persist failures. Use existing `DbError` values inside the tagged error rather than replacing them with strings.

**Caller behavior:**

- `/api/extension/sync`: if sync persistence succeeded but library-processing apply fails, return a 500 with phase job IDs and a clear message because no enrichment/refresh work may be scheduled.
- Onboarding target save and billing unlock paths: return existing user-facing success only when the source mutation succeeded; log and report a structured apply failure. These paths can be made stricter later if product wants blocking semantics.
- Worker runner and sweep recovery: treat apply failure as settlement failure and surface it in `RunJobOutcome` / logs.

**Rationale:** Expected scheduling failures are values. The current `void` **Interface** forces production callers and tests to infer success from logs.

### 4. Dead-lettered library-processing jobs clear active refs through normal changes

**Decision:** When `markDeadLibraryProcessingJobs(...)` returns jobs, `src/worker/sweep.ts` SHALL map each returned job to the existing worker outcome change and apply it:

- `type = "enrichment"` -> `EnrichmentChanges.stopped({ reason: "error" })`
- `type = "match_snapshot_refresh"` -> `MatchSnapshotChanges.failed(...)`

The recovery change clears `activeJobId`, leaves `settledAt` unchanged, and does not immediately auto-reensure in that apply cycle. Future source changes or explicit retry tooling can re-ensure.

**Rationale:** Dead-lettering is a terminal worker outcome. Treating it like a silent DB status update leaves the library-processing **Implementation** and state table disagreeing.

**Alternative considered:** Have the SQL dead-letter RPC update `library_processing_state` directly. Rejected because it would duplicate reconciler policy in SQL and bypass the TypeScript **Interface** that tests already exercise.

### 5. Startup/sweep recovery repairs terminal active-job references

**Decision:** Add `recoverTerminalLibraryProcessingRefs()` and run it after the startup sweep and after each dead-letter pass.

Recovery behavior:

1. Find `library_processing_state` rows whose enrichment or matchSnapshotRefresh `activeJobId` points at a terminal `job` row (`completed` or `failed`).
2. For failed jobs, apply the same failure changes as dead-letter recovery.
3. For completed enrichment jobs, read the latest `job_execution_measurement` details for that job and reconstruct `requestSatisfied` / `newCandidatesAvailable`; if details are missing or invalid, clear the active ref by applying a conservative recovery failure change that leaves the workflow stale.
4. For completed match snapshot refresh jobs, apply `match_snapshot_published` when measurement details can confirm a completed refresh; otherwise apply the conservative failure change.

Add a read helper such as `getLatestExecutionMeasurementForJob(jobId)` in the job-measurement module only if needed by this recovery path.

**Rationale:** Runner settlement should normally handle completed jobs. Recovery exists for crash-after-terminal-marking and settlement-failure cases. Conservative fallback favors duplicate safe work over a wedged account.

### 6. Runner settlement failures are explicit and retried locally

**Decision:** `runClaimedJob(...)` should keep the current order of work execution -> terminal job update -> measurement write -> library-processing apply, but should:

- retry library-processing apply with the same retry policy used for DB lifecycle operations;
- include settlement status in `RunJobOutcome`;
- log structured settlement failures with `jobId`, `accountId`, `workflow`, and `changeKind`;
- rely on `recoverTerminalLibraryProcessingRefs()` for durable repair if local retry still fails.

**Rationale:** Marking terminal before settlement is acceptable because recovery can reconstruct from the terminal job + measurement row. Retrying inline improves locality for transient DB failures.

### 7. Worker sweep is a testable module

**Decision:** Extract `runSweepTick()` and its dependencies from `src/worker/index.ts` into `src/worker/sweep.ts`. `index.ts` should only wire startup, timers, polling, health, and shutdown.

**Rationale:** Sweep/dead-letter is prod-critical and currently only reachable by starting the worker. A module seam lets tests verify dead-letter recovery without process-level harnessing.

## Migration Plan

1. Tighten the source-change constructor seam under `src/lib/workflows/library-processing/changes/*` and migrate production object-literal emitters.
2. Add characterization tests for current runner, reconciler, and source-boundary behavior that must not regress.
3. Change `applyLibraryProcessingChange` to return `Result` and update call sites while behavior is still localized.
4. Extract library-processing scheduler/effect execution from `service.ts` into `scheduler.ts` with tests.
5. Extract `src/worker/sweep.ts` with no behavior change; test sweep/dead-letter calls with mocks.
6. Add dead-letter recovery mapping and tests through the normal change constructors.
7. Add terminal active-ref recovery and measurement read helper if needed.
8. Harden runner settlement with local retry and explicit settlement status.
9. Split raw job repository and queue modules from `src/lib/data/jobs.ts`; update imports in small batches after the behavioral seams are covered.
10. Remove the old `src/lib/data/jobs.ts` module if no consumers remain; otherwise leave a TODO-free final migration task in the change branch only, not in main.
11. Run focused tests, `bun run typecheck`, then full `bun run test`.

## Rollback

This is behavior-preserving except for stricter failure reporting and recovery. If the split becomes noisy, keep the recovery behavior and `Result` return first, then defer module movement. No data rollback is expected because no schema migration is planned.
