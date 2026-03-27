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
import type { Enums, Tables } from "./database.types";

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
				progress: progress as any,
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
 * Claims the next pending enrichment job via database RPC.
 * The RPC atomically transitions the job to 'running' and assigns it.
 * Returns null if no pending enrichment job is available.
 */
export async function claimEnrichmentJob(): Promise<
	Result<Job | null, DbError>
> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("claim_pending_enrichment_job");

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

/**
 * Sweeps stale enrichment jobs back to pending so they can be re-claimed.
 * Calls the sweep_stale_enrichment_jobs RPC with a Postgres interval threshold.
 */
export async function sweepStaleEnrichmentJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("sweep_stale_enrichment_jobs", {
		stale_threshold: staleThreshold,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}

/**
 * Marks enrichment jobs as failed if they've been stale beyond recovery.
 * Calls the mark_dead_enrichment_jobs RPC with a Postgres interval threshold.
 */
export async function markDeadEnrichmentJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("mark_dead_enrichment_jobs", {
		stale_threshold: staleThreshold,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}

// ---------------------------------------------------------------------------
// Target-playlist refresh job helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new target-playlist match refresh job in pending status.
 * Stores a TargetPlaylistRefreshPlan in progress for the orchestrator.
 */
export function createTargetPlaylistMatchRefreshJob(
	accountId: string,
	progress?: JobProgress,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	const initialProgress: JobProgress = progress ?? {
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
				type: "target_playlist_match_refresh" as JobType,
				status: "pending" as const,
				progress: initialProgress,
			})
			.select()
			.single(),
	);
}

/**
 * Gets or creates a target-playlist match refresh job for an account.
 * Reuses an existing active (pending/running) job if one exists.
 * When reusing, sets rerunRequested in progress so the worker runs an extra pass.
 */
export async function getOrCreateTargetPlaylistMatchRefreshJob(
	accountId: string,
	progress?: JobProgress,
): Promise<Result<Job, DbError>> {
	const existing = await getActiveJob(
		accountId,
		"target_playlist_match_refresh",
	);
	if (Result.isError(existing)) return existing;
	if (existing.value) {
		const job = existing.value;
		const currentProgress = (job.progress ?? {}) as Record<string, unknown>;
		const nextPlan = (progress as Record<string, unknown> | undefined)?.plan as
			| Record<string, unknown>
			| undefined;
		const currentPlan = currentProgress.plan as
			| Record<string, unknown>
			| undefined;
		const shouldEnrichTargetPlaylistSongs =
			nextPlan?.shouldEnrichTargetPlaylistSongs === true ||
			currentPlan?.shouldEnrichTargetPlaylistSongs === true;

		const updateResult = await updateJobProgress(job.id, {
			...currentProgress,
			plan: nextPlan
				? {
						...currentPlan,
						...nextPlan,
						shouldEnrichTargetPlaylistSongs,
					}
				: currentPlan,
			rerunRequested: true,
		} as any);
		if (Result.isError(updateResult)) return updateResult;
		return Result.ok(job);
	}

	const created = await createTargetPlaylistMatchRefreshJob(
		accountId,
		progress,
	);

	if (Result.isError(created) && created.error._tag === "ConstraintError") {
		const retry = await getActiveJob(
			accountId,
			"target_playlist_match_refresh",
		);
		if (Result.isError(retry)) return retry;
		if (retry.value) return Result.ok(retry.value);
	}

	return created;
}

/**
 * Claims the next pending target-playlist match refresh job via database RPC.
 * Returns null if no pending job is available.
 */
export async function claimTargetPlaylistMatchRefreshJob(): Promise<
	Result<Job | null, DbError>
> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await (supabase.rpc as any)(
		"claim_pending_target_playlist_match_refresh_job",
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
 * Sweeps stale target-playlist refresh jobs back to pending.
 */
export async function sweepStaleTargetPlaylistMatchRefreshJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await (supabase.rpc as any)(
		"sweep_stale_target_playlist_match_refresh_jobs",
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
 * Marks target-playlist refresh jobs as failed if stale beyond recovery.
 */
export async function markDeadTargetPlaylistMatchRefreshJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await (supabase.rpc as any)(
		"mark_dead_target_playlist_match_refresh_jobs",
		{ stale_threshold: staleThreshold },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}
