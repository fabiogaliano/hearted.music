/**
 * Job lifecycle service - orchestrates job state transitions with retry and cleanup.
 *
 * Provides two key functions:
 * - startJob: Transitions pending → running with cleanup on failure
 * - finalizeJob: Transitions running → completed/failed based on progress
 *
 * The pending state is important for SQS queue integration - jobs wait in
 * pending status until a worker picks them up and calls startJob().
 */

import { Result } from "better-result";
import type { Job, JobProgress } from "@/lib/data/jobs";
import * as jobs from "@/lib/data/jobs";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

const RETRY_OPTIONS = {
	isRetryable: (err: DbError) => err instanceof DatabaseError,
};

/**
 * Starts a job by transitioning from pending → running.
 * If markJobRunning fails, attempts cleanup by marking as failed.
 *
 * This prevents orphaned jobs stuck in 'pending' status forever.
 *
 * @param jobId - The job ID to start
 * @returns The job in 'running' state, or error if both start and cleanup failed
 */
export async function startJob(jobId: string): Promise<Result<Job, DbError>> {
	const runningResult = await withRetry(
		() => jobs.markJobRunning(jobId),
		RETRY_OPTIONS,
	);

	if (Result.isOk(runningResult)) {
		return runningResult;
	}

	// Running failed - attempt cleanup to prevent orphaned pending job
	console.error(
		`[job-lifecycle] Failed to start job ${jobId}: ${runningResult.error.message}`,
	);

	const cleanupResult = await failJob(
		jobId,
		`Failed to start: ${runningResult.error.message}`,
	);

	if (Result.isError(cleanupResult)) {
		console.error(
			`[job-lifecycle] Cleanup failed for orphaned job ${jobId}: ${cleanupResult.error.message}`,
		);
	}

	return runningResult;
}

/**
 * Finalizes a job by marking it completed or failed with retry logic.
 *
 * Decision logic:
 * - Empty input (total === 0) or partial success (succeeded > 0) → completed
 * - All failures (succeeded === 0 && total > 0) → failed
 *
 * @param jobId - The job ID to finalize
 * @param progress - The final progress state
 * @param errorMessage - Optional error message for failed jobs
 */
export async function finalizeJob(
	jobId: string,
	progress: JobProgress,
	errorMessage?: string,
): Promise<Result<Job, DbError>> {
	const shouldComplete = progress.total === 0 || progress.succeeded > 0;
	return shouldComplete
		? completeJob(jobId)
		: failJob(jobId, errorMessage ?? "All items failed");
}

/**
 * Marks a job as completed with retry logic.
 */
export async function completeJob(
	jobId: string,
): Promise<Result<Job, DbError>> {
	return withRetry(() => jobs.markJobCompleted(jobId), RETRY_OPTIONS);
}

/**
 * Marks a job as failed with retry logic.
 */
export async function failJob(
	jobId: string,
	errorMessage?: string,
): Promise<Result<Job, DbError>> {
	return withRetry(
		() => jobs.markJobFailed(jobId, errorMessage),
		RETRY_OPTIONS,
	);
}
