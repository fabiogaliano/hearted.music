import { describe, expect, it } from "vitest";
import type { SongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import { flattenAnalysisText } from "../analysis-text";

function makeAnalysis(data: Record<string, unknown>): SongAnalysis {
	return { analysis: data } as unknown as SongAnalysis;
}

describe("flattenAnalysisText", () => {
	it("returns fallback for null analysis", () => {
		expect(
			flattenAnalysisText({ analysis: null } as unknown as SongAnalysis),
		).toBe("Song analysis for track");
	});

	it("returns fallback when no recognised fields are present", () => {
		expect(flattenAnalysisText(makeAnalysis({ unknown_field: "value" }))).toBe(
			"Song analysis for track",
		);
	});

	// This fixture mirrors the canonical test case in service.test.ts "builds text
	// from lyrical analysis fields" — the expected string must match exactly so we
	// can assert no-churn between the old private method and this shared function.
	it("flattens lyrical analysis to the same string the old buildEmbeddingText produced", () => {
		const analysis = makeAnalysis({
			headline: "A song about longing",
			compound_mood: "Wistful Nostalgia",
			mood_description: "Gentle ache of missing someone",
			interpretation: "The narrator reflects on lost love",
			themes: [
				{ name: "Longing", description: "Missing someone deeply" },
				{ name: "Memory", description: "Holding on to the past" },
			],
			journey: [
				{ section: "Verse", mood: "Tender", description: "Soft opening" },
				{ section: "Chorus", mood: "Aching", description: "Peak emotion" },
			],
			sonic_texture: "Warm acoustic guitar with gentle strings",
		});

		const text = flattenAnalysisText(analysis);

		// All parts must be present
		expect(text).toContain("A song about longing");
		expect(text).toContain("Wistful Nostalgia");
		expect(text).toContain("Gentle ache of missing someone");
		expect(text).toContain("The narrator reflects on lost love");
		expect(text).toContain("Longing");
		expect(text).toContain("Missing someone deeply");
		expect(text).toContain("Tender, Aching");
		expect(text).toContain("Warm acoustic guitar with gentle strings");
		expect(text).not.toContain("undefined");

		// Verify the exact string matches what the old private method produced
		// so existing embeddings never churn (deterministic field order).
		expect(text).toBe(
			"A song about longing. Wistful Nostalgia. Gentle ache of missing someone. The narrator reflects on lost love. Longing. Missing someone deeply. Memory. Holding on to the past. Tender, Aching. Warm acoustic guitar with gentle strings",
		);
	});

	it("flattens v17 SongRead (lyrical) schema", () => {
		const text = flattenAnalysisText(
			makeAnalysis({
				image: "a dark empty road",
				lens: "a goodbye as a homecoming",
				tension: "Quiet Dread",
				take: "The night ends and she is alone.",
				contradiction: "She leaves to feel held",
				arc: [
					{
						label: "The Start",
						mood: "tense",
						scene: "She waits by the door.",
					},
					{ label: "The End", mood: "calm", scene: "She walks into the cold." },
				],
				lines: [{ line: "I'm still here" }],
				texture: "Warm synths over a brittle drum machine",
			}),
		);

		expect(text).not.toBe("Song analysis for track");
		expect(text).toContain("a dark empty road");
		expect(text).toContain("a goodbye as a homecoming");
		expect(text).toContain("The night ends and she is alone.");
		expect(text).toContain("She waits by the door.");
		expect(text).toContain("I'm still here");
		expect(text).toContain("Warm synths over a brittle drum machine");
		expect(text).not.toContain("undefined");
	});

	it("handles instrumental / pre-v17 schema (headline only)", () => {
		const text = flattenAnalysisText(
			makeAnalysis({ headline: "Just a headline" }),
		);
		expect(text).toBe("Just a headline");
	});

	it("skips empty arrays without crashing", () => {
		const text = flattenAnalysisText(
			makeAnalysis({ headline: "Test", themes: [], journey: [], arc: [] }),
		);
		expect(text).toBe("Test");
	});
});
