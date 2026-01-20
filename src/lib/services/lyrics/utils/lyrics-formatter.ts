/**
 * Compact Lyrics Formatter
 *
 * Converts TransformedLyricsBySection[] to a token-efficient text format
 * for LLM consumption. Preserves annotation linkage while reducing tokens
 * by ~40-50% compared to JSON.stringify.
 *
 * Output format:
 * [Section Name]
 * Lyric line one
 *   > [Artist] Songwriter's explanation of the line...
 * Lyric line two
 *   > [Verified, 45 votes] Community-verified annotation...
 * Lyric line three
 *   > [21 votes] Community annotation with enough votes...
 */
import type { AnnotationInfo } from "../types/lyrics.types";
import type { TransformedLyricsBySection } from "./lyrics-transformer";

export interface FormatOptions {
	/** Minimum votes for community annotations (default: 5) */
	minVotes?: number;
	/** Maximum annotation text length before truncation (default: 200) */
	maxAnnotationLength?: number;
	/** Only include verified/artist annotations (default: false) */
	verifiedOnly?: boolean;
}

const DEFAULT_OPTIONS: Required<FormatOptions> = {
	minVotes: 5,
	maxAnnotationLength: 200,
	verifiedOnly: false,
};

/**
 * Format lyrics to compact text representation for LLM prompts.
 * Reduces token usage by ~40-50% compared to JSON.stringify.
 */
export function formatLyricsCompact(
	lyrics: TransformedLyricsBySection[],
	options?: FormatOptions,
): string {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const sections: string[] = [];

	for (const section of lyrics) {
		const sectionLines: string[] = [];

		// Section header
		sectionLines.push(`[${section.type}]`);

		// Process each line
		for (const line of section.lines) {
			// Add the lyric text
			sectionLines.push(line.text);

			// Add annotations if present and pass filter
			if (line.annotations?.length) {
				const formattedAnnotations = formatAnnotations(line.annotations, opts);
				sectionLines.push(...formattedAnnotations);
			}
		}

		sections.push(sectionLines.join("\n"));
	}

	return sections.join("\n\n");
}

/**
 * Format annotations for a single line.
 * Filters by votes/verification and formats with appropriate prefix.
 */
function formatAnnotations(
	annotations: AnnotationInfo[],
	opts: Required<FormatOptions>,
): string[] {
	const result: string[] = [];

	for (const annotation of annotations) {
		// Determine annotation type and whether to include
		const isArtist = annotation.pinnedRole === "artist";
		const isVerified = annotation.verified;
		const hasEnoughVotes = annotation.votes_total >= opts.minVotes;

		// Filter logic:
		// - Always include artist annotations (rare and valuable)
		// - Always include verified annotations
		// - Include community annotations only if enough votes (unless verifiedOnly mode)
		if (opts.verifiedOnly && !isArtist && !isVerified) {
			continue;
		}
		if (!isArtist && !isVerified && !hasEnoughVotes) {
			continue;
		}

		// Format the prefix based on type
		const prefix = formatAnnotationPrefix(annotation);

		// Truncate long annotations
		const text = truncateText(annotation.text, opts.maxAnnotationLength);

		result.push(`  > ${prefix} ${text}`);
	}

	return result;
}

/**
 * Format the annotation prefix based on type.
 * Priority: Artist > Verified > Community votes
 */
function formatAnnotationPrefix(annotation: AnnotationInfo): string {
	if (annotation.pinnedRole === "artist") {
		return "[Artist]";
	}

	if (annotation.verified) {
		return `[Verified, ${annotation.votes_total} votes]`;
	}

	return `[${annotation.votes_total} votes]`;
}

/**
 * Truncate text to max length, adding ellipsis if needed.
 */
function truncateText(text: string, maxLength: number): string {
	// Clean up whitespace
	const cleaned = text.replace(/\s+/g, " ").trim();

	if (cleaned.length <= maxLength) {
		return cleaned;
	}

	// Truncate at word boundary
	const truncated = cleaned.slice(0, maxLength);
	const lastSpace = truncated.lastIndexOf(" ");

	if (lastSpace > maxLength * 0.7) {
		return `${truncated.slice(0, lastSpace)}...`;
	}

	return `${truncated}...`;
}

/**
 * Get format legend for LLM prompt.
 * Should be included before the formatted lyrics.
 */
export function getLyricsFormatLegend(): string {
	return `(Format: [Section] = song part, ">" = annotation for line above)\n(Annotation types: [Artist] = songwriter's explanation, [Verified] = confirmed, [N votes] = community)`;
}
