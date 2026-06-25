import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { log } from "@/lib/observability/logger";
import { recordJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import {
	type Job,
	markJobCompleted,
	markJobFailed,
} from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	type RetryOptions,
	withRetry,
} from "@/lib/shared/utils/result-wrappers/generic";
import {
	type EnrichmentExecuteResult,
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
	type MatchSnapshotRefreshExecuteResult,
} from "@/worker/execute";
import { captureWorkerJobFailure } from "@/worker/job-failure-reporting";
import { EnrichmentChanges } from "./changes/enrichment";
import { MatchSnapshotChanges } from "./changes/match-snapshot";
import { applyLibraryProcessingChange } from "./service";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingChange,
} from "./types";

type SettlementStatus = "settled" | "settlement_failed";

export type RunJobOutcome =
	| {
			status: "completed";
			workflow: "enrichment";
			result: EnrichmentExecuteResult;
			settlement: SettlementStatus;
	  }
	| {
			status: "completed";
			workflow: "match_snapshot_refresh";
			result: MatchSnapshotRefreshExecuteResult;
			settlement: SettlementStatus;
	  }
	| {
			status: "failed";
			workflow: "enrichment" | "match_snapshot_refresh";
			error: string;
			settlement: SettlementStatus;
	  };

export async function runClaimedJob(
	job: Job,
	actor: string,
): Promise<RunJobOutcome> {
	if (job.type === "match_snapshot_refresh") {
		return runMatchSnapshotRefreshJob(job, actor);
	}

	return runEnrichmentJob(job, actor);
}

async function runEnrichmentJob(
	job: Job,
	actor: string,
): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeEnrichmentJob(job, actor);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: completedResult.error.message,
			});
			throw new Error(completedResult.error.message);
		}

		// A chunk that attempted zero songs while work is still owed is blocked —
		// report stopped(blocked) so the reconciler leaves the workflow stale
		// without immediately re-ensuring another job, preventing a no-progress
		// hot loop.
		const isBlocked = result.doneCount === 0 && result.hasMoreSongs;

		if (isBlocked) {
			await writeMeasurement(job, actor, "enrichment", startedAt, "blocked", {
				batchSequence: result.batchSequence,
				readyCount: result.readyCount,
				doneCount: result.doneCount,
			});

			const change = EnrichmentChanges.stopped({
				accountId: result.accountId,
				jobId: result.jobId,
				reason: "blocked",
			});
			const settlement = await settleLibraryProcessing(change, {
				actor,
				jobId: job.id,
				accountId: result.accountId,
				workflow: "enrichment",
				changeKind: change.kind,
			});

			return {
				status: "completed",
				workflow: "enrichment",
				result,
				settlement,
			};
		}

		const requestSatisfied = !result.hasMoreSongs;

		await writeMeasurement(job, actor, "enrichment", startedAt, "completed", {
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
		const settlement = await settleLibraryProcessing(change, {
			actor,
			jobId: job.id,
			accountId: result.accountId,
			workflow: "enrichment",
			changeKind: change.kind,
		});

		return { status: "completed", workflow: "enrichment", result, settlement };
	} catch (error) {
		const message = errorMessage(error);
		// Failure is returned as outcome, not thrown — capture here while the Error is intact.
		captureWorkerJobFailure(error, {
			workflow: "enrichment",
			jobId: job.id,
			accountId: job.account_id,
		});
		await markJobFailedSafe(job, actor, message);
		await writeMeasurement(job, actor, "enrichment", startedAt, "error");

		const change = EnrichmentChanges.stopped({
			accountId: job.account_id,
			jobId: job.id,
			reason: "error",
		});
		const settlement = await settleLibraryProcessing(change, {
			actor,
			jobId: job.id,
			accountId: job.account_id,
			workflow: "enrichment",
			changeKind: change.kind,
		});

		return {
			status: "failed",
			workflow: "enrichment",
			error: message,
			settlement,
		};
	}
}

