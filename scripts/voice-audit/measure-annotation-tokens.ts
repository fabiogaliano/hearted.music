#!/usr/bin/env bun
// Measures the worst-case lyrics+annotation prompt block across the live corpus, rendered
// through the SAME formatLyricsCompact (with numbered dedup) that prod sends to gemini-2.5-flash.
// Token figures are the ~chars/4 estimate we've used elsewhere this session — there's no
// Gemini tokenizer in the project, and countTokens needs network/credits.

import postgres from "postgres";
import {
	formatLyricsCompact,
	getLyricsFormatLegend,
} from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import type { LyricsDocument } from "@/lib/domains/enrichment/lyrics/queries";

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

const est = (chars: number) => Math.round(chars / 4);

// The deduped output collapses every recurring-chorus annotation to "[#N, see above]". To show
// what dedup bought, expand each back-reference to the full first-occurrence line it points at.
function expandedChars(output: string): number {
	const firstLineLenByNum = new Map<number, number>();
	for (const line of output.split("\n")) {
		const m = line.match(/^ {2}> \[#(\d+),(?! see above)/);
		if (m) firstLineLenByNum.set(Number(m[1]), line.length);
	}
	let total = output.length;
	for (const line of output.split("\n")) {
		const m = line.match(/^ {2}> \[#(\d+), see above\]$/);
		if (m) {
			const full = firstLineLenByNum.get(Number(m[1])) ?? line.length;
			total += full - line.length; // swap the back-ref for the full reprint
		}
	}
	return total;
}

function countBackRefs(output: string): number {
	return output.split("\n").filter((l) => /^ {2}> \[#\d+, see above\]$/.test(l))
		.length;
}

try {
	const rows = await sql<
		{ song: string | null; source: string; document: LyricsDocument }[]
	>`
		SELECT DISTINCT ON (sl.document)
			s.name AS song, sl.source, sl.document
		FROM song_lyrics sl
		LEFT JOIN song s ON s.id = sl.song_id
		WHERE sl.has_annotations = true
		ORDER BY sl.document, length(sl.document::text) DESC
	`;

	const legendChars = getLyricsFormatLegend().length;

	const measured = rows
		.map((r) => {
			const block = formatLyricsCompact(r.document.sections);
			const deduped = block.length;
			const before = expandedChars(block);
			return {
				song: r.song ?? "(unknown)",
				backRefs: countBackRefs(block),
				beforeChars: before,
				dedupedChars: deduped,
				savedChars: before - deduped,
				// what actually ships: legend + the block
				blockWithLegend: legendChars + 1 + deduped,
			};
		})
		.sort((a, b) => b.dedupedChars - a.dedupedChars);

	console.log(
		`legend overhead: ${legendChars} chars (~${est(legendChars)} tok), once per prompt\n`,
	);
	console.log(
		"song".padEnd(20),
		"annot".padStart(6),
		"before".padStart(8),
		"deduped".padStart(8),
		"saved".padStart(7),
		"tok(dd)".padStart(8),
		"+legend".padStart(8),
	);
	for (const m of measured.slice(0, 12)) {
		console.log(
			m.song.slice(0, 20).padEnd(20),
			String(m.backRefs).padStart(6),
			String(m.beforeChars).padStart(8),
			String(m.dedupedChars).padStart(8),
			String(m.savedChars).padStart(7),
			String(est(m.dedupedChars)).padStart(8),
			String(est(m.blockWithLegend)).padStart(8),
		);
	}

	const top = measured[0];
	const pct = ((top.savedChars / top.beforeChars) * 100).toFixed(1);

	// How much is the 200-char cap currently hiding? Re-render the worst case untruncated.
	const worstDoc = rows.find((r) => (r.song ?? "(unknown)") === top.song)!;
	const untrunc = formatLyricsCompact(worstDoc.document.sections, {
		maxAnnotationLength: 1_000_000,
	}).length;

	console.log(
		`\nWORST CASE: ${top.song}\n` +
			`  before dedup : ${top.beforeChars} chars (~${est(top.beforeChars)} tok)\n` +
			`  after  dedup : ${top.dedupedChars} chars (~${est(top.dedupedChars)} tok)\n` +
			`  saved        : ${top.savedChars} chars (~${est(top.savedChars)} tok, ${pct}%) via ${top.backRefs} back-references\n` +
			`  block+legend : ${top.blockWithLegend} chars (~${est(top.blockWithLegend)} tok) — what ships in {lyrics}\n` +
			`  if UNtruncated (cap off): ${untrunc} chars (~${est(untrunc)} tok) — the 200-char cap is hiding ~${est(untrunc - top.dedupedChars)} tok`,
	);
} finally {
	await sql.end();
}
