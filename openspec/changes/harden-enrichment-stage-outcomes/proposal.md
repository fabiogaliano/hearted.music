## Why

Enrichment stage outcome accounting is launch-critical because it controls provider retry behavior, permanent failure exclusion, billing compensation, content activation, and the match candidates that become visible to users. Today each stage owns its own partial accounting: readiness, success resolution, failure-row recording, suppression policy, and count summaries are spread across `src/lib/workflows/enrichment-pipeline/stages/*`, `record-failure.ts`, `failure-policy.ts`, and the content-analysis pipeline.

The current **Interface** is too shallow: stages mostly return counts, while the real behavior depends on side effects inside each stage. That creates prod-risk failure modes:

- a thrown stage handler can be summarized as one failed item instead of every attempted song;
- readiness failures can return failed counts without durable failure rows, allowing hot retry loops;
- content activation can swallow `markItemsNew` / unlock RPC failures even though activation is what makes analyzed songs visible;
- song analysis creates child `song_analysis` jobs inside the parent `enrichment` job, splitting one chunk's outcome across unrelated job rows;
- compensation logic for terminal analysis failures is coupled to one stage's implementation instead of the failure outcome seam.

This change deepens the enrichment stage outcome **Module** so each stage returns a structured outcome and one accounting seam applies failure policy, resolves prior suppression rows, updates progress counts, and triggers compensation.

## What Changes

- Introduce a typed `StageOutcome` / `StageFailure` model for enrichment stages.
- Add a stage-outcome accounting module that:
  - resolves prior non-terminal failures for successful song IDs;
  - records durable failure rows for failed song IDs;
  - applies centralized failure policy;
  - returns progress summaries from structured song IDs instead of ad-hoc counts;
  - triggers idempotent compensation for terminal analysis input failures.
- Replace generic `runStage(...): { total, succeeded, failed }` error handling with per-candidate failure expansion.
- Treat `content_activation` as an accounted enrichment stage with progress and retryable failures.
- Refactor song analysis so the enrichment worker uses the parent `enrichment` job for accounting instead of creating child `song_analysis` job rows.
- Fail the parent enrichment job attempt when stage accounting cannot persist durable rows or progress instead of returning success-shaped counts.
- Add focused tests for failure classification, progress counts, content activation failures, compensation, and thrown stage handlers.

## Pre-prod sequencing

This is a hardening refactor, not a product rewrite. Land it as a tracer-bullet seam first: add the outcome model, accounting finalizer, and thrown-stage tests before migrating stages one at a time. Keep the parent `enrichment` job as the only external settlement contract so this change can coordinate cleanly with `harden-job-work-orchestration`.

## Capabilities

### Modified Capabilities

- `background-enrichment-worker`: structured per-stage outcome accounting and parent-job-owned progress.
- `matching-pipeline`: candidate readiness and missing-prerequisite handling remain unchanged, but stage accounting now determines retry suppression and activation visibility through a deeper interface.

## Affected specs

- `openspec/specs/background-enrichment-worker/spec.md`
- `openspec/specs/matching-pipeline/spec.md`

## Impact

- **Runtime behavior:** Successful enrichment output should not change. Failure handling becomes more durable and retry-safe.
- **Data:** No planned schema changes. Existing `job_failure`, `item_status`, `job`, and `job_execution_measurement` tables are reused.
- **Files likely touched:**
  - `src/lib/workflows/enrichment-pipeline/orchestrator.ts`
  - `src/lib/workflows/enrichment-pipeline/types.ts`
  - `src/lib/workflows/enrichment-pipeline/progress.ts`
  - `src/lib/workflows/enrichment-pipeline/failure-policy.ts`
  - `src/lib/workflows/enrichment-pipeline/record-failure.ts`
  - `src/lib/workflows/enrichment-pipeline/stages/*`
  - `src/lib/domains/enrichment/content-analysis/pipeline.ts`
  - `src/lib/domains/enrichment/content-analysis/song-analysis.ts`
  - tests under `src/lib/workflows/enrichment-pipeline/__tests__/` and `src/lib/domains/enrichment/content-analysis/__tests__/`
- **Verification:** focused Vitest suites, `bun run typecheck`, then full `bun run test`.
