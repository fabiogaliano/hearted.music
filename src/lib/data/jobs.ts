/**
 * Job data operations for sync and analysis pipelines.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import type { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Enums, Tables } from "./database.types";
import {
	type JobProgress as JobProgressType,
	JobProgressSchema as JobProgressSchemaImpl,
} from "@/lib/jobs/progress/types";

/** Job row type */
export type Job = Tables<"job">;

/** Job type enum from database */
export type JobType = Enums<"job_type">;

/**
 * Job status enum from database.
 * Note: Should match JobStatusSchema in job-progress/types.ts
 */
export type JobStatus = Enums<"job_status">;

// Re-export JobProgress from SSE types (single source of truth)
export type JobProgress = JobProgressType;
export const JobProgressSchema = JobProgressSchemaImpl;

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

/**
 * Creates a new job for an account in 'pending' status.
 * Use startJob() from job-lifecycle service to transition to 'running'.
 *
 * The pending state is important for SQS queue integration - it represents
 * "job created, waiting to be picked up by a worker."
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
