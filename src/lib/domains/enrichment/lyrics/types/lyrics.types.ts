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

export interface LyricsSection {
	type: string;
	lines: { id: number; text: string }[];
	annotationLinks: {
		[url: string]: number[];
	};
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
