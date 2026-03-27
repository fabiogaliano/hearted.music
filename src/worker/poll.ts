import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import type { Job } from "@/lib/data/jobs";
import {
	claimLibraryProcessingJob,
	markJobCompleted,
	markJobFailed,
} from "@/lib/data/jobs";
import { recordExecutionMeasurement } from "@/lib/data/job-measurements";
import { EnrichmentChanges } from "@/lib/workflows/library-processing/changes/enrichment";
import { MatchSnapshotChanges } from "@/lib/workflows/library-processing/changes/match-snapshot";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import { workerConfig } from "./config";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "./execute";
import { log } from "./logger";

let shouldPoll = true;
const activeJobs = new Set<string>();

export function stopPolling() {
	shouldPoll = false;
}

export function getActiveJobCount() {
	return activeJobs.size;
}

async function processEnrichmentJob(job: Job): Promise<void> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeEnrichmentJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				jobId: job.id,
				error: completedResult.error.message,
			});
			return;
		}
		log.info("job-complete", { jobId: job.id, accountId: job.account_id });

		const requestSatisfied = !result.hasMoreSongs;

		await recordMeasurement(job, "enrichment", startedAt, "completed", {
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
			log.error("enrichment-settle-error", {
				jobId: job.id,
				accountId: job.account_id,
				error:
					settleError instanceof Error
						? settleError.message
						: String(settleError),
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);

		await recordMeasurement(job, "enrichment", startedAt, "error");

		try {
			await applyLibraryProcessingChange(
				EnrichmentChanges.stopped({
					accountId: job.account_id,
					jobId: job.id,
					reason: "error",
				}),
			);
		} catch {
			// Already logged in markJobFailedSafe
		}

		throw error;
	}
}

async function processMatchSnapshotRefreshJob(job: Job): Promise<void> {
	const startedAt = job.started_at ?? new Date().toISOString();
	try {
		const result = await executeMatchSnapshotRefreshJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				jobId: job.id,
				error: completedResult.error.message,
			});
		}
		log.info("match-snapshot-refresh-job-complete", {
			jobId: job.id,
			accountId: job.account_id,
		});

		await recordMeasurement(
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
			log.error("refresh-settle-error", {
				jobId: job.id,
				accountId: job.account_id,
				error:
					settleError instanceof Error
						? settleError.message
						: String(settleError),
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);

		await recordMeasurement(job, "match_snapshot_refresh", startedAt, "error");

		try {
			await applyLibraryProcessingChange(
				MatchSnapshotChanges.failed({
					accountId: job.account_id,
					jobId: job.id,
				}),
			);
		} catch {
			// Already logged in markJobFailedSafe
		}

		throw error;
	}
}

async function recordMeasurement(
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
			log.warn("measurement-write-failed", {
				jobId: job.id,
				error: result.error.message,
			});
		}
	} catch (err) {
		log.warn("measurement-write-error", {
			jobId: job.id,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

async function markJobFailedSafe(job: Job, message: string): Promise<void> {
	try {
		const failResult = await markJobFailed(job.id, message);
		if (Result.isError(failResult)) {
			log.error("mark-failed-error", {
				jobId: job.id,
				error: failResult.error.message,
			});
		}
	} catch (markError) {
		log.error("mark-failed-error", {
			jobId: job.id,
			error: markError instanceof Error ? markError.message : String(markError),
		});
	}
	log.error("job-failed", {
		jobId: job.id,
		accountId: job.account_id,
		error: message,
	});
}

export async function startPolling(): Promise<void> {
	shouldPoll = true;
	log.info("polling-start", {
		concurrency: workerConfig.concurrency,
		intervalMs: workerConfig.pollIntervalMs,
	});

	while (shouldPoll) {
		if (activeJobs.size >= workerConfig.concurrency) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		// Unified claim: DB orders by queue_priority DESC, created_at ASC
		const claimResult = await claimLibraryProcessingJob();
		if (Result.isError(claimResult)) {
			log.error("claim-error", { error: claimResult.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = claimResult.value;
		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		activeJobs.add(job.id);
		log.info("job-claimed", {
			jobId: job.id,
			type: job.type,
			accountId: job.account_id,
		});

		(async () => {
			try {
				if (job.type === "match_snapshot_refresh") {
					await processMatchSnapshotRefreshJob(job);
				} else {
					await processEnrichmentJob(job);
				}
			} catch {
				// Already logged + marked failed inside process* functions
			} finally {
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("polling-stopped");
}
