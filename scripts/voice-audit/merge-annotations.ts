// Groups plannotator annotations (made on compare.html) by (spotifyTrackId, field)
// so paired notes about the same field — exemplar vs candidate — land together.
//
// Annotation source shape is decoupled: pass any array of { cellId, text, comment }.
// The contract is that cellId follows the `<trackId>::<field>::<side>` convention
// emitted by build-compare.ts. If plannotator returns a different shape, normalize
// upstream and pipe the result through mergeAnnotations.

export interface RawAnnotation {
	cellId: string;
	text: string;
	comment: string;
}

export interface AnnotationNote {
	text: string;
	comment: string;
}

export interface PairedField {
	field: string;
	exemplar: AnnotationNote[];
	candidate: AnnotationNote[];
}

export interface TrackAnnotations {
	trackId: string;
	fields: Map<string, PairedField>;
}

export function mergeAnnotations(notes: RawAnnotation[]): Map<string, TrackAnnotations> {
	const out = new Map<string, TrackAnnotations>();
	for (const n of notes) {
		const parts = n.cellId.split("::");
		// Cells the generator did not emit (e.g. row headers or page chrome) are skipped
		// silently so the merger tolerates annotations placed on the wrong target.
		if (parts.length !== 3) continue;
		const [trackId, field, side] = parts;
		if (side !== "exemplar" && side !== "candidate") continue;

		let track = out.get(trackId);
		if (!track) {
			track = { trackId, fields: new Map() };
			out.set(trackId, track);
		}
		let paired = track.fields.get(field);
		if (!paired) {
			paired = { field, exemplar: [], candidate: [] };
			track.fields.set(field, paired);
		}
		paired[side].push({ text: n.text, comment: n.comment });
	}
	return out;
}

// Convenience: stable markdown rendering for a quick human-readable summary of the
// merged notes. Useful as the immediate next step after plannotator returns.
export function renderMergedMarkdown(merged: Map<string, TrackAnnotations>): string {
	const lines: string[] = [];
	for (const track of merged.values()) {
		lines.push(`## ${track.trackId}`);
		for (const paired of track.fields.values()) {
			lines.push(`\n### ${paired.field}`);
			if (paired.exemplar.length) {
				lines.push(`\n**exemplar**`);
				for (const n of paired.exemplar) lines.push(`- "${n.text}" — ${n.comment}`);
			}
			if (paired.candidate.length) {
				lines.push(`\n**candidate**`);
				for (const n of paired.candidate) lines.push(`- "${n.text}" — ${n.comment}`);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}
