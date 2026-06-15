/**
 * DB layer for audio_feature_source_review (provenance for backfilled features).
 * The control panel reads/acts on these rows via its own local SQL; this module
 * is the worker's write path when a feature is inserted.
 */

import type { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { TablesInsert } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseSingle } from "@/lib/shared/utils/result-wrappers/supabase";
import type { AudioFeatureSourceReview } from "./types";

export interface InsertSourceReviewInput {
	songId: string;
	audioFeatureId: string;
	backfillJobId: string | null;
	sourceType: "youtube_search" | "youtube_url";

	youtubeVideoId: string | null;
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

	clipStartsSeconds: number[];
	clipFeatures: unknown;
	averagedFeatures: unknown;
	aggregationMetadata: unknown;

	/** Auto-search rows land `pending`; operator URL rows land `approved`. */
	status: "pending" | "approved";
	reviewedBy: string | null;
}

export function insertSourceReview(
	input: InsertSourceReviewInput,
): Promise<Result<AudioFeatureSourceReview, DbError>> {
	const supabase = createAdminSupabaseClient();
	const row: TablesInsert<"audio_feature_source_review"> = {
		song_id: input.songId,
		audio_feature_id: input.audioFeatureId,
		backfill_job_id: input.backfillJobId,
		source_type: input.sourceType,
		youtube_video_id: input.youtubeVideoId,
		youtube_url: input.youtubeUrl,
		youtube_title: input.youtubeTitle,
		youtube_channel: input.youtubeChannel,
		youtube_duration_seconds: input.youtubeDurationSeconds,
		youtube_thumbnail_url: input.youtubeThumbnailUrl,
		search_query: input.searchQuery,
		candidate_rank: input.candidateRank,
		match_score: input.matchScore,
		match_reasons: input.matchReasons,
		rejected_candidates: input.rejectedCandidates as never,
		clip_starts_seconds: input.clipStartsSeconds,
		clip_features: input.clipFeatures as never,
		averaged_features: input.averagedFeatures as never,
		aggregation_metadata: input.aggregationMetadata as never,
		status: input.status,
		reviewed_by: input.reviewedBy,
		reviewed_at: input.status === "approved" ? new Date().toISOString() : null,
	};

	return fromSupabaseSingle(
		supabase.from("audio_feature_source_review").insert(row).select().single(),
	);
}
