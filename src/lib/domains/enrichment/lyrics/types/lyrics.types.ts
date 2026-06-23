import { z } from "zod";

// Application-specific types for lyrics processing
export interface AnnotationInfo {
	text: string;
	verified: boolean;
	votes_total: number;
	pinnedRole?: string;
	/** Genius review state: "verified" | "accepted" | "pending". Optional for backward compat with rows stored before this field was added. */
	state?: string;
	/** Stable Genius annotation id. Lets distillation/dedup key on annotation identity rather than fragile text-normalization. Optional for rows stored before this field was added. */
	geniusAnnotationId?: number;
}

/**
 * A single lyric line in the stored/formatted document, optionally carrying the
 * annotations placed on it.
 */
export interface TransformedLine {
	id: number;
	text: string;
	annotations?: AnnotationInfo[];
}

/**
 * The canonical document shape stored in song_lyrics.document and consumed by the
 * formatter and content-analysis. With LRCLIB as the lyric source there is a
 * single section ("lyrics"); the shape is kept multi-section for the stored
 * envelope's stability.
 */
export interface TransformedLyricsBySection {
	type: string;
	lines: TransformedLine[];
}

// Discriminated union describing every terminal result a lyrics fetch can produce.
// "lyrics" carries the resolved text, "instrumental" records which signal decided,
// and "not_found" means all providers returned no record for the track.
export const LyricsOutcomeSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("lyrics"),
		text: z.string(),
		source: z.enum(["lrclib", "genius"]),
		confidence: z.number(),
	}),
	z.object({
		kind: z.literal("instrumental"),
		source: z.enum(["lrclib", "genius_page"]),
	}),
	z.object({
		kind: z.literal("not_found"),
	}),
]);

export type LyricsOutcome = z.infer<typeof LyricsOutcomeSchema>;
