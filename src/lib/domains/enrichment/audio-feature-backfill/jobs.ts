/**
 * DB layer for audio_feature_backfill_job and the provider lease — thin Result
 * wrappers over the migration's RPCs. The selector, audio stage, analysis gate,
 * worker, and control panel all route through these so the state model has one
 * implementation.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";
import type { AudioFeatureAvailability, BackfillJob } from "./types";

function dbErr(error: { code?: string; message: string }): DbError {
	return new DatabaseError({
		code: error.code ?? "rpc_error",
		message: error.message,
	});
}

/** A function returning SETOF composite arrives as an array; single composite as
 * an object. Normalize both to the first row (or null). */
function firstRow<T>(data: unknown): T | null {
	if (Array.isArray(data)) return (data[0] as T) ?? null;
	return (data as T) ?? null;
}

export async function claimBackfillJobs(
	workerId: string,
	limit: number,
	leaseSeconds: number,
): Promise<Result<BackfillJob[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"claim_pending_audio_feature_backfill_job",
		{ p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds },
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as BackfillJob[]);
}

export async function enqueueSearchJob(
	songId: string,
	requestedByAccountId: string | null = null,
): Promise<Result<BackfillJob, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"enqueue_audio_feature_backfill_search",
		{
			p_song_id: songId,
			p_requested_by_account_id: requestedByAccountId ?? undefined,
		},
	);
	if (error) return Result.err(dbErr(error));
	const job = firstRow<BackfillJob>(data);
	if (!job) {
		return Result.err(
			new DatabaseError({
				code: "enqueue_no_row",
				message: "enqueue returned no job",
			}),
		);
	}
	return Result.ok(job);
}

export async function enqueueManualJob(
	songId: string,
	sourceUrl: string,
	requestedByAccountId: string | null = null,
): Promise<Result<BackfillJob, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"enqueue_audio_feature_backfill_manual",
		{
			p_song_id: songId,
			p_source_url: sourceUrl,
			p_requested_by_account_id: requestedByAccountId ?? undefined,
		},
	);
	if (error) return Result.err(dbErr(error));
	const job = firstRow<BackfillJob>(data);
	if (!job) {
		return Result.err(
			new DatabaseError({
				code: "enqueue_no_row",
				message: "manual enqueue returned no job",
			}),
		);
	}
	return Result.ok(job);
}

export async function getBackfillJobById(
	jobId: string,
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("audio_feature_backfill_job")
			.select("*")
			.eq("id", jobId)
			.single(),
	);
}

export async function completeJob(
	jobId: string,
	workerId: string,
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"complete_audio_feature_backfill_job",
		{ p_job_id: jobId, p_worker_id: workerId },
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<BackfillJob>(data));
}

export async function deferJob(
	jobId: string,
	workerId: string,
	retrySeconds: number,
	errorCode: string,
	errorMessage: string,
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"defer_audio_feature_backfill_job",
		{
			p_job_id: jobId,
			p_worker_id: workerId,
			p_retry_seconds: retrySeconds,
			p_error_code: errorCode,
			p_error_message: errorMessage,
		},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<BackfillJob>(data));
}

/**
 * Re-queue a job WITHOUT consuming a retry attempt or ever terminalizing it — for
 * guaranteed-transient, zero-work failures (currently just provider_busy, where the
 * ReccoBeats lease's 600s TTL makes contention always clear). See the RPC comment
 * in 20260701130000_backfill_repend_no_penalty.sql.
 */
export async function rependBackfillJob(
	jobId: string,
	workerId: string,
	retrySeconds: number,
	errorCode: string,
	errorMessage: string,
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"repend_audio_feature_backfill_job",
		{
			p_job_id: jobId,
			p_worker_id: workerId,
			p_retry_seconds: retrySeconds,
			p_error_code: errorCode,
			p_error_message: errorMessage,
		},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<BackfillJob>(data));
}

export async function markJobManualNeeded(
	jobId: string,
	workerId: string,
	errorCode: string,
	errorMessage: string,
	/** Scored candidate snapshots to persist on the stuck job (empty for the
	 * environment/validation manual paths that never ran a search). */
	candidates: unknown[] = [],
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"mark_audio_feature_backfill_manual_needed",
		{
			p_job_id: jobId,
			p_worker_id: workerId,
			p_error_code: errorCode,
			p_error_message: errorMessage,
			p_candidates: candidates as unknown as Json,
		},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<BackfillJob>(data));
}

export async function failJob(
	jobId: string,
	workerId: string,
	errorCode: string,
	errorMessage: string,
): Promise<Result<BackfillJob | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"fail_audio_feature_backfill_job",
		{
			p_job_id: jobId,
			p_worker_id: workerId,
			p_error_code: errorCode,
			p_error_message: errorMessage,
		},
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok(firstRow<BackfillJob>(data));
}

/** The 9 numeric features the file-analysis endpoint returns, stored on both the
 * feature row and the review's averaged_features. */
export interface SettleFeatures {
	acousticness: number;
	danceability: number;
	energy: number;
	instrumentalness: number;
	liveness: number;
	loudness: number;
	speechiness: number;
	tempo: number;
	valence: number;
}

