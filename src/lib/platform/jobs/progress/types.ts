import { z } from "zod";

export const JobProgressSchema = z.object({
	total: z.number().int().min(0),
	done: z.number().int().min(0),
	succeeded: z.number().int().min(0),
	failed: z.number().int().min(0),
	cursor: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const PhaseJobIdsSchema = z.object({
	liked_songs: z.uuid(),
	playlists: z.uuid(),
	playlist_tracks: z.uuid(),
});
export type PhaseJobIds = z.infer<typeof PhaseJobIdsSchema>;
