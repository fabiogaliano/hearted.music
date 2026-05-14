// Application-specific types for lyrics processing
export interface AnnotationInfo {
	text: string;
	verified: boolean;
	votes_total: number;
	pinnedRole?: string;
}

export interface LyricsSection {
	type: string;
	lines: { id: number; text: string }[];
	annotationLinks: {
		[url: string]: number[];
	};
}
