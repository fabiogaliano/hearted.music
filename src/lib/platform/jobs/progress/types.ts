import { z } from "zod";

export {
	type StageProgress as EnrichmentStageProgress,
	StageProgressSchema as EnrichmentStageProgressSchema,
	type StageStatus as EnrichmentStageStatus,
	StageStatusSchema as EnrichmentStageStatusSchema,
} from "./base";
export {
	createPendingEnrichmentStages,
	type EnrichmentChunkProgress,
	EnrichmentChunkProgressSchema,
	type EnrichmentStageName,
	EnrichmentStageNameSchema,
} from "./enrichment";

export const JobStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TERMINAL_JOB_STATUSES = ["completed", "failed"] as const;
export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export const JobProgressSchema = z.object({
	total: z.number().int().min(0),
	done: z.number().int().min(0),
	succeeded: z.number().int().min(0),
	failed: z.number().int().min(0),
	cursor: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobItemStatusSchema = z.enum([
	"queued",
	"in_progress",
	"succeeded",
	"failed",
]);
export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;

export const JobItemKindSchema = z.enum(["song", "playlist", "match"]);
export type JobItemKind = z.infer<typeof JobItemKindSchema>;

export const JobProgressEventSchema = z.object({
	type: z.literal("progress"),
	done: z.number(),
	total: z.number(),
	succeeded: z.number(),
	failed: z.number(),
});
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;

export const JobStatusEventSchema = z.object({
	type: z.literal("status"),
	status: JobStatusSchema,
});
export type JobStatusEvent = z.infer<typeof JobStatusEventSchema>;

export const JobItemEventSchema = z.object({
	type: z.literal("item"),
	itemId: z.string(),
	itemKind: JobItemKindSchema,
	status: JobItemStatusSchema,
	label: z.string().optional(),
	index: z.number().optional(),
	count: z.number().optional(),
	total: z.number().optional(),
});
export type JobItemEvent = z.infer<typeof JobItemEventSchema>;

export const JobErrorEventSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type JobErrorEvent = z.infer<typeof JobErrorEventSchema>;

export const JobEventSchema = z.discriminatedUnion("type", [
	JobProgressEventSchema,
	JobStatusEventSchema,
	JobItemEventSchema,
	JobErrorEventSchema,
]);
export type JobEvent = z.infer<typeof JobEventSchema>;

export function serializeSSEEvent(event: JobEvent): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

export function serializeSSEPing(): string {
	return ": ping\n\n";
}

export function parseSSEEvent(data: string): JobEvent | null {
	try {
		const parsed = JSON.parse(data);
		const result = JobEventSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export const PhaseJobIdsSchema = z.object({
	liked_songs: z.uuid(),
	playlists: z.uuid(),
	playlist_tracks: z.uuid(),
});
export type PhaseJobIds = z.infer<typeof PhaseJobIdsSchema>;
