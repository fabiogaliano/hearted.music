/**
 * Last.fm service type definitions.
 *
 * Uses Zod schemas for runtime validation of API responses.
 */

import { z } from "zod";

// ============================================================================
// Zod Schemas for API Response Validation
// ============================================================================

/** A tag (genre/descriptor) from Last.fm */
const LastFmTagSchema = z.object({
	name: z.string(),
	/** Relevance score 0-100 (higher = more relevant) */
	count: z.number().int().min(0).max(100),
	url: z.string(),
});
export type LastFmTag = z.infer<typeof LastFmTagSchema>;

/** Last.fm API error response */
export const LastFmErrorResponseSchema = z.object({
	error: z.number(),
	message: z.string(),
});

/** Response from album.getTopTags API endpoint */
export const LastFmAlbumTopTagsResponseSchema = z.object({
	toptags: z.object({
		tag: z.array(LastFmTagSchema),
		"@attr": z.object({ artist: z.string(), album: z.string() }),
	}),
});

/** Response from artist.getTopTags API endpoint */
export const LastFmArtistTopTagsResponseSchema = z.object({
	toptags: z.object({
		tag: z.array(LastFmTagSchema),
		"@attr": z.object({ artist: z.string() }),
	}),
});

// ============================================================================
// Domain Types (not used for parsing external responses)
// ============================================================================

/** Source level for genre lookup (track is most specific, artist is broadest) */
export type GenreSourceLevel = "track" | "album" | "artist";

/** Normalized genre lookup result */
export interface GenreLookupResult {
	/** Top genres (max 3) */
	readonly tags: string[];
	/** Genres with relevance scores */
	readonly tagsWithScores: ReadonlyArray<{
		readonly name: string;
		readonly score: number;
	}>;
	/** Which API level returned results */
	readonly sourceLevel: GenreSourceLevel;
	/** Always 'lastfm' for this service */
	readonly source: "lastfm";
}
