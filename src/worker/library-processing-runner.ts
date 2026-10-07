import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { recordJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	type RetryOptions,
	withRetry,
} from "@/lib/shared/utils/result-wrappers/generic";
import type { EnrichmentExecuteResult } from "@/lib/workflows/enrichment-pipeline/types";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingChange,
	LibraryProcessingWorkflow,
} from "@/lib/workflows/library-processing/types";
import {
	changeOf,
	enrichmentRunOutcome,
	finalStatusOf,
	matchSnapshotRefreshRunOutcome,
	measurementOf,
	type OutcomeMeasurement,
	type WorkerOutcome,
} from "@/lib/workflows/library-processing/worker-outcome";
import type { MatchSnapshotRefreshExecuteResult } from "@/lib/workflows/match-snapshot-refresh/types";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "./execute";
import { finalizeJob, requeueLibraryProcessingJobForRetry } from "./finalize";
import { captureWorkerJobFailure } from "./job-failure-reporting";
import { captureWorkerEvent } from "./posthog-capture";

type SettlementStatus = "settled" | "settlement_failed";

export type RunJobOutcome =
	| {
			status: "completed";
			workflow: LibraryProcessingWorkflow;
			settlement: SettlementStatus;
	  }
	| {
			status: "failed";
			workflow: LibraryProcessingWorkflow;
			error: string;
			settlement: SettlementStatus;
	  }
	| {
			status: "retrying";
			workflow: LibraryProcessingWorkflow;
			error: string;
	  }
	// A sweep reclaimed or dead-lettered this worker's lease before it
	// finalized; the current owner applies the outcome, so nothing was written
	// or emitted.
	| {
			status: "lease_lost";
			workflow: LibraryProcessingWorkflow;
	  }
	// The work ran but recording completion failed even after retries (the DB
	// is persistently unavailable). The job is left running rather than requeued
	// on the spot; once its heartbeat lapses the stale sweep re-pends it (or
	// dead-letters it when attempts are spent), so the work re-runs then. Both
	// workflows are idempotent, so that costs time, not correctness.
	| {
			status: "finalize_failed";
			workflow: LibraryProcessingWorkflow;
			error: string;
	  };

/** One claimed run: the claim snapshot, its log label, and its workflow. */
interface RunContext {
	job: Job;
	actor: string;
	workflow: LibraryProcessingWorkflow;
}

// The finalize is fenced on status + attempts, so retrying it is safe.
const FINALIZE_RETRY: RetryOptions<DbError> = {
	maxRetries: 3,
	baseDelayMs: 200,
	isRetryable: (error) => error instanceof DatabaseError,
};

/**
 * `leaseLost` is the heartbeat's signal that this claim was taken over; the
 * run checks it before finalizing so a stale worker stops without reporting,
 * requeueing, or finalizing work that now belongs to the reclaiming worker.
 */
export async function runClaimedJob(
	job: Job,
	actor: string,
	leaseLost: AbortSignal,
): Promise<RunJobOutcome> {
	if (job.type === "match_snapshot_refresh") {
		return runMatchSnapshotRefreshJob(
			{ job, actor, workflow: "match_snapshot_refresh" },
			leaseLost,
		);
	}

	return runEnrichmentJob({ job, actor, workflow: "enrichment" }, leaseLost);
}

