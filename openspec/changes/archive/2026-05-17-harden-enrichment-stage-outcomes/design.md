## Context

Current enrichment execution flows through `src/lib/workflows/enrichment-pipeline/orchestrator.ts`:

1. select a billing-aware work plan;
2. run `audio_features` and `genre_tagging` in parallel;
3. run `song_analysis`;
4. run `song_embedding`;
5. run `content_activation` as a side effect after embedding;
6. persist aggregate job progress.

Stage modules currently return `{ total, succeeded, failed }` and perform side effects internally:

- `stages/audio-features.ts` resolves prior failures and records provider failures directly.
- `stages/genre-tagging.ts` resolves prior failures and records provider failures directly.
- `stages/song-analysis.ts` records several analysis failure codes, grants replacement credits, and resolves prior failures.
- `stages/song-embedding.ts` records embedding failures directly.
- `stages/content-activation.ts` writes `item_status` / unlock rows but does not return an outcome and does not account for failures as retryable stage failures.
- `record-failure.ts` applies failure policy while also reading prior unresolved counts.

There is also nested job creation: `runSongAnalysis` calls `createAnalysisPipeline().analyzeSongs(...)`; `AnalysisPipeline.analyzeSongs` creates and finalizes a standalone `song_analysis` job while the parent worker is already executing an `enrichment` job.

## Goals / Non-Goals

**Goals:**

- Make the enrichment stage outcome **Interface** list attempted, succeeded, failed, and skipped song IDs explicitly.
- Centralize failure-row recording, prior suppression resolution, progress summary derivation, and compensation at one stage accounting seam.
- Ensure thrown stage errors and readiness failures expand to durable per-song non-terminal failure rows instead of count-only failures.
- Account for content activation as a real stage so activation failures are retryable and visible.
- Stop creating child `song_analysis` jobs from the parent `enrichment` worker path.
- Preserve existing failure policy semantics unless a test exposes a real bug.
- Treat persistence/accounting failures as parent job-attempt failures rather than success-shaped stage summaries.
- Keep the parent `enrichment` job settlement contract compatible with `harden-job-work-orchestration`.

**Non-Goals:**

- Changing the matching algorithm, embeddings, lyrics prompt, or genre taxonomy.
- Changing billing entitlement selection semantics.
- Adding operator retry UI.
- Replacing `job_failure` schema.
- Rewriting provider adapters.

## Decisions

### 1. Stages return structured outcomes, not counts

**Decision:** Introduce a typed stage outcome model in `src/lib/workflows/enrichment-pipeline/stage-outcomes.ts` or `stage-outcomes/types.ts`.

Proposed shape:

```ts
export type EnrichmentStageName =
  | "audio_features"
  | "genre_tagging"
  | "song_analysis"
  | "song_embedding"
  | "content_activation";

export type StageFailure = {
  songId: string;
  failureCode: FailureCode;
  message: string;
};

export type StageOutcome =
  | {
      kind: "skipped";
      stage: EnrichmentStageName;
      candidateSongIds: string[];
    }
  | {
      kind: "attempted";
      stage: EnrichmentStageName;
      candidateSongIds: string[];
      attemptedSongIds: string[];
      succeededSongIds: string[];
      failures: StageFailure[];
    };

export type StageSummary = {
  total: number;
  succeeded: number;
  failed: number;
};
```

Rules:

- `candidateSongIds` is the sub-batch the orchestrator offered to the stage.
- `attemptedSongIds` is the subset the stage actually tried after readiness checks.
- `succeededSongIds` and `failures[].songId` must be disjoint.
- `StageSummary.total` is `attemptedSongIds.length` for attempted outcomes and `0` for skipped outcomes.
- A helper validates the outcome in tests and in development so illegal states are caught near the stage seam.

**Rationale:** The current count-only **Interface** hides the facts needed for durable failure accounting. The new interface gives callers and tests leverage without knowing the stage implementation.

### 2. A single accounting module applies failure policy and summaries

**Decision:** Add `finalizeStageOutcome(...)` in the stage outcome module.

Responsibilities:

1. Resolve prior non-terminal failures for `succeededSongIds` using `resolveStageFailures`.
2. Record one `job_failure` row per `StageFailure` using `recordStageFailure`.
3. Apply failure policy through the existing `failure-policy.ts` module.
4. Trigger idempotent compensation for `song_analysis` failures with `failureCode = analysis_inputs_missing` only after the durable failure row path succeeds.
5. Return `Result<StageSummary, StageAccountingError>`.

The stage adapters should produce `StageOutcome`; they should not call `recordStageFailure` or `resolveStageFailures` directly after migration.

**Rationale:** Locality improves: suppression rules, durable rows, and compensation are no longer distributed across five stage modules.

### 3. Thrown stage errors become per-candidate non-terminal failures

**Decision:** Replace `runStage(stageName, fn)` with a wrapper such as `runStageWithAccounting({ stage, candidateSongIds, run })`.

Behavior:

- If the stage returns a valid outcome, finalize it.
- If the stage throws before returning an outcome, create a failure outcome for every `candidateSongId` with `failureCode = provider_transient` (or a stage-specific fallback code if supplied).
- The summary failed count SHALL equal the number of candidate songs, not `1`.

**Rationale:** A stage-wide exception means every offered song remains unprocessed. Counting it as one failed item makes progress and measurements lie, and missing failure rows can cause immediate retry churn.

