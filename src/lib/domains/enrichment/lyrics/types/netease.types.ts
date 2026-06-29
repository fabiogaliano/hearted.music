import { z } from "zod";

/**
 * NetEase Cloud Music (music.163.com) response schemas.
 *
 * These mirror the app-internal endpoints `/api/search/get` and
 * `/api/song/lyric` — undocumented and not a public API, so the schemas are
 * deliberately lenient: only the fields we consume are required, and unknown
 * keys are stripped by zod's default object behavior. Every response carries a
 * top-level numeric `code` (200 on success; negative values such as -460
 * "Cheating" signal an IP/region block).
 */

// A single song hit from /api/search/get. `duration` is in milliseconds.
export const NeteaseSongSchema = z.object({
	id: z.number(),
	name: z.string(),
	// Each artist object carries many fields; we only need the display name.
	artists: z.array(z.object({ name: z.string() })).default([]),
	// Some hits omit the album object entirely; it is informational only here.
	album: z.object({ name: z.string() }).optional(),
	duration: z.number(),
});

export type NeteaseSong = z.infer<typeof NeteaseSongSchema>;

export const NeteaseSearchResponseSchema = z.object({
	code: z.number(),
	// `result` is absent on a hard error; `songs` is absent on a zero-hit search
	// (only `songCount: 0` is returned), so both are optional.
	result: z
		.object({
			songs: z.array(NeteaseSongSchema).optional(),
			songCount: z.number().optional(),
		})
		.optional(),
});

export type NeteaseSearchResponse = z.infer<typeof NeteaseSearchResponseSchema>;

// /api/song/lyric response. `lrc.lyric` is the synced LRC; `nolyric` flags a
// pure-music track and `uncollected` flags a track with no lyrics on file.
export const NeteaseLyricResponseSchema = z.object({
	code: z.number(),
	lrc: z.object({ lyric: z.string().nullable().optional() }).optional(),
	nolyric: z.boolean().optional(),
	uncollected: z.boolean().optional(),
});

export type NeteaseLyricResponse = z.infer<typeof NeteaseLyricResponseSchema>;
