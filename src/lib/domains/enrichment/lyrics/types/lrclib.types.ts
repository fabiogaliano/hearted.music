import { z } from "zod";

export const LrclibTrackSchema = z.object({
	id: z.number(),
	trackName: z.string(),
	artistName: z.string(),
	albumName: z.string(),
	duration: z.number(),
	instrumental: z.boolean(),
	plainLyrics: z.string().nullable(),
	syncedLyrics: z.string().nullable(),
});

export type LrclibTrack = z.infer<typeof LrclibTrackSchema>;

// LRCLIB returns this body with HTTP 404 when no track is found
export const LrclibNotFoundSchema = z.object({
	code: z.literal(404),
	name: z.literal("TrackNotFound"),
});

export type LrclibNotFound = z.infer<typeof LrclibNotFoundSchema>;

// /api/search returns an array of tracks
export const LrclibSearchResponseSchema = z.array(LrclibTrackSchema);

export type LrclibSearchResponse = z.infer<typeof LrclibSearchResponseSchema>;
