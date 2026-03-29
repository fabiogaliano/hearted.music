import { z } from "zod";
import type { MatchSnapshotRefreshPlan } from "@/lib/workflows/match-snapshot-refresh/types";
import { MatchSnapshotRefreshPlanSchema } from "@/lib/workflows/match-snapshot-refresh/types";
import { JobProgressBaseSchema, StageProgressSchema } from "./base";

export const MATCH_REFRESH_STAGE_NAMES = [
	"target_song_enrichment",
	"playlist_profiling",
	"candidate_loading",
	"matching",
	"publishing",
] as const;

export const MatchRefreshStageNameSchema = z.enum(MATCH_REFRESH_STAGE_NAMES);
export type MatchRefreshStageName = z.infer<typeof MatchRefreshStageNameSchema>;

export const MatchSnapshotRefreshStageProgressMapSchema = z
	.object({
		target_song_enrichment: StageProgressSchema,
		playlist_profiling: StageProgressSchema,
		candidate_loading: StageProgressSchema,
		matching: StageProgressSchema,
		publishing: StageProgressSchema,
	})
	.partial();
export type MatchSnapshotRefreshStageProgressMap = z.infer<
	typeof MatchSnapshotRefreshStageProgressMapSchema
>;

export const MatchSnapshotRefreshProgressSchema = JobProgressBaseSchema.extend({
	currentStage: MatchRefreshStageNameSchema.optional(),
	stages: MatchSnapshotRefreshStageProgressMapSchema.default({}),
	plan: MatchSnapshotRefreshPlanSchema.optional(),
	playlistCount: z.number().int().min(0).optional(),
	candidateCount: z.number().int().min(0).optional(),
	matchedSongCount: z.number().int().min(0).optional(),
	published: z.boolean().optional(),
	noOp: z.boolean().optional(),
	isEmpty: z.boolean().optional(),
});
export type MatchSnapshotRefreshProgress = z.infer<
	typeof MatchSnapshotRefreshProgressSchema
>;

export function createPendingMatchRefreshStages(): Required<MatchSnapshotRefreshStageProgressMap> {
	return {
		target_song_enrichment: {
			status: "pending",
			succeeded: 0,
			failed: 0,
		},
		playlist_profiling: { status: "pending", succeeded: 0, failed: 0 },
		candidate_loading: { status: "pending", succeeded: 0, failed: 0 },
		matching: { status: "pending", succeeded: 0, failed: 0 },
		publishing: { status: "pending", succeeded: 0, failed: 0 },
	};
}

export function createInitialMatchSnapshotRefreshProgress(
	plan: MatchSnapshotRefreshPlan,
): MatchSnapshotRefreshProgress {
	return {
		total: MATCH_REFRESH_STAGE_NAMES.length,
		done: 0,
		succeeded: 0,
		failed: 0,
		currentStage: undefined,
		stages: createPendingMatchRefreshStages(),
		plan,
	};
}
