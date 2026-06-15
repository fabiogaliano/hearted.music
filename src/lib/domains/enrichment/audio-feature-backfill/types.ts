/**
 * Domain types for the audio-feature backfill: DB row aliases, the shared
 * availability state model, and the structured error codes stored on jobs.
 */

import type { Tables } from "@/lib/data/database.types";

export type BackfillJob = Tables<"audio_feature_backfill_job">;
export type AudioFeatureSourceReview = Tables<"audio_feature_source_review">;

export type AudioFeatureAvailabilityState =
	| "ready"
	| "backfill_active"
	| "manual_needed"
	| "unavailable_terminal"
	| "absent";

/** Per-song availability, the one model every pipeline decision reads. */
export type AudioFeatureAvailability =
	| { state: "ready"; songId: string; audioFeatureId: string }
	| { state: "backfill_active"; songId: string; jobId: string }
	| {
			state: "manual_needed";
			songId: string;
			jobId: string;
			errorCode: string | null;
	  }
	| {
			state: "unavailable_terminal";
			songId: string;
			jobId: string;
			errorCode: string | null;
	  }
	| { state: "absent"; songId: string };

export type AudioBackfillErrorCode =
	| "yt_dlp_unavailable"
	| "yt_search_no_candidates"
	| "yt_search_low_confidence"
	| "yt_download_failed"
	| "ffprobe_invalid_audio"
	| "ffmpeg_clip_failed"
	| "reccobeats_rate_limited"
	| "reccobeats_transient"
	| "source_missing"
	| "provider_busy"
	| "db_write_failed";

export const RECCOBEATS_FILE_PROVIDER = "reccobeats_file_analysis";