async function runEnrichmentJob(
	ctx: RunContext,
	leaseLost: AbortSignal,
): Promise<RunJobOutcome> {
	const startedAt = ctx.job.started_at ?? new Date().toISOString();
	let result: EnrichmentExecuteResult;
	try {
		result = await executeEnrichmentJob(ctx.job, ctx.actor, leaseLost);
	} catch (error) {
		return recordRunError(ctx, startedAt, leaseLost, error);
	}
	if (leaseLost.aborted) return leaseLostOutcome(ctx);

	const recorded = await recordWorkerOutcome(
		ctx,
		startedAt,
		enrichmentRunOutcome(result),
	);

	if (recorded.status === "completed" && result.newCandidatesAvailable) {
		// Event 3: new candidate songs are ready for snapshot matching.
		try {
			captureWorkerEvent({
				distinctId: result.accountId,
				event: "enrichment_candidate_batch_ready",
				properties: {
					new_candidate_count: result.newCandidateSongIds.length,
					batch_sequence: result.batchSequence,
					selection_mode: result.selectionMode,
				},
			});
		} catch {
			// Non-fatal — candidate data is already processed; analytics failure
			// must not affect the outcome returned to the runner.
		}

		// Event 2: a match-snapshot refresh job was queued as a result of these
		// new candidates (settlement drives the scheduler). Priority and
		// available_at aren't accessible here (computed inside executeEffect),
		// so first_visible_match_ready_before_queue is inferred from selectionMode
		// instead — bootstrap mode means the visible match wasn't ready yet.
		if (recorded.settlement === "settled") {
			try {
				captureWorkerEvent({
					distinctId: result.accountId,
					event: "first_match_refresh_queued",
					properties: {
						batch_sequence: result.batchSequence,
						selection_mode: result.selectionMode,
						first_visible_match_ready_before_queue:
							result.selectionMode !== "first_match_bootstrap",
					},
				});
			} catch {
				// Non-fatal — the refresh is already queued.
			}
		}
	}

	return recorded;
}

async function runMatchSnapshotRefreshJob(
	ctx: RunContext,
	leaseLost: AbortSignal,
): Promise<RunJobOutcome> {
	const startedAt = ctx.job.started_at ?? new Date().toISOString();
	let result: MatchSnapshotRefreshExecuteResult;
	try {
		result = await executeMatchSnapshotRefreshJob(
			ctx.job,
			ctx.actor,
			leaseLost,
		);
	} catch (error) {
		return recordRunError(ctx, startedAt, leaseLost, error);
	}
	if (result.status === "lease_lost" || leaseLost.aborted) {
		return leaseLostOutcome(ctx);
	}

	return recordWorkerOutcome(
		ctx,
		startedAt,
		matchSnapshotRefreshRunOutcome(result),
	);
}

// App-thrown errors consume the same retry budget as worker crashes: requeue
// while attempts remain (the claim RPC already counted this attempt), and only
// finalize as failed once max_attempts is exhausted — or when the requeue
// itself can't land (lease lost, or the write failed).
async function recordRunError(
	ctx: RunContext,
	startedAt: string,
	leaseLost: AbortSignal,
	error: unknown,
): Promise<RunJobOutcome> {
	const { job, workflow } = ctx;
	if (leaseLost.aborted) return leaseLostOutcome(ctx);
	const message = errorMessage(error);
	// Failure is returned as outcome, not thrown — capture here while the Error is intact.
	captureWorkerJobFailure(error, {
		workflow,
		jobId: job.id,
		accountId: job.account_id,
	});

	if (await tryRequeueForRetry(ctx, message)) {
		await writeMeasurement(ctx, startedAt, {
			job_id: job.id,
			account_id: job.account_id,
			workflow,
			outcome: "error",
			details: { retrying: true },
		});
		return { status: "retrying", workflow, error: message };
	}

	return recordWorkerOutcome(ctx, startedAt, {
		jobId: job.id,
		accountId: job.account_id,
		workflow,
		status: "failed",
		error: message,
	});
}

async function tryRequeueForRetry(
	ctx: RunContext,
	message: string,
): Promise<boolean> {
	const { job, actor, workflow } = ctx;
	if (job.attempts >= job.max_attempts) return false;

	const requeued = await requeueLibraryProcessingJobForRetry(job, message);
	if (Result.isError(requeued)) {
		log.error("requeue-for-retry-failed", {
			actor,
			jobId: job.id,
			accountId: job.account_id,
			workflow,
			error: requeued.error.message,
		});
		return false;
	}
	return requeued.value;
}

/**
 * Finalizes the job with `outcome`, then records it and hands its change to
 * library-processing. A completed run is retried until it finalizes: the
 * work is done and only the bookkeeping is owed. A failed run gets a single
 * attempt; if it misses, the stale sweep ends the job instead.
 */
