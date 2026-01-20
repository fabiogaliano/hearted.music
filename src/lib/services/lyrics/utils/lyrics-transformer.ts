import type { ResponseReferents } from '../types/genius.types'
import type { AnnotationInfo, LyricsSection } from '../types/lyrics.types'

export interface TransformedLine {
	id: number
	text: string
	range?: {
		start: number
		end: number
	}
	annotations?: AnnotationInfo[]
}

export interface TransformedLyricsBySection {
	type: string
	lines: TransformedLine[]
}

export class LyricsTransformer {
	static transform(
		lyrics: LyricsSection[],
		referents: ResponseReferents[]
	): TransformedLyricsBySection[] {
		const annotationMap = this.buildAnnotationMap(referents)
		return lyrics.map(section => this.transformSection(section, annotationMap))
	}

	private static buildAnnotationMap(
		referents: ResponseReferents[]
	): Record<string, AnnotationInfo[]> {
		const annotationMap: Record<string, AnnotationInfo[]> = {}

		referents.forEach(referent => {
			const id = referent.api_path.split('/').pop()
			if (id && referent.annotations) {
				annotationMap[id] = referent.annotations.map(a => ({
					text: a.body.plain,
					verified: a.verified,
					votes_total: a.votes_total,
					pinnedRole: a.authors?.[0]?.pinned_role,
				}))
			}
		})

		return annotationMap
	}

	private static transformSection(
		section: LyricsSection,
		annotationMap: Record<string, AnnotationInfo[]>
	): TransformedLyricsBySection {
		const groupedLines = this.groupLines(section, annotationMap)
		const transformedLines = this.buildTransformedLines(section, groupedLines)

		return {
			type: section.type,
			lines: transformedLines,
		}
	}

	private static groupLines(
		section: LyricsSection,
		annotationMap: Record<string, AnnotationInfo[]>
	): Record<number, { lineIds: number[]; annotations: AnnotationInfo[] }> {
		const groupedLines: Record<
			number,
			{ lineIds: number[]; annotations: AnnotationInfo[] }
		> = {}

		Object.entries(section.annotationLinks || {}).forEach(([path, lineIds]) => {
			const id = path.split('/')[1]
			if (!id) return

			const minId = Math.min(...lineIds)
			if (!groupedLines[minId]) {
				groupedLines[minId] = {
					lineIds: [],
					annotations: annotationMap[id] || [],
				}
			}
			groupedLines[minId].lineIds.push(...lineIds)
		})

		return groupedLines
	}

	private static buildTransformedLines(
		section: LyricsSection,
		groupedLines: Record<number, { lineIds: number[]; annotations: AnnotationInfo[] }>
	): TransformedLine[] {
		const transformedLines: TransformedLine[] = []
		const processedIds = new Set<number>()
		let sequentialId = 1

		section.lines.forEach(line => {
			if (!line || processedIds.has(line.id)) return

			const group = groupedLines[line.id]
			if (group) {
				this.processGroupedLine(
					group,
					section,
					transformedLines,
					processedIds,
					sequentialId
				)
				sequentialId++
			} else if (line.text) {
				transformedLines.push(this.createSingleLine(line, sequentialId++))
			}
		})

		return transformedLines
	}

	private static processGroupedLine(
		group: { lineIds: number[]; annotations: AnnotationInfo[] },
		section: LyricsSection,
		transformedLines: TransformedLine[],
		processedIds: Set<number>,
		sequentialId: number
	) {
		const sortedLineIds = group.lineIds.sort((a, b) => a - b)
		const mergedText = this.getMergedText(sortedLineIds, section)

		if (mergedText) {
			transformedLines.push({
				id: sequentialId,
				text: mergedText,
				range: {
					start: Math.min(...sortedLineIds),
					end: Math.max(...sortedLineIds),
				},
				annotations: group.annotations,
			})
		}

		sortedLineIds.forEach(id => processedIds.add(id))
	}

	private static getMergedText(sortedLineIds: number[], section: LyricsSection): string {
		return sortedLineIds
			.map(id => {
				const foundLine = section.lines.find(l => l.id === id)
				return foundLine?.text || ''
			})
			.filter(text => text !== '')
			.join('\n')
	}

	private static createSingleLine(
		line: { id: number; text: string },
		sequentialId: number
	): TransformedLine {
		return {
			id: sequentialId,
			range: {
				start: line.id,
				end: line.id,
			},
			text: line.text,
		}
	}
}
