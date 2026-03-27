/**
 * Job data operations for sync and analysis pipelines.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import {
	type EnrichmentChunkProgress,
	JobProgressSchema as JobProgressSchemaImpl,
	type JobProgress as JobProgressType,
} from "@/lib/platform/jobs/progress/types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Enums, Json, Tables } from "./database.types";

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

function enrichmentProgressToJson(progress: EnrichmentChunkProgress): Json {
	const stages: { [key: string]: Json | undefined } = {};

	for (const [stageName, stageProgress] of Object.entries(progress.stages)) {
		stages[stageName] = {
			status: stageProgress.status,
			succeeded: stageProgress.succeeded,
			failed: stageProgress.failed,
		};
	}

	return {
		total: progress.total,
		done: progress.done,
		succeeded: progress.succeeded,
		failed: progress.failed,
		currentStage: progress.currentStage,
		stages,
		batchSize: progress.batchSize,
		batchSequence: progress.batchSequence,
	};
}

function matchSnapshotRefreshProgressToJson(
	needsTargetSongEnrichment: boolean,
): Json {
	return {
		total: 0,
		done: 0,
		succeeded: 0,
		failed: 0,
		plan: {
			needsTargetSongEnrichment,
		},
	};
}

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
	progress: JobProgress | EnrichmentChunkProgress,
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

/** Sync-related job types for dashboard stats */
const SYNC_JOB_TYPES: JobType[] = [
	"sync_liked_songs",
	"sync_playlists",
	"sync_playlist_tracks",
];

/**
 * Gets the most recent completed sync job for an account.
 * Used for "Last synced: 2m ago" display on dashboard.
 * Returns null if no completed sync job exists.
 */
