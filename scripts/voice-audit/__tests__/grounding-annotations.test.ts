import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	GROUNDING_MIN_VOTES,
	renderAnnotationsBlock,
	selectGroundingAnnotations,
} from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
import type { LyricsDocument } from "@/lib/domains/enrichment/lyrics/queries";

const LYRICS_DIR = path.join(__dirname, "..", "exemplars", "lyrics");

function loadDoc(key: string): LyricsDocument {
	const envelope = JSON.parse(
		readFileSync(path.join(LYRICS_DIR, `${key}.json`), "utf-8"),
	);
	return envelope.lyrics.document as LyricsDocument;
}

// Independent oracle: every stored annotation, ungated. The function must match this once the
// > 15 filter is applied by hand.
function allAnnotations(doc: LyricsDocument): { votes_total: number }[] {
	return doc.sections.flatMap((s) =>
		s.lines.flatMap((l) => l.annotations ?? []),
	);
}

describe("selectGroundingAnnotations — vote gate", () => {
	it("defaults the floor to votes_total > 15 (minVotes 16)", () => {
		expect(GROUNDING_MIN_VOTES).toBe(16);
	});

	it("keeps exactly the above-gate annotations, in document order (not-like-us, rich)", () => {
		const doc = loadDoc("not-like-us");
		const selected = selectGroundingAnnotations(doc);
		const expected = allAnnotations(doc).filter((a) => a.votes_total > 15);

		expect(selected.length).toBeGreaterThan(0);
		expect(selected).toHaveLength(expected.length);
		expect(selected.every((a) => a.votes_total >= GROUNDING_MIN_VOTES)).toBe(true);
		// reading order preserved (the vote sequence matches the unfiltered traversal)
		expect(selected.map((a) => a.votes_total)).toEqual(
			expected.map((a) => a.votes_total),
		);
	});

	it("filters below-gate annotations — the gate genuinely bites (beautiful-things)", () => {
		const doc = loadDoc("beautiful-things");
		const stored = allAnnotations(doc);
		const selected = selectGroundingAnnotations(doc);

		// 5 stored, 1 clears the gate. Fewer-out-than-in proves the gate filters, not passes through.
		expect(stored.length).toBeGreaterThan(0);
		expect(selected.length).toBeLessThan(stored.length);
		expect(selected).toHaveLength(stored.filter((a) => a.votes_total > 15).length);
		expect(selected.every((a) => a.votes_total >= GROUNDING_MIN_VOTES)).toBe(true);
	});

	it("yields nothing for a song with no annotations (no-sex-for-ben), without crashing", () => {
		expect(selectGroundingAnnotations(loadDoc("no-sex-for-ben"))).toEqual([]);
	});

	it("keys each selected annotation to the exact line it explains", () => {
		for (const a of selectGroundingAnnotations(loadDoc("not-like-us"))) {
			expect(a.line.length).toBeGreaterThan(0);
			expect(typeof a.lineId).toBe("number");
			expect(a.section.length).toBeGreaterThan(0);
		}
	});

	it("honours an explicit minVotes override", () => {
		const doc = loadDoc("not-like-us");
		expect(selectGroundingAnnotations(doc, { minVotes: 1_000_000 })).toEqual([]);
		expect(selectGroundingAnnotations(doc, { minVotes: 0 })).toHaveLength(
			allAnnotations(doc).length,
		);
	});

	it("applies a strict > 15 boundary: 15 excluded, 16 included", () => {
		const doc: LyricsDocument = {
			schemaVersion: 1,
			source: "genius",
			sections: [
				{
					type: "Verse 1",
					lines: [
						{ id: 1, text: "below the bar", annotations: [{ text: "fifteen", votes_total: 15, verified: false }] },
						{ id: 2, text: "at the bar", annotations: [{ text: "sixteen", votes_total: 16, verified: false }] },
					],
				},
			],
		};
		expect(selectGroundingAnnotations(doc).map((a) => a.text)).toEqual(["sixteen"]);
	});
});

describe("renderAnnotationsBlock", () => {
	it("renders an empty string for no annotations (no-sex-for-ben), not a crash", () => {
		expect(renderAnnotationsBlock(selectGroundingAnnotations(loadDoc("no-sex-for-ben")))).toBe("");
	});

	it("keys each note to its line, stamps votes, and collapses internal whitespace", () => {
		const selected = selectGroundingAnnotations(loadDoc("not-like-us"));
		const block = renderAnnotationsBlock(selected);
		const first = selected[0];
		const collapsed = first.text.replace(/\s+/g, " ").trim();

		expect(block.length).toBeGreaterThan(0);
		expect(block).toContain(`[${first.section}] "${first.line}"`);
		// the whole annotation — which carries newlines in the raw data — renders on one line
		expect(block).toContain(`(${first.votes_total} votes) ${collapsed}`);
	});

	it("groups multiple notes on one line under a single header", () => {
		const block = renderAnnotationsBlock([
			{ section: "Verse 1", lineId: 1, line: "x", text: "first note", votes_total: 20, verified: true },
			{ section: "Verse 1", lineId: 1, line: "x", text: "second note", votes_total: 30, verified: true },
		]);
		expect(block.split("\n").filter((l) => l.startsWith("[")).length).toBe(1);
		expect(block).toContain("(20 votes) first note");
		expect(block).toContain("(30 votes) second note");
	});
});
