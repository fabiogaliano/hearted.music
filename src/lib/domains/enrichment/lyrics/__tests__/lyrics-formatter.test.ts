import { describe, expect, it } from "vitest";
import type { TransformedLyricsBySection } from "../types/lyrics.types";
import {
	formatLyricsCompact,
	getLyricsFormatLegend,
	normalizeAnnotationText,
} from "../utils/lyrics-formatter";

const REPEATED = "The blonde girl is widely read as a specific real person.";

describe("formatLyricsCompact — annotation numbering + dedup", () => {
	it("numbers each distinct annotation once and back-references repeats", () => {
		// A chorus that recurs carries the same annotation on every occurrence, the way the
		// stored document does.
		const sections: TransformedLyricsBySection[] = [
			{
				type: "Chorus",
				lines: [
					{
						id: 2,
						text: "now that I'm gone",
						annotations: [{ text: REPEATED, votes_total: 56, verified: false }],
					},
				],
			},
			{
				type: "Verse 2",
				lines: [
					{
						id: 9,
						text: "today I drove through the suburbs",
						annotations: [
							{
								text: "She explained this in a documentary.",
								votes_total: 18,
								verified: false,
							},
						],
					},
				],
			},
			{
				type: "Chorus",
				lines: [
					{
						id: 2,
						text: "now that I'm gone",
						annotations: [{ text: REPEATED, votes_total: 56, verified: false }],
					},
				],
			},
		];

		const out = formatLyricsCompact(sections);

		expect(out).toContain(`[#1, 56 votes] ${REPEATED}`);
		expect(out).toContain(
			"[#2, 18 votes] She explained this in a documentary.",
		);
		// the repeated chorus points back instead of reprinting
		expect(out).toContain("[#1, see above]");
		// the annotation body appears exactly once across the whole document
		expect(out.split(REPEATED).length - 1).toBe(1);
	});

	it("does not dedup two genuinely different annotations", () => {
		const out = formatLyricsCompact([
			{
				type: "Verse 1",
				lines: [
					{
						id: 1,
						text: "a",
						annotations: [
							{ text: "first note", votes_total: 20, verified: false },
						],
					},
					{
						id: 2,
						text: "b",
						annotations: [
							{ text: "second note", votes_total: 20, verified: false },
						],
					},
				],
			},
		]);
		expect(out).toContain("[#1, 20 votes] first note");
		expect(out).toContain("[#2, 20 votes] second note");
	});

	it("carries the reference number in artist and verified prefixes", () => {
		const out = formatLyricsCompact([
			{
				type: "Verse 1",
				lines: [
					// Artist annotations bypass the vote floor.
					{
						id: 1,
						text: "a",
						annotations: [
							{
								text: "songwriter note",
								votes_total: 3,
								verified: false,
								pinnedRole: "artist",
							},
						],
					},
					{
						id: 2,
						text: "b",
						annotations: [
							{ text: "confirmed note", votes_total: 200, verified: true },
						],
					},
				],
			},
		]);
		expect(out).toContain("[#1, Artist] songwriter note");
		expect(out).toContain("[#2, Verified, 200 votes] confirmed note");
	});

	it("still truncates a long first-occurrence annotation", () => {
		const out = formatLyricsCompact([
			{
				type: "Verse 1",
				lines: [
					{
						id: 1,
						text: "l",
						annotations: [
							{ text: "y".repeat(400), votes_total: 50, verified: false },
						],
					},
				],
			},
		]);
		expect(out).toContain("...");
		expect(out).not.toContain("y".repeat(300));
	});

	it("legend documents the numbering scheme", () => {
		expect(getLyricsFormatLegend()).toContain("[#N, see above]");
	});
});

describe("formatLyricsCompact — distillation substitution", () => {
	it("renders distilled text in place of raw and skips truncation", () => {
		const long = "y".repeat(400);
		const out = formatLyricsCompact(
			[
				{
					type: "Verse 1",
					lines: [
						{
							id: 1,
							text: "l",
							annotations: [{ text: long, votes_total: 50, verified: false }],
						},
					],
				},
			],
			{
				distillations: new Map([
					[normalizeAnnotationText(long), "compact grounding facts"],
				]),
			},
		);
		expect(out).toContain("[#1, 50 votes] compact grounding facts");
		// distilled text is rendered in full, so no truncation ellipsis
		expect(out).not.toContain("...");
		expect(out).not.toContain("y".repeat(300));
	});

	it("falls back to raw + truncation when the annotation has no distillation", () => {
		const long = "y".repeat(400);
		const out = formatLyricsCompact(
			[
				{
					type: "Verse 1",
					lines: [
						{
							id: 1,
							text: "l",
							annotations: [{ text: long, votes_total: 50, verified: false }],
						},
					],
				},
			],
			{ distillations: new Map() },
		);
		expect(out).toContain("...");
	});
});
