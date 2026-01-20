// Application-specific types for lyrics processing
export interface AnnotationInfo {
	text: string
	verified: boolean
	votes_total: number
	pinnedRole?: string
}

export interface LyricsSection {
	type: string
	lines: { id: number; text: string }[]
	annotationLinks: {
		[url: string]: number[]
	}
}

export interface TransformedLine {
	id: number
	text: string
	range?: {
		start: number
		end: number
	}
	annotations?: AnnotationInfo[]
}

export interface TransformedSection {
	type: string
	lines: TransformedLine[]
}

export interface GeniusLyricsOptions {
	accessToken: string
}
