/**
 * Job lifecycle service - orchestrates job state transitions with retry and cleanup.
 *
 * - startJob: Transitions pending → running with cleanup on failure
 *
 * The pending state is important for SQS queue integration - jobs wait in
 * pending status until a worker picks them up and calls startJob().
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { log } from "@/lib/observability/logger";
import {
	getJobById,
	type Job,
	type JobTransition,
	markClaimedJobTerminal,
	markJobCompleted,
	markJobFailed,
	markJobRunning,
} from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

const RETRY_OPTIONS = {
	isRetryable: (err: DbError) => err instanceof DatabaseError,
};

/**
 * Retries a compare-and-set write. An attempt can commit and still error (the
 * response was lost), so the retry misses its own write and reports
 * "superseded"; only after such an error is the row re-read, and `isOwnWrite`
 * tells this caller's committed write apart from a competing writer's.
 */
async function retryTransition(
	jobId: string,
	write: () => Promise<Result<JobTransition, DbError>>,
	isOwnWrite: (job: Job) => boolean,
): Promise<Result<JobTransition, DbError>> {
	let anAttemptErrored = false;
	const result = await withRetry(async () => {
		const attempt = await write();
		if (Result.isError(attempt)) anAttemptErrored = true;
		return attempt;
	}, RETRY_OPTIONS);
	if (!anAttemptErrored || !Result.isOk(result) || result.value === "applied") {
		return result;
	}
	const current = await getJobById(jobId);
	if (Result.isError(current)) return current;
	return current.value && isOwnWrite(current.value)
		? Result.ok("applied")
		: result;
}

/**
 * Starts a job by transitioning from pending → running.
 * If markJobRunning fails, attempts cleanup by marking as failed.
 *
 * This prevents orphaned jobs stuck in 'pending' status forever.
 *
 * @param jobId - The job ID to start
 * @returns "superseded" when the job had already left pending, or error if both
 * start and cleanup failed
 */
export async function startJob(
	jobId: string,
): Promise<Result<JobTransition, DbError>> {
	const runningResult = await retryTransition(
		jobId,
		() => markJobRunning(jobId),
		(job) => job.status === "running",
	);

	if (Result.isOk(runningResult)) {
		return runningResult;
	}

	// Running failed - attempt cleanup to prevent orphaned pending job
	log.error("job-start-failed", {
		jobId,
		error: runningResult.error.message,
	});

	const cleanupResult = await failJob(
		jobId,
		`Failed to start: ${runningResult.error.message}`,
	);

	if (Result.isError(cleanupResult)) {
		log.error("job-start-cleanup-failed", {
			jobId,
			error: cleanupResult.error.message,
		});
	}

	return runningResult;
}

/**
 * Marks a job as completed with retry logic, optionally persisting `progress`
 * in the same write.
 */
export async function completeJob(
	jobId: string,
	progress?: Json,
): Promise<Result<JobTransition, DbError>> {
	return retryTransition(
		jobId,
		() => markJobCompleted(jobId, progress),
		(job) => job.status === "completed",
	);
}

/**
 * Marks a job as failed with retry logic.
 */
export async function failJob(
	jobId: string,
	errorMessage?: string,
): Promise<Result<JobTransition, DbError>> {
	return retryTransition(
		jobId,
		() => markJobFailed(jobId, errorMessage),
		(job) => job.status === "failed" && job.error === (errorMessage ?? null),
	);
}

/**
 * Settles a job this worker leased through a claim RPC, with retry logic.
 * "superseded" means a sweep reclaimed or dead-lettered the lease; the caller
 * must leave the job, its payload, and its side effects to the current owner.
 */
export async function settleClaimedJob(
	job: Pick<Job, "id" | "attempts">,
	status: "completed" | "failed",
	errorMessage?: string,
): Promise<Result<JobTransition, DbError>> {
	return retryTransition(
		job.id,
		() => markClaimedJobTerminal(job, status, errorMessage),
		// A dead-letter also leaves this claim's attempts on a failed row, so the
		// error text is what separates it from this worker's own failed settle.
		(current) =>
			current.status === status &&
			current.attempts === job.attempts &&
			current.error === (errorMessage ?? null),
	);
}
