/**
 * Orchestrates one claimed audio-feature backfill job: check yt-dlp is present →
 * resolve source → analyze clips under the global ReccoBeats provider lease →
 * settle atomically (upsert feature + record provenance + complete the job in one
 * fenced DB transaction) → wake enrichment → clean up temp files.
 *
 * The fenced settlement RPC is what makes completion safe: it re-checks the job
 * lease (status='running' + locked_by) inside the same transaction that writes the
 * feature and review, so a cancelled or superseded worker can't overwrite the
 * singleton song_audio_feature row, and a review-insert failure rolls back the
 * feature write and the completion together — we never strand a live auto feature
 * with no pending review.
 */

import { rm } from "node:fs/promises";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	aggregateClipFeatures,
	analyzeClipsAll,
} from "@/lib/integrations/reccobeats/file-analysis";
import { audioFeatureBackfillConfig } from "@/lib/integrations/youtube-audio/config";
import { toCandidateSnapshots } from "@/lib/integrations/youtube-audio/scoring";
import { acquireSource } from "@/lib/integrations/youtube-audio/service";
import {
	checkYtDlpAvailable,
	summarizeYtDlpFailure,
} from "@/lib/integrations/youtube-audio/yt-dlp";
import { log } from "@/lib/observability/logger";
import {
	ReccoBeatsApiError,
	ReccoBeatsRateLimitError,
} from "@/lib/shared/errors/external/reccobeats";
import { FfmpegError } from "@/lib/shared/errors/external/youtube-audio";
import {
	acquireProviderLease,
	deferJob,
	failJob,
	markJobManualNeeded,
	releaseProviderLease,
	rependBackfillJob,
	settleBackfillJob,
} from "./jobs";
import type { BackfillJob } from "./types";
import { RECCOBEATS_FILE_PROVIDER } from "./types";
import { wakeEnrichmentForSong } from "./wake";

const PROVIDER_LEASE_SECONDS = 600;
const TRANSIENT_RETRY_SECONDS = 300;

export type ProcessOutcome =
	| "completed"
	| "manual_needed"
	| "deferred"
	| "failed"
	| "skipped";

export interface BackfillProcessOptions {
	proxy?: string;
	signal?: AbortSignal;
}

interface SongRow {
	id: string;
	name: string;
	artists: string[];
	album_name: string | null;
	duration_ms: number | null;
	spotify_id: string;
	image_url: string | null;
}