async function runMatchSnapshotRefreshJob(
	job: Job,
	actor: string,
): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeMatchSnapshotRefreshJob(job, actor);

		if (result.status === "superseded") {
			const completedResult = await markJobCompleted(job.id);
			if (Result.isError(completedResult)) {
				log.error("mark-completed-failed", {
					actor,
					jobId: job.id,
					accountId: job.account_id,
					error: completedResult.error.message,
				});
				throw new Error(completedResult.error.message);
			}

			await writeMeasurement(
				job,
				actor,
				"match_snapshot_refresh",
				startedAt,
				"superseded",
			);

			const change = MatchSnapshotChanges.superseded({
				accountId: result.accountId,
				jobId: result.jobId,
			});
			const settlement = await settleLibraryProcessing(change, {
				actor,
				jobId: job.id,
				accountId: result.accountId,
				workflow: "match_snapshot_refresh",
				changeKind: change.kind,
			});

			return {
				status: "completed",
				workflow: "match_snapshot_refresh",
				result,
				settlement,
			};
		}

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: completedResult.error.message,
			});
			throw new Error(completedResult.error.message);
		}

		await writeMeasurement(
			job,
			actor,
			"match_snapshot_refresh",
			startedAt,
			"completed",
			{ published: result.published, isEmpty: result.isEmpty },
		);

		const change = MatchSnapshotChanges.published({
			accountId: result.accountId,
			jobId: result.jobId,
		});
		const settlement = await settleLibraryProcessing(change, {
			actor,
			jobId: job.id,
			accountId: result.accountId,
			workflow: "match_snapshot_refresh",
			changeKind: change.kind,
		});

		return {
			status: "completed",
			workflow: "match_snapshot_refresh",
			result,
			settlement,
		};
	} catch (error) {
		const message = errorMessage(error);
		captureWorkerJobFailure(error, {
			workflow: "match_snapshot_refresh",
			jobId: job.id,
			accountId: job.account_id,
		});
		await markJobFailedSafe(job, actor, message);
		await writeMeasurement(
			job,
			actor,
			"match_snapshot_refresh",
			startedAt,
			"error",
		);

		const change = MatchSnapshotChanges.failed({
			accountId: job.account_id,
			jobId: job.id,
		});
		const settlement = await settleLibraryProcessing(change, {
			actor,
			jobId: job.id,
			accountId: job.account_id,
			workflow: "match_snapshot_refresh",
			changeKind: change.kind,
		});

		return {
			status: "failed",
			workflow: "match_snapshot_refresh",
			error: message,
			settlement,
		};
	}
}

interface SettlementLogContext {
	actor: string;
	jobId: string;
	accountId: string;
	workflow: "enrichment" | "match_snapshot_refresh";
	changeKind: LibraryProcessingChange["kind"];
}

const SETTLEMENT_RETRY_OPTIONS: RetryOptions<LibraryProcessingApplyError> = {
	isRetryable: (error) => {
		switch (error.kind) {
			case "load_state":
			case "persist_state":
			case "persist_active_refs":
				return error.cause instanceof DatabaseError;
			case "effect_ensure_failed":
				return error.cause instanceof DatabaseError;
		}
	},
};

async function settleLibraryProcessing(
	change: LibraryProcessingChange,
	context: SettlementLogContext,
): Promise<SettlementStatus> {
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
	job: Job,
	actor: string,
	workflow: "enrichment" | "match_snapshot_refresh",
	startedAt: string,
	outcome: string,
	details?: Record<string, Json>,
): Promise<void> {
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

async function markJobFailedSafe(
	job: Job,
	actor: string,
	message: string,
): Promise<void> {
	try {
		const failResult = await markJobFailed(job.id, message);
		if (Result.isError(failResult)) {
			log.error("mark-failed-error", {
				actor,
				jobId: job.id,
				accountId: job.account_id,
				error: failResult.error.message,
			});
		}
	} catch (markError) {
		log.error("mark-failed-error", {
			actor,
			jobId: job.id,
			accountId: job.account_id,
			error: errorMessage(markError),
		});
	}
}
