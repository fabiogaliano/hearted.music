/**
 * Parses Genius HTML lyrics pages into structured sections.
 *
 * Extracts:
 * - Lyrics text organized by section headers [Verse 1], [Chorus], etc.
 * - Annotation links for each line (URLs to referent annotations)
 */

import { selectAll } from "css-select";
import type { AnyNode, Document, Element, Text } from "domhandler";
import { parseDocument } from "htmlparser2";
import type { LyricsSection } from "../types/lyrics.types";

const SELECTORS = {
	LYRICS_CONTAINER: '[data-lyrics-container="true"]',
	LYRICS_HEADER: '[class*="LyricsHeader"]',
	ANNOTATION_LINK: 'a[class*="ReferentFragment"]',
} as const;

// Matches section headers like [Verse 1: Sam Fender] or [Chorus]
const SECTION_PATTERN = /^\[([^\]]+)\]$/;

interface LineData {
	text: string;
	annotationUrl?: string;
}

export class LyricsParser {
	static parse(html: string): LyricsSection[] {
		const doc = parseDocument(html) as Document & AnyNode;

		// Find lyrics containers
		const containers = selectAll(
			SELECTORS.LYRICS_CONTAINER,
			doc,
		) as unknown as Element[];
		if (containers.length === 0) {
			throw new Error(
				`Failed to parse lyrics: no lyrics container found (selector: ${SELECTORS.LYRICS_CONTAINER})`,
			);
		}

		// Remove header elements from each container
		for (const container of containers) {
			const headers = selectAll(
				SELECTORS.LYRICS_HEADER,
				container,
			) as Element[];
			for (const header of headers) {
				const parent = header.parent;
				if (parent && "children" in parent) {
					const idx = parent.children.indexOf(header);
					if (idx !== -1) parent.children.splice(idx, 1);
				}
			}
		}

		// Extract all lines with annotation info
		const allLines: LineData[] = [];
		for (const container of containers) {
			const lines = LyricsParser.extractLinesFromContainer(container);
			allLines.push(...lines);
		}

		// Parse into sections
		return LyricsParser.buildSections(allLines);
	}

	private static extractLinesFromContainer(container: Element): LineData[] {
		const lines: LineData[] = [];
		let currentLine = "";
		let currentAnnotationUrl: string | undefined;

		const processNode = (node: AnyNode) => {
			if (node.type === "text") {
				currentLine += (node as Text).data || "";
			} else if (node.type === "tag") {
				const el = node as Element;

				if (el.name === "br") {
					// Line break - save current line
					const trimmed = currentLine.trim();
					if (trimmed) {
						lines.push({ text: trimmed, annotationUrl: currentAnnotationUrl });
					}
					currentLine = "";
					currentAnnotationUrl = undefined;
				} else if (
					el.name === "a" &&
					el.attribs?.class?.includes("ReferentFragment")
				) {
					// Annotation link - recurse into it to handle <br> inside
					const url = el.attribs?.href;
					currentAnnotationUrl = url;
					for (const child of el.children || []) {
						processNode(child);
					}
				} else if (el.attribs?.class?.includes("LyricsHeader")) {
					// Skip header elements
					return;
				} else {
					// Recurse into children
					for (const child of el.children || []) {
						processNode(child);
					}
				}
			}
		};

		for (const child of container.children || []) {
			processNode(child);
		}

		// Handle remaining content
		const trimmed = currentLine.trim();
		if (trimmed) {
			lines.push({ text: trimmed, annotationUrl: currentAnnotationUrl });
		}

		return lines;
	}

	private static buildSections(lines: LineData[]): LyricsSection[] {
		const sections: LyricsSection[] = [];
		let currentSection: LyricsSection | null = null;
		let lineId = 1;

		for (const line of lines) {
			const sectionMatch = line.text.match(SECTION_PATTERN);

			if (sectionMatch) {
				// This is a section header like [Verse 1: Sam Fender]
				// Save previous section if exists
				if (currentSection && currentSection.lines.length > 0) {
					sections.push(currentSection);
				}

				// Start new section
				currentSection = {
					type: sectionMatch[1].trim(),
					lines: [],
					annotationLinks: {},
				};
				lineId = 1;
			} else {
				// This is a lyrics line
				if (!currentSection) {
					// No section header yet - create default section
					currentSection = {
						type: "Lyrics",
						lines: [],
						annotationLinks: {},
					};
				}

				currentSection.lines.push({ id: lineId, text: line.text });

				if (line.annotationUrl) {
					if (!currentSection.annotationLinks[line.annotationUrl]) {
						currentSection.annotationLinks[line.annotationUrl] = [];
					}
					currentSection.annotationLinks[line.annotationUrl].push(lineId);
				}

				lineId++;
			}
		}

		// Don't forget the last section
		if (currentSection && currentSection.lines.length > 0) {
			sections.push(currentSection);
		}

		return sections;
	}
}
