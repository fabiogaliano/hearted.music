## Why

Job work orchestration is launch-critical: extension sync, onboarding target selection, enrichment chunks, match snapshot refresh, and walkthrough previews all depend on durable `job` rows and `library_processing_state` active-job references. Today the job **Module** is shallow: `src/lib/data/jobs.ts` mixes raw row access, progress serialization, queue RPCs, workflow-specific `ensure*` logic, heartbeat updates, and walkthrough preview helpers behind one broad **Interface**.

That shape is more than cleanup friction. It leaves prod-risk failure modes hard to test through one seam:

- dead-lettered `enrichment` / `match_snapshot_refresh` jobs can leave `library_processing_state.*.activeJobId` pointing at terminal jobs, preventing re-ensure while the workflow remains stale;
- worker sweep/dead-letter logic lives inline in `src/worker/index.ts` and has no focused tests;
- `applyLibraryProcessingChange(...)` currently logs and returns `void`, so source seams can report success even when scheduling or active-job persistence failed;
- runner settlement failures are logged but not made explicit as values, making recovery paths hard to verify.

This change deepens job work orchestration before prod: job-family behavior gets role-specific modules, library-processing state repair becomes explicit, semantic change constructors become the source-boundary API, and tests exercise the same **Interface** that production callers use.

## What Changes

- Split the shallow job data module into role-specific modules:
  - raw job row operations and progress persistence;
  - library-processing queue claim/sweep/dead-letter operations;
  - walkthrough-preview queue operations;
  - sync-phase job helpers;
  - library-processing job scheduling / effect execution.
- Change `applyLibraryProcessingChange(...)` to return a typed `Result` outcome instead of swallowing expected DB/scheduling failures.
- Promote `src/lib/workflows/library-processing/changes/*` as the canonical semantic change-constructor seam for production source boundaries and recovery code.
- Extract worker sweep/dead-letter orchestration into a testable module.
- Apply library-processing recovery changes when stale jobs are dead-lettered, so active job refs are cleared and stale workflows can be retried intentionally.
- Add startup/sweep recovery for terminal active-job references that already exist in `library_processing_state`.
- Add characterization and regression tests for claim/sweep/dead-letter, active-ref repair, effect execution, and runner settlement.
- Keep database schema and queue RPC names unchanged unless tests expose a missing query needed for recovery.

## Capabilities

### Modified Capabilities

- `background-enrichment-worker`: worker claim/sweep/dead-letter and terminal active-ref recovery semantics.
- `library-processing`: durable active-job reference handling and explicit apply outcomes.

## Affected specs

- `openspec/specs/background-enrichment-worker/spec.md`
- `openspec/specs/library-processing/spec.md`

## Impact

- **Runtime behavior:** No change to successful job execution. Failed/dead-lettered jobs will no longer silently wedge the control plane.
- **Data:** No planned schema changes. May add read helpers against existing `job`, `library_processing_state`, and `job_execution_measurement` tables.
- **Files likely touched:**
  - `src/lib/data/jobs.ts`
  - `src/lib/data/job-measurements.ts`
  - `src/lib/platform/jobs/*`
  - `src/lib/workflows/library-processing/*`
  - `src/lib/workflows/library-processing/changes/*`
  - `src/worker/index.ts`
  - `src/worker/poll.ts`
  - `src/worker/poll-walkthrough-preview.ts`
  - tests under `src/lib/workflows/library-processing/__tests__/`, `src/lib/platform/jobs/**/__tests__/`, and `src/worker/**/__tests__/`
- **Verification:** `bun run test` for focused suites first, then `bun run typecheck` and the full `bun run test`.