### 4. Content activation is an accounted stage

**Decision:** Add `content_activation` to `EnrichmentStageName` and progress initialization. Convert `runContentActivation(...)` to return a `StageOutcome`.

Behavior:

- Free/pack accounts: successful `markItemsNew` for all song IDs returns those IDs as succeeded.
- Subscription accounts: successful `activate_unlimited_songs` returns offered IDs as succeeded.
- Self-hosted accounts: both `markItemsNew` and `insert_song_unlocks_without_charge` must succeed for offered IDs to be succeeded.
- Missing subscription provenance should produce retryable failures for offered IDs rather than silently falling back to `item_status` only.
- DB/RPC failures should produce retryable `content_activation_failed` failures and leave those songs eligible for later activation once suppression expires.

Add `FAILURE_CODES.CONTENT_ACTIVATION_FAILED = "content_activation_failed"` and map it to non-terminal suppression in `failure-policy.ts`.

**Rationale:** Content activation is what makes analyzed songs visible to the account. Treating it as an unaccounted side effect can leave songs analyzed but not visible with no durable explanation.

### 5. Parent enrichment job owns song-analysis stage accounting

**Decision:** The enrichment worker path SHALL stop using `AnalysisPipeline.analyzeSongs(...)` because that method creates a child `song_analysis` job. Extract a jobless batch analyzer for the stage path.

Proposed extraction:

- Keep prompt/schema logic in `src/lib/domains/enrichment/content-analysis/song-analysis.ts`.
- Extract reusable prefetch/input classification logic from `AnalysisPipeline` into a new module such as `src/lib/domains/enrichment/content-analysis/song-batch-analysis.ts`.
- The new module exposes a jobless function that returns a structured analysis batch outcome: analyzed IDs, skipped IDs with failure codes, and failed IDs.
- `AnalysisPipeline` can remain for standalone/manual flows, but the worker stage uses the jobless batch analyzer and the parent `enrichment` job ID for all failure rows.

**Rationale:** One user-visible enrichment chunk should have one durable job row. Child jobs split progress, failure accounting, and measurements across unrelated job lifecycles.

### 6. Preserve current failure policy semantics unless tests force changes

**Decision:** Keep existing failure-code semantics, with one addition for content activation. Current mappings stay intact:

- source not found -> long non-terminal suppression;
- provider unavailable -> non-terminal suppression;
- provider transient and post-run lookup unavailable -> exponential backoff;
- analysis confirmed inputs missing / permanent / validation -> terminal;
- unknown -> non-terminal default suppression.

**Rationale:** This change deepens accounting. It should not re-litigate retry policy unless a test demonstrates current behavior is wrong.

### 7. Accounting persistence failures fail the parent job attempt

**Decision:** If `finalizeStageOutcome(...)` cannot resolve prior failures, record durable failure rows, apply compensation, or persist progress, the orchestrator SHALL stop the parent attempt and return a failure to the runner. It SHALL NOT convert an unpersisted outcome into successful progress counts.

The runner then marks the parent `enrichment` job failed and applies the normal `enrichment_stopped` library-processing change. Terminal-ref recovery from `harden-job-work-orchestration` remains the durable fallback if runner settlement fails.

**Rationale:** A count summary is only trustworthy after the durable accounting path succeeds. Returning success-shaped counts after a failed failure-row write recreates the hot retry and visibility risks this change is meant to remove.

### 8. Coordinate with job-work orchestration through the parent job contract

**Decision:** This change owns stage-local accounting and parent-job progress details. `harden-job-work-orchestration` owns job claim/sweep/settlement and library-processing active-ref repair. The shared boundary is the parent `enrichment` job row, its progress payload, its failure rows, and its execution measurement details.

Rules:

- Stage modules SHALL NOT create child `song_analysis` jobs from the worker path.
- Stage accounting SHALL use the parent job ID for failure rows and compensation correlation.
- Runner measurement details SHALL continue to include the current chunk summary fields needed by terminal-ref recovery.
- Content activation failures SHALL remain stage failures, not library-processing job settlement failures, unless accounting itself cannot persist.

**Rationale:** The two hardening changes can land independently if they do not share hidden stage/job lifecycle side effects.

## Migration Plan

1. Add characterization tests for current failure codes, suppression durations, thrown-stage behavior, and compensation trigger conditions.
2. Add the `StageOutcome` types and accounting module with unit tests, including accounting persistence failures.
3. Introduce the orchestrator wrapper that finalizes outcomes and fails the parent attempt when accounting cannot persist.
4. Update orchestrator progress to include `content_activation` and to derive progress summaries from finalized outcomes.
5. Migrate `audio_features` to return outcomes; remove direct failure-row writes from the stage.
6. Migrate `genre_tagging` to return outcomes.
7. Extract jobless song batch analysis and migrate `song_analysis` to outcomes while preserving parent-job measurement details.
8. Migrate `song_embedding` to outcomes.
9. Migrate `content_activation` to outcomes and add retryable failures.
10. Remove the old count-only `runStage` helper and direct stage-local failure accounting.
11. Run focused tests, `bun run typecheck`, full `bun run test`, and strict validation for both hardening OpenSpec changes.

## Rollback

The migration can be rolled back by stage. If the full outcome model becomes too large for one branch, land the accounting module and one stage first behind the same public orchestrator behavior, then migrate remaining stages incrementally. No schema rollback is expected.
