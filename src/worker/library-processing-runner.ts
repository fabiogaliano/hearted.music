import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { log } from "@/lib/observability/logger";
import { recordJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	type RetryOptions,
	withRetry,
} from "@/lib/shared/utils/result-wrappers/generic";
import {
	EnrichmentChanges,
	MatchSnapshotChanges,
} from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import {
	finalizeEnrichmentJob,
	finalizeMatchSnapshotRefreshJob,
	requeueLibraryProcessingJobForRetry,
} from "@/lib/workflows/library-processing/settlement";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingChange,
	LibraryProcessingWorkflow,
} from "@/lib/workflows/library-processing/types";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "./execute";
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

// App-thrown errors consume the same retry budget as worker crashes: requeue
// while attempts remain (the claim RPC already counted this attempt), and only
// finalize as failed once max_attempts is exhausted — or when the requeue
// itself can't land (lease lost, or the write failed).
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
	const { job, actor } = ctx;
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeEnrichmentJob(job, actor, leaseLost);
		if (leaseLost.aborted) return leaseLostOutcome(ctx);

		const isBlocked = result.doneCount === 0 && result.hasMoreSongs;
		const eventReason = isBlocked ? "failed" : "completed";

		const completedResult = await withRetry(
			() => finalizeEnrichmentJob(job, "completed", eventReason),
			FINALIZE_RETRY,
		);
		if (Result.isError(completedResult)) {
			return finalizeFailed(ctx, completedResult.error);
		}
		if (completedResult.value === "superseded") {
			return leaseLostOutcome(ctx);
		}

		// A chunk that attempted zero songs while work is still owed is blocked —
		// report stopped(blocked) so the reconciler leaves the workflow stale
		// without immediately re-ensuring another job, preventing a no-progress
		// hot loop.

		if (isBlocked) {
			await writeMeasurement(ctx, startedAt, "blocked", {
				batchSequence: result.batchSequence,
				readyCount: result.readyCount,
				doneCount: result.doneCount,
			});

			const change = EnrichmentChanges.stopped({
				accountId: result.accountId,
				jobId: result.jobId,
				reason: "blocked",
			});
			const settlement = await settleLibraryProcessing(ctx, change);

			return {
				status: "completed",
				workflow: "enrichment",
				settlement,
			};
		}

		const requestSatisfied = !result.hasMoreSongs;

		await writeMeasurement(ctx, startedAt, "completed", {
			requestSatisfied,
			newCandidatesAvailable: result.newCandidatesAvailable,
			batchSequence: result.batchSequence,
			readyCount: result.readyCount,
			doneCount: result.doneCount,
			succeededCount: result.succeededCount,
			failedCount: result.failedCount,
		});

		const change = EnrichmentChanges.completed({
			accountId: result.accountId,
			jobId: result.jobId,
			requestSatisfied,
			newCandidatesAvailable: result.newCandidatesAvailable,
		});
		const settlement = await settleLibraryProcessing(ctx, change);

		if (result.newCandidatesAvailable) {
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
			if (settlement === "settled") {
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

		return { status: "completed", workflow: "enrichment", settlement };
	} catch (error) {
		if (leaseLost.aborted) return leaseLostOutcome(ctx);
		const message = errorMessage(error);
		// Failure is returned as outcome, not thrown — capture here while the Error is intact.
		captureWorkerJobFailure(error, {
			workflow: "enrichment",
			jobId: job.id,
			accountId: job.account_id,
		});

		if (await tryRequeueForRetry(ctx, message)) {
			await writeMeasurement(ctx, startedAt, "error", {
				retrying: true,
			});
			return { status: "retrying", workflow: "enrichment", error: message };
		}

		const failedResult = await finalizeEnrichmentJob(
			job,
			"failed",
			"failed",
			message,
		);
		if (Result.isError(failedResult)) {
			log.error("mark-failed-error", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: failedResult.error.message,
			});
		} else if (failedResult.value === "superseded") {
			return leaseLostOutcome(ctx);
		}

		await writeMeasurement(ctx, startedAt, "error");

		const change = EnrichmentChanges.stopped({
			accountId: job.account_id,
			jobId: job.id,
			reason: "error",
		});
		const settlement = await settleLibraryProcessing(ctx, change);

		return {
			status: "failed",
			workflow: "enrichment",
			error: message,
			settlement,
		};
	}
}

