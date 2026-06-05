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

interface FormatOptions {
	/** Minimum votes for community annotations (default: 5) */
	minVotes?: number;
	/** Maximum annotation text length before truncation (default: 200) */
	maxAnnotationLength?: number;
	/** Only include verified/artist annotations (default: false) */
	verifiedOnly?: boolean;
	/**
	 * Map<normalizedText, distilledText>. When an annotation's normalized text has an
	 * entry, the distilled (fact-compressed) form is rendered in full instead of the raw
	 * text — and it skips truncation, since distilled text is already compact and lossless
	 * on the facts. Absent keys fall back to raw + the length cap.
	 */
	distillations?: Map<string, string>;
}

const DEFAULT_OPTIONS: Required<FormatOptions> = {
	minVotes: 5,
	maxAnnotationLength: 200,
	verifiedOnly: false,
	distillations: new Map(),
};

/**
 * Canonical annotation-text normalization. Shared by the dedup key here and the
 * distillation cache lookup so the two can never drift: the distillation map is keyed
 * by this exact form, and the formatter looks distilled text up by the same key.
 */
export function normalizeAnnotationText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

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
	// A repeated chorus carries the same annotation on every occurrence, so the raw
	// document stores it N times. Number each distinct annotation on first sight and, on
	// any repeat, emit a back-reference instead of reprinting the body — lossless, and on a
	// chorus-heavy song it removes most of the annotation tokens. Keyed by normalized text
	// since the stored annotation shape carries no stable id.
	const registry = new Map<string, number>();

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
				const formattedAnnotations = formatAnnotations(
					line.annotations,
					opts,
					registry,
				);
				sectionLines.push(...formattedAnnotations);
			}
		}

		sections.push(sectionLines.join("\n"));
	}

	return sections.join("\n\n");
}

/**
 * Format annotations for a single line.
 * Filters by votes/verification, numbers each distinct annotation, and emits a
 * back-reference for any repeat instead of reprinting the body.
 */
function formatAnnotations(
	annotations: AnnotationInfo[],
	opts: Required<FormatOptions>,
	registry: Map<string, number>,
): string[] {
	const result: string[] = [];

	for (const annotation of annotations) {
		const isArtist = annotation.pinnedRole === "artist";
		const isVerified = annotation.verified;
		const isEditorApproved =
			annotation.state === "verified" || annotation.state === "accepted";
		const hasEnoughVotes = annotation.votes_total >= opts.minVotes;

		if (opts.verifiedOnly && !isArtist && !isVerified && !isEditorApproved) {
			continue;
		}
		if (!isArtist && !isVerified && !isEditorApproved && !hasEnoughVotes) {
			continue;
		}

		// Dedup by content: a repeated line (a recurring chorus) points back to the number
		// instead of reprinting the annotation.
		const key = normalizeAnnotationText(annotation.text);
		const existing = registry.get(key);
		if (existing !== undefined) {
			result.push(`  > [#${existing}, see above]`);
			continue;
		}

		const num = registry.size + 1;
		registry.set(key, num);

		const prefix = formatAnnotationPrefix(annotation, num);
		// A distilled annotation is already compact and lossless on the facts, so render it
		// in full; only raw text is subject to the length cap.
		const distilled = opts.distillations.get(key);
		const text =
			distilled ?? truncateText(annotation.text, opts.maxAnnotationLength);

		result.push(`  > ${prefix} ${text}`);
	}

	return result;
}

/**
 * Format the annotation prefix based on type, carrying its reference number.
 * Priority: Artist > Verified > Community votes
 */
function formatAnnotationPrefix(
	annotation: AnnotationInfo,
	num: number,
): string {
	if (annotation.pinnedRole === "artist") {
		return `[#${num}, Artist]`;
	}

	if (annotation.verified) {
		return `[#${num}, Verified, ${annotation.votes_total} votes]`;
	}

	return `[#${num}, ${annotation.votes_total} votes]`;
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
	return `(Format: [Section] = song part, ">" = annotation for line above)\n(Annotations are numbered [#1], [#2], ...; types: [Artist] = songwriter's explanation, [Verified] = confirmed, [N votes] = community. A repeated line shows "[#N, see above]" pointing to where annotation N was first given.)`;
}