export function getLastCompletedSync(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("status", "completed")
			.in("type", SYNC_JOB_TYPES)
			.order("completed_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

// ---------------------------------------------------------------------------
// Enrichment job helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new enrichment job with custom initial progress.
 * Unlike createJob, accepts arbitrary progress (for batchSize/batchSequence).
 */
export function createEnrichmentJob(
	accountId: string,
	progress: EnrichmentChunkProgress,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.insert({
				account_id: accountId,
				type: "enrichment" as JobType,
				status: "pending" as const,
				progress: enrichmentProgressToJson(progress),
			})
			.select()
			.single(),
	);
}

/**
 * Gets or creates an enrichment job for an account.
 * Reuses an existing active (pending/running) job if one exists,
 * otherwise creates a new one with the provided initial progress.
 *
 * A partial unique index (idx_unique_active_enrichment_per_account) enforces
 * at most one active enrichment job per account. If a concurrent caller wins
 * the insert race, we catch the unique violation and read the winner's row.
 */
export async function getOrCreateEnrichmentJob(
	accountId: string,
	progress: EnrichmentChunkProgress,
): Promise<Result<Job, DbError>> {
	const existing = await getActiveEnrichmentJob(accountId);
	if (Result.isError(existing)) return existing;
	if (existing.value) {
		const job: Job = existing.value;
		return Result.ok(job);
	}

	const created = await createEnrichmentJob(accountId, progress);

	if (Result.isError(created) && created.error._tag === "ConstraintError") {
		// Unique-violation from idx_unique_active_enrichment_per_account — a
		// concurrent caller inserted between our SELECT and INSERT. Read the
		// winner's row instead of propagating the error.
		const retry = await getActiveEnrichmentJob(accountId);
		if (Result.isError(retry)) return retry;
		if (retry.value) return Result.ok(retry.value);
	}

	return created;
}

/**
 * Gets the active enrichment job for an account.
 * Shorthand for getActiveJob(accountId, "enrichment").
 */
export function getActiveEnrichmentJob(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	return getActiveJob(accountId, "enrichment");
}

/**
 * Updates the heartbeat timestamp on a job to signal the worker is alive.
 */
export async function updateHeartbeat(
	jobId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { error } = await supabase
		.from("job")
		.update({ heartbeat_at: new Date().toISOString() })
		.eq("id", jobId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(undefined);
}

// ---------------------------------------------------------------------------
// Library-processing ensure/create helpers
// ---------------------------------------------------------------------------

/**
 * Ensures an enrichment job exists for an account with scheduling metadata.
 * Reuses an active job if one exists; creates a new one otherwise.
 */
export async function ensureEnrichmentJob(opts: {
	accountId: string;
	satisfiesRequestedAt: string;
	queuePriority: number;
	progress: EnrichmentChunkProgress;
}): Promise<Result<Job, DbError>> {
	const existing = await getActiveEnrichmentJob(opts.accountId);
	if (Result.isError(existing)) return existing;
	if (existing.value) return Result.ok(existing.value);

	const supabase = createAdminSupabaseClient();
	const created = await fromSupabaseSingle(
		supabase
			.from("job")
			.insert({
				account_id: opts.accountId,
				type: "enrichment" as JobType,
				status: "pending" as const,
				progress: enrichmentProgressToJson(opts.progress),
				satisfies_requested_at: opts.satisfiesRequestedAt,
				queue_priority: opts.queuePriority,
			})
			.select()
			.single(),
	);

	if (Result.isError(created) && created.error._tag === "ConstraintError") {
		const retry = await getActiveEnrichmentJob(opts.accountId);
		if (Result.isError(retry)) return retry;
		if (retry.value) return Result.ok(retry.value);
	}

	return created;
}

/**
 * Ensures a match_snapshot_refresh job exists for an account with scheduling metadata.
 * Reuses an active job if one exists; creates a new one otherwise.
 * Derives needsTargetSongEnrichment from current DB state at ensure time.
 */
export async function ensureMatchSnapshotRefreshJob(opts: {
	accountId: string;
	satisfiesRequestedAt: string;
	queuePriority: number;
	needsTargetSongEnrichment: boolean;
}): Promise<Result<Job, DbError>> {
	const existing = await getActiveJob(opts.accountId, "match_snapshot_refresh");
	if (Result.isError(existing)) return existing;
	if (existing.value) return Result.ok(existing.value);

	const supabase = createAdminSupabaseClient();
	const created = await fromSupabaseSingle(
		supabase
			.from("job")
			.insert({
				account_id: opts.accountId,
				type: "match_snapshot_refresh" as JobType,
				status: "pending" as const,
				progress: matchSnapshotRefreshProgressToJson(
					opts.needsTargetSongEnrichment,
				),
				satisfies_requested_at: opts.satisfiesRequestedAt,
				queue_priority: opts.queuePriority,
			})
			.select()
			.single(),
	);

	if (Result.isError(created) && created.error._tag === "ConstraintError") {
		const retry = await getActiveJob(opts.accountId, "match_snapshot_refresh");
		if (Result.isError(retry)) return retry;
		if (retry.value) return Result.ok(retry.value);
	}

	return created;
}

/**
 * Claims the next pending library-processing job via unified claim RPC.
 * Returns enrichment or match_snapshot_refresh jobs ordered by
 * queue_priority DESC, created_at ASC.
 */
export async function claimLibraryProcessingJob(): Promise<
	Result<Job | null, DbError>
> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"claim_pending_library_processing_job",
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!data || (Array.isArray(data) && data.length === 0)) {
		return Result.ok(null);
	}

	const job = Array.isArray(data) ? data[0] : data;
	return Result.ok(job as Job);
}

/**
 * Sweeps stale library-processing jobs (enrichment + match_snapshot_refresh).
 */
export async function sweepStaleLibraryProcessingJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"sweep_stale_library_processing_jobs",
		{ stale_threshold: staleThreshold },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}

/**
 * Marks stale library-processing jobs as failed.
 */
export async function markDeadLibraryProcessingJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"mark_dead_library_processing_jobs",
		{ stale_threshold: staleThreshold },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}
