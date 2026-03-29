import { z } from "zod";
import { JobProgressBaseSchema, StageProgressSchema } from "./base";

export const ENRICHMENT_STAGE_NAMES = [
	"audio_features",
	"genre_tagging",
	"song_analysis",
	"song_embedding",
] as const;

export const EnrichmentStageNameSchema = z.enum(ENRICHMENT_STAGE_NAMES);
export type EnrichmentStageName = z.infer<typeof EnrichmentStageNameSchema>;

export const EnrichmentStageProgressMapSchema = z
	.object({
		audio_features: StageProgressSchema,
		genre_tagging: StageProgressSchema,
		song_analysis: StageProgressSchema,
		song_embedding: StageProgressSchema,
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
	};
}
