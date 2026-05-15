import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { recordExecutionMeasurement } from "@/lib/data/job-measurements";
import type { Job } from "@/lib/data/jobs";
import { markJobCompleted, markJobFailed } from "@/lib/data/jobs";
import {
	type EnrichmentExecuteResult,
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
	type MatchSnapshotRefreshExecuteResult,
} from "@/worker/execute";
import { EnrichmentChanges } from "./changes/enrichment";
import { MatchSnapshotChanges } from "./changes/match-snapshot";
import { applyLibraryProcessingChange } from "./service";
import type { LibraryProcessingChange } from "./types";

type RunJobOutcome =
	| {
			status: "completed";
			workflow: "enrichment";
			result: EnrichmentExecuteResult;
	  }
	| {
			status: "completed";
			workflow: "match_snapshot_refresh";
			result: MatchSnapshotRefreshExecuteResult;
	  }
	| {
			status: "failed";
			workflow: "enrichment" | "match_snapshot_refresh";
			error: string;
	  };

export async function runClaimedJob(job: Job): Promise<RunJobOutcome> {
	if (job.type === "match_snapshot_refresh") {
		return runMatchSnapshotRefreshJob(job);
	}

	return runEnrichmentJob(job);
}

async function runEnrichmentJob(job: Job): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeEnrichmentJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			console.error(
				`[runner] mark-completed-failed job=${job.id}: ${completedResult.error.message}`,
			);
			throw new Error(completedResult.error.message);
		}

		const requestSatisfied = !result.hasMoreSongs;

		await writeMeasurement(job, "enrichment", startedAt, "completed", {
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
		await settleLibraryProcessing(change, {
			jobId: job.id,
			accountId: result.accountId,
			workflow: "enrichment",
			changeKind: change.kind,
		});

		return { status: "completed", workflow: "enrichment", result };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);
		await writeMeasurement(job, "enrichment", startedAt, "error");

		const change = EnrichmentChanges.stopped({
			accountId: job.account_id,
			jobId: job.id,
			reason: "error",
		});
		await settleLibraryProcessing(change, {
			jobId: job.id,
			accountId: job.account_id,
			workflow: "enrichment",
			changeKind: change.kind,
		});

		return { status: "failed", workflow: "enrichment", error: message };
	}
}

async function runMatchSnapshotRefreshJob(job: Job): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeMatchSnapshotRefreshJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			console.error(
				`[runner] mark-completed-failed job=${job.id}: ${completedResult.error.message}`,
			);
			throw new Error(completedResult.error.message);
		}

		await writeMeasurement(
			job,
			"match_snapshot_refresh",
			startedAt,
			"completed",
			{ published: result.published, isEmpty: result.isEmpty },
		);

		const change = MatchSnapshotChanges.published({
			accountId: result.accountId,
			jobId: result.jobId,
		});
		await settleLibraryProcessing(change, {
			jobId: job.id,
			accountId: result.accountId,
			workflow: "match_snapshot_refresh",
			changeKind: change.kind,
		});

		return {
			status: "completed",
			workflow: "match_snapshot_refresh",
			result,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);
		await writeMeasurement(job, "match_snapshot_refresh", startedAt, "error");

		const change = MatchSnapshotChanges.failed({
			accountId: job.account_id,
			jobId: job.id,
		});
		await settleLibraryProcessing(change, {
			jobId: job.id,
			accountId: job.account_id,
			workflow: "match_snapshot_refresh",
			changeKind: change.kind,
		});

		return {
			status: "failed",
			workflow: "match_snapshot_refresh",
			error: message,
		};
	}
}

interface SettlementLogContext {
	jobId: string;
	accountId: string;
	workflow: "enrichment" | "match_snapshot_refresh";
	changeKind: LibraryProcessingChange["kind"];
}

async function settleLibraryProcessing(
	change: LibraryProcessingChange,
	context: SettlementLogContext,
): Promise<void> {
	try {
		const settleResult = await applyLibraryProcessingChange(change);
		if (Result.isError(settleResult)) {
			console.error("[runner] library-processing-settlement-failed", {
				...context,
				error: settleResult.error,
			});
		}
	} catch (error) {
		console.error("[runner] library-processing-settlement-threw", {
			...context,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function writeMeasurement(
	job: Job,
	workflow: "enrichment" | "match_snapshot_refresh",
	startedAt: string,
	outcome: string,
	details?: Record<string, Json>,
): Promise<void> {
	try {
		const result = await recordExecutionMeasurement({
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
			console.warn(
				`[runner] measurement-write-failed job=${job.id}: ${result.error.message}`,
			);
		}
	} catch (err) {
		console.warn(
			`[runner] measurement-write-error job=${job.id}:`,
			err instanceof Error ? err.message : String(err),
		);
	}
}

async function markJobFailedSafe(job: Job, message: string): Promise<void> {
	try {
		const failResult = await markJobFailed(job.id, message);
		if (Result.isError(failResult)) {
			console.error(
				`[runner] mark-failed-error job=${job.id}: ${failResult.error.message}`,
			);
		}
	} catch (markError) {
		console.error(
			`[runner] mark-failed-error job=${job.id}:`,
			markError instanceof Error ? markError.message : String(markError),
		);
	}
}