export interface SettleBackfillInput {
	jobId: string;
	workerId: string;
	songId: string;
	sourceType: "youtube_search" | "youtube_url";
	features: SettleFeatures;
	reviewStatus: "pending" | "approved";
	reviewedBy: string | null;
	youtubeVideoId: string;
	youtubeUrl: string;
	youtubeTitle: string | null;
	youtubeChannel: string | null;
	youtubeDurationSeconds: number | null;
	youtubeThumbnailUrl: string | null;
	searchQuery: string | null;
	candidateRank: number | null;
	matchScore: number | null;
	matchReasons: string[];
	rejectedCandidates: unknown[];
	/** Full scored candidate set (viable + rejected) behind this match. */
	candidates: unknown[];
	clipStartsSeconds: number[];
	clipFeatures: unknown;
	aggregationMetadata: unknown;
}

export interface SettleOutcome {
	jobId: string;
	audioFeatureId: string | null;
	reviewId: string | null;
	/** youtube_search found a feature already existed: completed without writing. */
	didSkip: boolean;
}

/**
 * Atomic, fenced completion: feature upsert + review insert + job completion in
 * one DB transaction. Resolves to `null` when the fence rejected the write (the
 * job is no longer running/ours), to a SettleOutcome otherwise. A DB error means
 * the whole settlement (including completion) rolled back, so the caller must
 * defer rather than treat the job as done.
 */
export async function settleBackfillJob(
	input: SettleBackfillInput,
): Promise<Result<SettleOutcome | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"settle_audio_feature_backfill_job",
		{
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_song_id: input.songId,
			p_source_type: input.sourceType,
			p_features: input.features as unknown as Json,
			p_review_status: input.reviewStatus,
			p_reviewed_by: input.reviewedBy ?? undefined,
			p_youtube_video_id: input.youtubeVideoId,
			p_youtube_url: input.youtubeUrl,
			p_youtube_title: input.youtubeTitle ?? undefined,
			p_youtube_channel: input.youtubeChannel ?? undefined,
			p_youtube_duration_seconds: input.youtubeDurationSeconds ?? undefined,
			p_youtube_thumbnail_url: input.youtubeThumbnailUrl ?? undefined,
			p_search_query: input.searchQuery ?? undefined,
			p_candidate_rank: input.candidateRank ?? undefined,
			p_match_score: input.matchScore ?? undefined,
			p_match_reasons: input.matchReasons as unknown as Json,
			p_rejected_candidates: input.rejectedCandidates as unknown as Json,
			p_candidates: input.candidates as unknown as Json,
			p_clip_starts_seconds: input.clipStartsSeconds,
			p_clip_features: input.clipFeatures as Json,
			p_aggregation_metadata: input.aggregationMetadata as Json,
		},
	);
	if (error) return Result.err(dbErr(error));

	const row = firstRow<{
		job_id: string;
		audio_feature_id: string | null;
		review_id: string | null;
		did_skip: boolean;
	}>(data);
	if (!row) return Result.ok(null);

	return Result.ok({
		jobId: row.job_id,
		audioFeatureId: row.audio_feature_id,
		reviewId: row.review_id,
		didSkip: row.did_skip,
	});
}

export async function sweepStaleBackfillJobs(): Promise<
	Result<BackfillJob[], DbError>
> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"sweep_stale_audio_feature_backfill_jobs",
	);
	if (error) return Result.err(dbErr(error));
	return Result.ok((data ?? []) as BackfillJob[]);
}

export async function getAudioFeatureAvailability(
	songIds: string[],
): Promise<Result<AudioFeatureAvailability[], DbError>> {
	if (songIds.length === 0) return Result.ok([]);
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("get_audio_feature_availability", {
		p_song_ids: songIds,
	});
	if (error) return Result.err(dbErr(error));

	const rows = (data ?? []) as {
		song_id: string;
		state: string;
		audio_feature_id: string | null;
		job_id: string | null;
		error_code: string | null;
	}[];

	const out: AudioFeatureAvailability[] = [];
	for (const r of rows) {
		switch (r.state) {
			case "ready":
				out.push({
					state: "ready",
					songId: r.song_id,
					audioFeatureId: r.audio_feature_id ?? "",
				});
				break;
			case "backfill_active":
				out.push({
					state: "backfill_active",
					songId: r.song_id,
					jobId: r.job_id ?? "",
				});
				break;
			case "manual_needed":
				out.push({
					state: "manual_needed",
					songId: r.song_id,
					jobId: r.job_id ?? "",
					errorCode: r.error_code,
				});
				break;
			case "unavailable_terminal":
				out.push({
					state: "unavailable_terminal",
					songId: r.song_id,
					jobId: r.job_id ?? "",
					errorCode: r.error_code,
				});
				break;
			default:
				out.push({ state: "absent", songId: r.song_id });
		}
	}
	return Result.ok(out);
}

export async function acquireProviderLease(
	provider: string,
	holder: string,
	leaseSeconds: number,
): Promise<Result<boolean, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("acquire_provider_lease", {
		p_provider: provider,
		p_holder: holder,
		p_lease_seconds: leaseSeconds,
	});
	if (error) return Result.err(dbErr(error));
	return Result.ok(data === true);
}

export async function releaseProviderLease(
	provider: string,
	holder: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase.rpc("release_provider_lease", {
		p_provider: provider,
		p_holder: holder,
	});
	if (error) return Result.err(dbErr(error));
	return Result.ok(undefined);
}
