import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import {
	earliestAvailableAt,
	latestRequestedAt,
	maxQueuePriority,
	mergeMatchRefreshProgress,
} from "@/lib/platform/jobs/match-refresh-merge";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/enrichment";
import { createInitialMatchSnapshotRefreshProgress } from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import {
	getActiveJob,
	type Job,
	type JobType,
} from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

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
	return createInitialMatchSnapshotRefreshProgress({
		needsTargetSongEnrichment,
	});
}

export function getActiveEnrichmentJob(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	return getActiveJob(accountId, "enrichment");
}

export async function createEnrichmentJob(
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
		const retry = await getActiveEnrichmentJob(accountId);
		if (Result.isError(retry)) return retry;
		if (retry.value) return Result.ok(retry.value);
	}

	return created;
}

export async function ensureEnrichmentJob(opts: {
	accountId: string;
	satisfiesRequestedAt: string;
	queuePriority: number;
	progress: EnrichmentChunkProgress;
}): Promise<Result<Job, DbError>> {
	let lastError: Result<Job, DbError> | undefined;

	for (let attempt = 0; attempt < 2; attempt++) {
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

		if (Result.isOk(created)) return created;
		if (created.error._tag !== "ConstraintError") return created;
		lastError = created;
	}

	return (
		lastError ??
		Result.err(
			new DatabaseError({
				code: "library_processing_job_ensure_failed",
				message:
					"Failed to ensure enrichment job after retrying constraint races",
			}),
		)
	);
}

export async function ensureMatchSnapshotRefreshJob(opts: {
	accountId: string;
	satisfiesRequestedAt: string;
	queuePriority: number;
	needsTargetSongEnrichment: boolean;
	availableAt: string;
}): Promise<Result<Job, DbError>> {
	let lastError: Result<Job, DbError> | undefined;

	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await getActiveJob(
			opts.accountId,
			"match_snapshot_refresh",
		);
		if (Result.isError(existing)) return existing;

		if (existing.value) {
			// Running jobs are claimed and executing — leave them alone.
			if (existing.value.status === "running") {
				return Result.ok(existing.value);
			}

			// Pending job: merge the new request into the existing one so repeated
			// triggers coalesce rather than queuing multiple refreshes.
			// The available_at update is the pull-forward mechanism: an immediate
			// trigger (availableAt = now) can overtake a debounced job.
			const mergedProgress = mergeMatchRefreshProgress(
				existing.value.progress,
				opts.needsTargetSongEnrichment,
			);

			const supabase = createAdminSupabaseClient();
			const updated = await fromSupabaseMaybe(
				supabase
					.from("job")
					.update({
						satisfies_requested_at: latestRequestedAt(
							existing.value.satisfies_requested_at,
							opts.satisfiesRequestedAt,
						),
						queue_priority: maxQueuePriority(
							existing.value.queue_priority,
							opts.queuePriority,
						),
						available_at: earliestAvailableAt(
							existing.value.available_at,
							opts.availableAt,
						),
						progress: mergedProgress as unknown as Json,
					})
					.eq("id", existing.value.id)
					.eq("status", "pending")
					.select()
					.single(),
			);

			if (Result.isError(updated)) return updated;
			// null means the job was claimed (moved to running) between our read and
			// the update — loop to re-read and act on the new state.
			if (updated.value !== null) return Result.ok(updated.value);
			continue;
		}

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
					available_at: opts.availableAt,
				})
				.select()
				.single(),
		);

		if (Result.isOk(created)) return created;
		if (created.error._tag !== "ConstraintError") return created;
		lastError = created;
	}

	return (
		lastError ??
		Result.err(
			new DatabaseError({
				code: "library_processing_job_ensure_failed",
				message:
					"Failed to ensure match snapshot refresh job after retrying constraint races",
			}),
		)
	);
}

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