async function recordWorkerOutcome(
	ctx: RunContext,
	startedAt: string,
	outcome: WorkerOutcome,
): Promise<RunJobOutcome> {
	const { job, actor, workflow } = ctx;
	const finalStatus = finalStatusOf(outcome);

	if (finalStatus === "completed") {
		const finalized = await withRetry(
			() => finalizeJob(job, outcome),
			FINALIZE_RETRY,
		);
		if (Result.isError(finalized)) return finalizeFailed(ctx, finalized.error);
		if (finalized.value === "superseded") return leaseLostOutcome(ctx);
	} else {
		const finalized = await finalizeJob(job, outcome);
		if (Result.isError(finalized)) {
			log.error("finalize-failed-error", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: finalized.error.message,
			});
		} else if (finalized.value === "superseded") {
			return leaseLostOutcome(ctx);
		}
	}

	await writeMeasurement(ctx, startedAt, measurementOf(outcome));
	const settlement = await settleLibraryProcessing(ctx, changeOf(outcome));

	if (outcome.status === "failed") {
		return { status: "failed", workflow, error: outcome.error, settlement };
	}
	return { status: "completed", workflow, settlement };
}

function finalizeFailed(ctx: RunContext, error: DbError): RunJobOutcome {
	const { job, actor, workflow } = ctx;
	log.error("finalize-failed", {
		actor,
		jobId: job.id,
		accountId: job.account_id,
		error: error.message,
	});
	captureWorkerJobFailure(error, {
		workflow,
		jobId: job.id,
		accountId: job.account_id,
	});
	return { status: "finalize_failed", workflow, error: error.message };
}

function leaseLostOutcome(ctx: RunContext): RunJobOutcome {
	const { job, actor, workflow } = ctx;
	log.warn("job-lease-lost", {
		actor,
		jobId: job.id,
		accountId: job.account_id,
		workflow,
		attempts: job.attempts,
	});
	return { status: "lease_lost", workflow };
}

const SETTLEMENT_RETRY_OPTIONS: RetryOptions<LibraryProcessingApplyError> = {
	maxRetries: 3,
	isRetryable: (error) => {
		switch (error.kind) {
			case "load_state":
			case "persist_state":
			case "persist_active_refs":
				return error.cause instanceof DatabaseError;
			case "effect_ensure_failed":
				return error.cause instanceof DatabaseError;
			case "persist_conflict":
				return true;
		}
	},
};

async function settleLibraryProcessing(
	ctx: RunContext,
	change: LibraryProcessingChange,
): Promise<SettlementStatus> {
	const { job, actor, workflow } = ctx;
	const context = {
		actor,
		jobId: job.id,
		accountId: job.account_id,
		workflow,
		changeKind: change.kind,
	};
	try {
		const settleResult = await withRetry(
			() => applyLibraryProcessingChange(change),
			SETTLEMENT_RETRY_OPTIONS,
		);
		if (Result.isError(settleResult)) {
			log.error("library-processing-settlement-failed", {
				...context,
				error: settleResult.error,
			});
			// The job is already marked completed by this point, so a failed
			// settlement leaves no failure trace in the DB. Capture to Sentry so
			// it survives the worker log's short retention window.
			captureException(settleResult.error, {
				tags: { workflow: context.workflow, phase: "settlement" },
				extra: {
					jobId: context.jobId,
					accountId: context.accountId,
					changeKind: context.changeKind,
				},
			});
			return "settlement_failed";
		}
		return "settled";
	} catch (error) {
		log.error("library-processing-settlement-threw", {
			...context,
			error: errorMessage(error),
		});
		captureException(error, {
			tags: { workflow: context.workflow, phase: "settlement" },
			extra: {
				jobId: context.jobId,
				accountId: context.accountId,
				changeKind: context.changeKind,
			},
		});
		return "settlement_failed";
	}
}

async function writeMeasurement(
	ctx: RunContext,
	startedAt: string,
	measurement: OutcomeMeasurement,
): Promise<void> {
	const { job, actor } = ctx;
	try {
		const result = await recordJobExecutionMeasurement({
			jobId: measurement.job_id,
			accountId: measurement.account_id,
			workflow: ctx.workflow,
			queuePriority: job.queue_priority ?? null,
			attemptNumber: job.attempts,
			queuedAt: job.created_at,
			startedAt,
			finishedAt: new Date().toISOString(),
			outcome: measurement.outcome,
			details: measurement.details,
		});
		if (Result.isError(result)) {
			log.warn("measurement-write-failed", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: result.error.message,
			});
		}
	} catch (err) {
		log.warn("measurement-write-error", {
			actor,
			jobId: job.id,
			accountId: job.account_id,
			error: errorMessage(err),
		});
	}
}
