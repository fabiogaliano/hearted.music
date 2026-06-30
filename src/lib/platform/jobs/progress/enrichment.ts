import { z } from "zod";
import { JobProgressBaseSchema, StageProgressSchema } from "./base";

const ENRICHMENT_STAGE_NAMES = [
	"audio_features",
	"genre_tagging",
	"song_analysis",
	"song_embedding",
	"content_activation",
] as const;

const EnrichmentStageNameSchema = z.enum(ENRICHMENT_STAGE_NAMES);

// .catch("normal") handles both undefined (schema default) and unknown string values
// from old in-flight jobs, so stale progress always deserializes to a valid mode.
const EnrichmentSelectionModeSchema = z
	.enum(["normal", "first_match_bootstrap"])
	.catch("normal");
export type EnrichmentSelectionMode = z.infer<
	typeof EnrichmentSelectionModeSchema
>;

const EnrichmentStageProgressMapSchema = z
	.object({
		audio_features: StageProgressSchema,
		genre_tagging: StageProgressSchema,
		song_analysis: StageProgressSchema,
		song_embedding: StageProgressSchema,
		content_activation: StageProgressSchema,
	})
	.partial();
export type EnrichmentStageProgressMap = z.infer<
	typeof EnrichmentStageProgressMapSchema
>;

export const EnrichmentChunkProgressSchema = JobProgressBaseSchema.extend({
	currentStage: EnrichmentStageNameSchema.optional(),
	stages: EnrichmentStageProgressMapSchema.default({}),
	batchSize: z.number().int().min(0),
	batchSequence: z.number().int().min(0),
	selectionMode: EnrichmentSelectionModeSchema,
});
export type EnrichmentChunkProgress = z.infer<
	typeof EnrichmentChunkProgressSchema
>;

export function createPendingEnrichmentStages(): Required<EnrichmentStageProgressMap> {
	return {
		audio_features: { status: "pending", succeeded: 0, failed: 0 },
		genre_tagging: { status: "pending", succeeded: 0, failed: 0 },
		song_analysis: { status: "pending", succeeded: 0, failed: 0 },
		song_embedding: { status: "pending", succeeded: 0, failed: 0 },
		content_activation: { status: "pending", succeeded: 0, failed: 0 },
	};
}
