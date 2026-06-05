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
