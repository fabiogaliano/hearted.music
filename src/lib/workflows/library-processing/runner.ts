import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { recordExecutionMeasurement } from "@/lib/data/job-measurements";
import type { Job } from "@/lib/data/jobs";
import { markJobCompleted, markJobFailed } from "@/lib/data/jobs";
import { maybeDevDelay } from "@/lib/workflows/library-processing/devtools/delay";
import type { WorkflowDevServerSettings } from "@/lib/workflows/library-processing/devtools/settings";
import {
	type EnrichmentExecuteResult,
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
	type MatchSnapshotRefreshExecuteResult,
} from "@/worker/execute";
import { EnrichmentChanges } from "./changes/enrichment";
import { MatchSnapshotChanges } from "./changes/match-snapshot";
import { applyLibraryProcessingChange } from "./service";

export interface RunClaimedJobOptions {
	settings?: WorkflowDevServerSettings;
}

export type RunJobOutcome =
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

export async function runClaimedJob(
	job: Job,
	options: RunClaimedJobOptions = {},
): Promise<RunJobOutcome> {
	if (job.type === "match_snapshot_refresh") {
		return runMatchSnapshotRefreshJob(job, options);
	}

	return runEnrichmentJob(job, options);
}

async function runEnrichmentJob(
	job: Job,
	options: RunClaimedJobOptions,
): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeEnrichmentJob(job, options.settings);
		await maybeDevDelay(options.settings?.preSettlementDelayMs);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			console.error(
				`[runner] mark-completed-failed job=${job.id}: ${completedResult.error.message}`,
			);
			return {
				status: "failed",
				workflow: "enrichment",
				error: completedResult.error.message,
			};
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

		try {
			await applyLibraryProcessingChange(
				EnrichmentChanges.completed({
					accountId: result.accountId,
					jobId: result.jobId,
					requestSatisfied,
					newCandidatesAvailable: result.newCandidatesAvailable,
				}),
			);
		} catch (settleError) {
			console.error(
				`[runner] enrichment-settle-error job=${job.id}:`,
				settleError,
			);
		}

		return { status: "completed", workflow: "enrichment", result };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await maybeDevDelay(options.settings?.preSettlementDelayMs);
		await markJobFailedSafe(job, message);
		await writeMeasurement(job, "enrichment", startedAt, "error");

		try {
			await applyLibraryProcessingChange(
				EnrichmentChanges.stopped({
					accountId: job.account_id,
					jobId: job.id,
					reason: "error",
				}),
			);
		} catch {
			// The failure path is already recorded on the job row.
		}

		return { status: "failed", workflow: "enrichment", error: message };
	}
}

async function runMatchSnapshotRefreshJob(
	job: Job,
	options: RunClaimedJobOptions,
): Promise<RunJobOutcome> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeMatchSnapshotRefreshJob(job, options.settings);
		await maybeDevDelay(options.settings?.preSettlementDelayMs);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			console.error(
				`[runner] mark-completed-failed job=${job.id}: ${completedResult.error.message}`,
			);
			return {
				status: "failed",
				workflow: "match_snapshot_refresh",
				error: completedResult.error.message,
			};
		}

		await writeMeasurement(
			job,
			"match_snapshot_refresh",
			startedAt,
			"completed",
			{ published: result.published, isEmpty: result.isEmpty },
		);

		try {
			await applyLibraryProcessingChange(
				MatchSnapshotChanges.published({
					accountId: result.accountId,
					jobId: result.jobId,
				}),
			);
		} catch (settleError) {
			console.error(
				`[runner] refresh-settle-error job=${job.id}:`,
				settleError,
			);
		}

		return {
			status: "completed",
			workflow: "match_snapshot_refresh",
			result,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await maybeDevDelay(options.settings?.preSettlementDelayMs);
		await markJobFailedSafe(job, message);
		await writeMeasurement(job, "match_snapshot_refresh", startedAt, "error");

		try {
			await applyLibraryProcessingChange(
				MatchSnapshotChanges.failed({
					accountId: job.account_id,
					jobId: job.id,
				}),
			);
		} catch {
			// The failure path is already recorded on the job row.
		}

		return {
			status: "failed",
			workflow: "match_snapshot_refresh",
			error: message,
		};
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
