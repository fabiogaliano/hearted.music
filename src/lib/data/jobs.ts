/**
 * Job data operations for sync and analysis pipelines.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { DatabaseError, type DbError } from "@/lib/errors/data";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Enums, Tables } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Job row type */
export type Job = Tables<"job">;

/** Job type enum from database */
export type JobType = Enums<"job_type">;

/** Job status enum from database */
export type JobStatus = Enums<"job_status">;

/**
 * Job progress structure stored in JSONB.
 * Used for tracking sync progress and checkpoint data.
 */
export type JobProgress = {
	/** Total items to process */
	total: number;
	/** Items processed so far */
	done: number;
	/** Successfully processed items */
	succeeded: number;
	/** Failed items */
	failed: number;
	/** Cursor for pagination/resumption (e.g., timestamp, offset) */
	cursor?: string;
};

// ============================================================================
// Job Query Operations
// ============================================================================

/**
 * Gets a job by its UUID.
 * Returns null if not found (not an error).
 */
export function getJobById(id: string): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("job").select("*").eq("id", id).single(),
	);
}

/**
 * Gets the active (non-terminal) job for an account and type.
 * Active means status is 'pending' or 'running'.
 * Returns null if no active job found.
 */
export function getActiveJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("type", type)
			.in("status", ["pending", "running"])
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

/**
 * Gets the latest job for an account and type (regardless of status).
 * Used for checkpoint retrieval when resuming sync operations.
 * Returns null if no job found.
 */
export function getLatestJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("type", type)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

/**
 * Gets all jobs for an account, optionally filtered by type.
 * Returns empty array if none found.
 */
export function getJobs(
	accountId: string,
	type?: JobType,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	let query = supabase
		.from("job")
		.select("*")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false });

	if (type) {
		query = query.eq("type", type);
	}

	return fromSupabaseMany(query);
}

// ============================================================================
// Job Mutation Operations
// ============================================================================

/**
 * Creates a new job for an account.
 * Starts in 'pending' status with empty progress.
 */
export function createJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	const initialProgress: JobProgress = {
		total: 0,
		done: 0,
		succeeded: 0,
		failed: 0,
	};

	return fromSupabaseSingle(
		supabase
			.from("job")
			.insert({
				account_id: accountId,
				type,
				status: "pending",
				progress: initialProgress,
			})
			.select()
			.single(),
	);
}

/**
 * Updates the progress of a job.
 * Progress is stored as JSONB for flexible checkpoint data.
 */
export function updateJobProgress(
	id: string,
	progress: JobProgress,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase.from("job").update({ progress }).eq("id", id).select().single(),
	);
}

/**
 * Marks a job as running and sets started_at timestamp.
 */
export function markJobRunning(id: string): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "running",
				started_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

/**
 * Marks a job as completed and sets completed_at timestamp.
 */
export function markJobCompleted(id: string): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "completed",
				completed_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

/**
 * Marks a job as failed with an error message and sets completed_at timestamp.
 */
export function markJobFailed(
	id: string,
	error?: string,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "failed",
				error: error ?? null,
				completed_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

// ============================================================================
// Job Lifecycle Helpers
// ============================================================================

const DEFAULT_JOB_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 30000,
};

/**
 * Finalizes a job by marking it completed or failed with retry logic.
 * Empty input or partial success = completed; all failures = failed.
 */
export async function finalizeJob(
	jobId: string,
	progress: JobProgress,
	errorMessage?: string,
): Promise<Result<Job, DbError>> {
	const shouldComplete = progress.total === 0 || progress.succeeded > 0;
	return retryJobOperation(() =>
		shouldComplete
			? markJobCompleted(jobId)
			: markJobFailed(jobId, errorMessage ?? "All items failed"),
	);
}

async function retryJobOperation<T>(
	operation: () => Promise<Result<T, DbError>>,
): Promise<Result<T, DbError>> {
	const { maxRetries, baseDelayMs, maxDelayMs } = DEFAULT_JOB_RETRY_OPTIONS;
	const totalAttempts = maxRetries + 1;

	for (let attempt = 1; attempt <= totalAttempts; attempt++) {
		const result = await operation();
		if (Result.isOk(result)) {
			return result;
		}

		if (!isRetryableDbError(result.error) || attempt === totalAttempts) {
			return result;
		}

		const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
		await sleep(delay);
	}

	throw new Error("Unreachable: retry loop exited without returning");
}

function isRetryableDbError(error: DbError): boolean {
	return error instanceof DatabaseError;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