async function cleanup(jobDir: string): Promise<void> {
	await rm(jobDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Defer with backoff, then inspect the job the RPC returned: when attempts are
 * exhausted the defer terminalizes to `failed`, which is the end of the line for
 * automatic backfill. The selector hides backfill_active songs from analysis, so
 * a terminal transition must wake enrichment or the song waits forever.
 */
async function deferAndMaybeWake(
	job: BackfillJob,
	workerId: string,
	retrySeconds: number,
	errorCode: string,
	errorMessage: string,
): Promise<ProcessOutcome> {
	const deferred = await deferJob(
		job.id,
		workerId,
		retrySeconds,
		errorCode,
		errorMessage,
	);
	if (Result.isOk(deferred) && deferred.value?.status === "failed") {
		await wakeEnrichmentForSong(job.song_id);
		return "failed";
	}
	return "deferred";
}

export async function processBackfillJob(
	job: BackfillJob,
	workerId: string,
	options: BackfillProcessOptions = {},
): Promise<ProcessOutcome> {
	const jobDir = `${audioFeatureBackfillConfig.tmpDir}/${job.id}`;
	const supabase = createAdminSupabaseClient();
	const { proxy, signal } = options;

	const stopAfterLeaseLoss = (): ProcessOutcome => {
		log.warn("youtube-audio-backfill-lease-lost", {
			jobId: job.id,
			songId: job.song_id,
		});
		return "skipped";
	};

	try {
		const songResult = await supabase
			.from("song")
			.select(
				"id, name, artists, album_name, duration_ms, spotify_id, image_url",
			)
			.eq("id", job.song_id)
			.single();
		if (signal?.aborted) return stopAfterLeaseLoss();
		if (songResult.error || !songResult.data) {
			await failJob(job.id, workerId, "source_missing", "song row not found");
			await wakeEnrichmentForSong(job.song_id);
			return "failed";
		}
		const song = songResult.data as SongRow;

		log.info("youtube-audio-backfill-claimed", {
			jobId: job.id,
			songId: job.song_id,
			sourceType: job.source_type,
		});

		// A missing yt-dlp binary is an environment problem retries won't fix, so
		// terminate as manual_needed (not db_write_failed) and surface it.
		const ytDlp = await checkYtDlpAvailable(signal);
		if (signal?.aborted) return stopAfterLeaseLoss();
		if (Result.isError(ytDlp)) {
			log.error("youtube-audio-yt-dlp-unavailable", {
				jobId: job.id,
				error: ytDlp.error.message,
			});
			await markJobManualNeeded(
				job.id,
				workerId,
				"yt_dlp_unavailable",
				ytDlp.error.message,
			);
			await wakeEnrichmentForSong(job.song_id);
			return "manual_needed";
		}

		// --- Resolve + download + clip ---------------------------------------
		const acquired = await acquireSource({
			sourceType: job.source_type as "youtube_search" | "youtube_url",
			sourceUrl: job.source_url,
			proxy,
			signal,
			song: {
				name: song.name,
				artists: song.artists,
				albumName: song.album_name,
				durationMs: song.duration_ms,
				spotifyId: song.spotify_id,
			},
			jobDir,
		});

		if (signal?.aborted) return stopAfterLeaseLoss();
		if (Result.isError(acquired)) {
			return settleAcquisitionError(job, workerId, acquired.error);
		}
		if (acquired.value.kind === "manual_needed") {
			log.info("youtube-audio-low-confidence", {
				jobId: job.id,
				songId: job.song_id,
				reason: acquired.value.reason,
			});
			await markJobManualNeeded(
				job.id,
				workerId,
				acquired.value.code,
				acquired.value.reason,
				toCandidateSnapshots(acquired.value.scored),
			);
			await wakeEnrichmentForSong(job.song_id);
			return "manual_needed";
		}

		const source = acquired.value;
		log.info("youtube-audio-candidate-selected", {
			jobId: job.id,
			videoId: source.candidate.videoId,
			score: source.matchScore,
			clips: source.clips.length,
		});

		// --- Analyze clips under the global provider lease -------------------
		const lease = await acquireProviderLease(
			RECCOBEATS_FILE_PROVIDER,
			workerId,
			PROVIDER_LEASE_SECONDS,
		);
		if (signal?.aborted) {
			if (Result.isOk(lease) && lease.value) {
				await releaseProviderLease(RECCOBEATS_FILE_PROVIDER, workerId);
			}
			return stopAfterLeaseLoss();
		}
		if (Result.isError(lease) || !lease.value) {
			// Couldn't acquire the ReccoBeats lease — the worker did zero song-specific
			// work, and the lease's 600s TTL makes contention always transient. Re-queue
			// WITHOUT a retry penalty so a burst of contention can't terminalize a good
			// song (the 2026-06-27 incident's 19 false unavailable_terminal). No terminal
			// transition happens here, so there's nothing to wake enrichment for.
			await rependBackfillJob(
				job.id,
				workerId,
				TRANSIENT_RETRY_SECONDS,
				"provider_busy",
				"reccobeats provider lease unavailable",
			);
			return "deferred";
		}

		let analysis: Awaited<ReturnType<typeof analyzeClipsAll>>;
		try {
			analysis = await analyzeClipsAll(source.clips, signal);
		} finally {
			await releaseProviderLease(RECCOBEATS_FILE_PROVIDER, workerId);
		}

		if (signal?.aborted) return stopAfterLeaseLoss();
		if (Result.isError(analysis)) {
			return settleReccoBeatsError(job, workerId, analysis.error);
		}

		log.info("youtube-audio-reccobeats-complete", {
			jobId: job.id,
			clips: analysis.value.length,
		});

		const { features, metadata } = aggregateClipFeatures(analysis.value, {
			tempoHalfDoubleTolerance:
				audioFeatureBackfillConfig.tempoHalfDoubleTolerance,
		});

		// --- Atomic fenced settlement ----------------------------------------
		// The RPC re-checks the fence, (for youtube_search) skips if a feature
		// landed meanwhile, upserts the feature, inserts the review, and completes
		// the job — all in one transaction.
		// Review status: manual URL rows are operator-vetted (approved). Search rows
		// auto-approve once their score clears autoApproveScore; below it they stay
		// pending for the control-panel queue. With autoApproveScore at the selection
		// floor, every selected match auto-approves — the search queue only fills if
		// that knob is raised above minScore.
		const isManual = job.source_type === "youtube_url";
		const autoApproved =
			!isManual &&
			source.matchScore != null &&
			source.matchScore >= audioFeatureBackfillConfig.autoApproveScore;
		const approved = isManual || autoApproved;
		const reviewedBy = isManual
			? "control-panel"
			: autoApproved
				? "auto-approve"
				: null;
		if (signal?.aborted) return stopAfterLeaseLoss();
		const settled = await settleBackfillJob({
			jobId: job.id,
			workerId,
			songId: job.song_id,
			sourceType: job.source_type as "youtube_search" | "youtube_url",
			features,
			reviewStatus: approved ? "approved" : "pending",
			reviewedBy,
			youtubeVideoId: source.candidate.videoId,
			youtubeUrl: source.candidate.url,
			youtubeTitle: source.candidate.title || null,
			youtubeChannel: source.candidate.channel,
			youtubeDurationSeconds: source.candidate.durationSeconds,
			youtubeThumbnailUrl: source.candidate.thumbnailUrl,
			searchQuery: source.searchQuery,
			candidateRank: source.candidateRank,
			matchScore: source.matchScore,
			matchReasons: source.matchReasons,
			rejectedCandidates: toCandidateSnapshots(
				source.scored.filter((s) => s.rejected),
			),
			candidates: toCandidateSnapshots(source.scored),
			clipStartsSeconds: source.clips.map((c) => c.startSeconds),
			clipFeatures: analysis.value.map((a) => a.features),
			aggregationMetadata: metadata,
		});

		if (Result.isError(settled)) {
			// The whole transaction rolled back: no feature, no review, not
			// completed. Defer so it retries (or terminalizes + wakes).
			return deferAndMaybeWake(
				job,
				workerId,
				TRANSIENT_RETRY_SECONDS,
				"db_write_failed",
				settled.error.message,
			);
		}
		if (settled.value === null) {
			// Fence rejected (cancelled/superseded). The RPC wrote nothing.
			log.warn("youtube-audio-backfill-fenced", {
				jobId: job.id,
				songId: job.song_id,
			});
			return "skipped";
		}
		if (settled.value.didSkip) {
			// A feature already existed (catalog landed, or a manual replacement
			// won), so the job completed without writing. It just left
			// backfill_active and the song is now `ready`, so wake enrichment to let
			// analysis run on the existing feature. Idempotent, so safe even though
			// the other writer likely woke it too.
			log.info("youtube-audio-backfill-skip-existing", {
				jobId: job.id,
				songId: job.song_id,
			});
			await wakeEnrichmentForSong(job.song_id);
			return "skipped";
		}

		log.info("youtube-audio-feature-upserted", {
			jobId: job.id,
			songId: job.song_id,
			audioFeatureId: settled.value.audioFeatureId,
		});
		log.info("youtube-audio-review-created", {
			jobId: job.id,
			reviewId: settled.value.reviewId,
			status: approved ? "approved" : "pending",
			reviewedBy,
		});

		// Clear any stale pre-backfill source_not_found suppression for this song.
		await supabase
			.from("job_item_failure")
			.update({ resolved_at: new Date().toISOString() })
			.eq("item_id", job.song_id)
			.eq("item_type", "song")
			.eq("stage", "audio_features")
			.eq("is_terminal", false)
			.is("resolved_at", null);

		await wakeEnrichmentForSong(job.song_id);
		return "completed";
	} catch (err) {
		if (signal?.aborted) return stopAfterLeaseLoss();
		log.error("youtube-audio-backfill-failed", {
			jobId: job.id,
			error: String(err),
		});
		return deferAndMaybeWake(
			job,
			workerId,
			TRANSIENT_RETRY_SECONDS,
			"db_write_failed",
			String(err),
		);
	} finally {
		await cleanup(jobDir);
	}
}

/** yt-dlp / ffmpeg errors: unusable-source validation → manual; the rest retry. */
async function settleAcquisitionError(
	job: BackfillJob,
	workerId: string,
	error: { _tag: string; code: string; message: string; stderr?: string },
): Promise<ProcessOutcome> {
	const validationCodes = new Set([
		"no_audio_stream",
		"duration_invalid",
		"too_large",
	]);
	if (error instanceof FfmpegError && validationCodes.has(error.code)) {
		await markJobManualNeeded(
			job.id,
			workerId,
			"ffprobe_invalid_audio",
			error.message,
		);
		await wakeEnrichmentForSong(job.song_id);
		return "manual_needed";
	}

	const code =
		error._tag === "FfmpegError" ? "ffmpeg_clip_failed" : "yt_download_failed";
	// Persist yt-dlp/ffmpeg's real stderr line (e.g. "Sign in to confirm you're
	// not a bot", "This video is not available") into the stored message. Without
	// this the coarse code was all we kept, so every download failure read as an
	// opaque "yt-dlp download failed". Mirrors the hydrate path's summary.
	const detail = summarizeYtDlpFailure(error.stderr);
	const message = detail ? `${error.message}: ${detail}` : error.message;
	return deferAndMaybeWake(
		job,
		workerId,
		TRANSIENT_RETRY_SECONDS,
		code,
		message,
	);
}

/** ReccoBeats errors: rate-limit/transient defer with backoff; honor Retry-After. */
async function settleReccoBeatsError(
	job: BackfillJob,
	workerId: string,
	error: unknown,
): Promise<ProcessOutcome> {
	if (error instanceof ReccoBeatsRateLimitError) {
		const retrySeconds = error.retryAfterMs
			? Math.ceil(error.retryAfterMs / 1000)
			: TRANSIENT_RETRY_SECONDS;
		return deferAndMaybeWake(
			job,
			workerId,
			retrySeconds,
			"reccobeats_rate_limited",
			error.message,
		);
	}
	const message =
		error instanceof ReccoBeatsApiError ? error.message : String(error);
	return deferAndMaybeWake(
		job,
		workerId,
		TRANSIENT_RETRY_SECONDS,
		"reccobeats_transient",
		message,
	);
}
