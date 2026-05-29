import type { ResponseReferents } from "../types/genius.types";
import type { AnnotationInfo, LyricsSection } from "../types/lyrics.types";

interface TransformedLine {
	id: number;
	text: string;
	range?: {
		start: number;
		end: number;
	};
	annotations?: AnnotationInfo[];
}

export interface TransformedLyricsBySection {
	type: string;
	lines: TransformedLine[];
}

export function transformLyrics(
	lyrics: LyricsSection[],
	referents: ResponseReferents[],
): TransformedLyricsBySection[] {
	const annotationMap = buildAnnotationMap(referents);
	return lyrics.map((section) => transformSection(section, annotationMap));
}

// "accepted" and "verified" are Genius editor-approved; "pending" needs a vote
// floor to exclude fresh/troll community annotations before they reach the DB.
function isAnnotationWorthKeeping(a: {
	state: string;
	votes_total: number;
}): boolean {
	if (a.votes_total < 0) return false;
	if (a.state === "verified" || a.state === "accepted") return true;
	return a.votes_total >= 10;
}

function buildAnnotationMap(
	referents: ResponseReferents[],
): Record<string, AnnotationInfo[]> {
	const annotationMap: Record<string, AnnotationInfo[]> = {};

	for (const referent of referents) {
		const id = referent.api_path.split("/").pop();
		if (id && referent.annotations) {
			annotationMap[id] = referent.annotations
				.filter(isAnnotationWorthKeeping)
				.map((a) => ({
					text: a.body.plain,
					verified: a.verified,
					votes_total: a.votes_total,
					pinnedRole: a.authors?.[0]?.pinned_role,
					state: a.state,
				}));
		}
	}

	return annotationMap;
}

function transformSection(
	section: LyricsSection,
	annotationMap: Record<string, AnnotationInfo[]>,
): TransformedLyricsBySection {
	const groupedLines = groupLines(section, annotationMap);
	const transformedLines = buildTransformedLines(section, groupedLines);
	return { type: section.type, lines: transformedLines };
}

function groupLines(
	section: LyricsSection,
	annotationMap: Record<string, AnnotationInfo[]>,
): Record<number, { lineIds: number[]; annotations: AnnotationInfo[] }> {
	const groupedLines: Record<
		number,
		{ lineIds: number[]; annotations: AnnotationInfo[] }
	> = {};

	for (const [path, lineIds] of Object.entries(section.annotationLinks || {})) {
		const id = path.split("/")[1];
		if (!id) continue;

		const minId = Math.min(...lineIds);
		if (!groupedLines[minId]) {
			groupedLines[minId] = {
				lineIds: [],
				annotations: annotationMap[id] || [],
			};
		}
		groupedLines[minId].lineIds.push(...lineIds);
	}

	return groupedLines;
}

function buildTransformedLines(
	section: LyricsSection,
	groupedLines: Record<
		number,
		{ lineIds: number[]; annotations: AnnotationInfo[] }
	>,
): TransformedLine[] {
	const transformedLines: TransformedLine[] = [];
	const processedIds = new Set<number>();
	let sequentialId = 1;

	for (const line of section.lines) {
		if (!line || processedIds.has(line.id)) continue;

		const group = groupedLines[line.id];
		if (group) {
			processGroupedLine(
				group,
				section,
				transformedLines,
				processedIds,
				sequentialId,
			);
			sequentialId++;
		} else if (line.text) {
			transformedLines.push(createSingleLine(line, sequentialId++));
		}
	}

	return transformedLines;
}

function processGroupedLine(
	group: { lineIds: number[]; annotations: AnnotationInfo[] },
	section: LyricsSection,
	transformedLines: TransformedLine[],
	processedIds: Set<number>,
	sequentialId: number,
) {
	const sortedLineIds = group.lineIds.toSorted((a, b) => a - b);
	const mergedText = getMergedText(sortedLineIds, section);

	if (mergedText) {
		transformedLines.push({
			id: sequentialId,
			text: mergedText,
			range: {
				start: Math.min(...sortedLineIds),
				end: Math.max(...sortedLineIds),
			},
			annotations: group.annotations,
		});
	}

	for (const id of sortedLineIds) {
		processedIds.add(id);
	}
}

function getMergedText(
	sortedLineIds: number[],
	section: LyricsSection,
): string {
	return sortedLineIds
		.map((id) => {
			const foundLine = section.lines.find((l) => l.id === id);
			return foundLine?.text || "";
		})
		.filter((text) => text !== "")
		.join("\n");
}

function createSingleLine(
	line: { id: number; text: string },
	sequentialId: number,
): TransformedLine {
	return {
		id: sequentialId,
		range: { start: line.id, end: line.id },
		text: line.text,
	};
}