async function runMatchSnapshotRefreshJob(
	ctx: RunContext,
	leaseLost: AbortSignal,
): Promise<RunJobOutcome> {
	const { job, actor } = ctx;
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeMatchSnapshotRefreshJob(job, actor, leaseLost);
		if (result.status === "lease_lost" || leaseLost.aborted) {
			return leaseLostOutcome(ctx);
		}

		if (result.status === "superseded") {
			let settlement: SettlementStatus = "settled";

			const completedResult = await withRetry(
				() =>
					finalizeMatchSnapshotRefreshJob(job, "completed", "superseded", null),
				FINALIZE_RETRY,
			);
			if (Result.isError(completedResult)) {
				return finalizeFailed(ctx, completedResult.error);
			}
			if (completedResult.value === "superseded") {
				return leaseLostOutcome(ctx);
			}

			await writeMeasurement(ctx, startedAt, "superseded");

			const change = MatchSnapshotChanges.superseded({
				accountId: result.accountId,
				jobId: result.jobId,
			});
			settlement = await settleLibraryProcessing(ctx, change);

			return {
				status: "completed",
				workflow: "match_snapshot_refresh",
				settlement,
			};
		}

		let settlement: SettlementStatus = "settled";

		const completedResult = await withRetry(
			() =>
				finalizeMatchSnapshotRefreshJob(
					job,
					"completed",
					"published",
					result.snapshotId,
				),
			FINALIZE_RETRY,
		);
		if (Result.isError(completedResult)) {
			return finalizeFailed(ctx, completedResult.error);
		}
		if (completedResult.value === "superseded") {
			return leaseLostOutcome(ctx);
		}

		await writeMeasurement(ctx, startedAt, "completed", {
			published: result.published,
			isEmpty: result.isEmpty,
		});

		const change = MatchSnapshotChanges.published({
			accountId: result.accountId,
			jobId: result.jobId,
		});
		settlement = await settleLibraryProcessing(ctx, change);

		return {
			status: "completed",
			workflow: "match_snapshot_refresh",
			settlement,
		};
	} catch (error) {
		if (leaseLost.aborted) {
			return leaseLostOutcome(ctx);
		}
		const message = errorMessage(error);
		captureWorkerJobFailure(error, {
			workflow: "match_snapshot_refresh",
			jobId: job.id,
			accountId: job.account_id,
		});

		if (await tryRequeueForRetry(ctx, message)) {
			await writeMeasurement(ctx, startedAt, "error", { retrying: true });
			return {
				status: "retrying",
				workflow: "match_snapshot_refresh",
				error: message,
			};
		}

		const failedResult = await finalizeMatchSnapshotRefreshJob(
			job,
			"failed",
			"failed",
			null,
			message,
		);
		if (Result.isError(failedResult)) {
			log.error("mark-failed-error", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: failedResult.error.message,
			});
		} else if (failedResult.value === "superseded") {
			return leaseLostOutcome(ctx);
		}

		await writeMeasurement(ctx, startedAt, "error");

		const change = MatchSnapshotChanges.failed({
			accountId: job.account_id,
			jobId: job.id,
		});
		const settlement = await settleLibraryProcessing(ctx, change);

		return {
			status: "failed",
			workflow: "match_snapshot_refresh",
			error: message,
			settlement,
		};
	}
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
	outcome: string,
	details?: Record<string, Json>,
): Promise<void> {
	const { job, actor, workflow } = ctx;
	try {
		const result = await recordJobExecutionMeasurement({
			jobId: job.id,
			accountId: job.account_id,
			workflow,
			queuePriority: job.queue_priority ?? null,
			attemptNumber: job.attempts,
			queuedAt: job.created_at,
			startedAt,
			finishedAt: new Date().toISOString(),
			outcome,
			details,
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
