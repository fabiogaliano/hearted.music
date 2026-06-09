import { describe, expect, it } from "vitest";
import { EmbeddingService } from "../service";

const service = Object.create(EmbeddingService.prototype) as EmbeddingService;
const buildText = (analysisData: Record<string, unknown>) =>
	(service as any).buildEmbeddingText({ analysis: analysisData });

describe("buildEmbeddingText", () => {
	it("returns fallback for null analysis", () => {
		expect((service as any).buildEmbeddingText({ analysis: null })).toBe(
			"Song analysis for track",
		);
	});

	it("builds text from lyrical analysis fields", () => {
		const text = buildText({
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

		expect(text).toContain("A song about longing");
		expect(text).toContain("Wistful Nostalgia");
		expect(text).toContain("Gentle ache of missing someone");
		expect(text).toContain("The narrator reflects on lost love");
		expect(text).toContain("Longing");
		expect(text).toContain("Missing someone deeply");
		expect(text).toContain("Tender, Aching");
		expect(text).toContain("Warm acoustic guitar");
	});

	it("builds text from instrumental analysis (fewer fields)", () => {
		const text = buildText({
			headline: "An ambient soundscape",
			compound_mood: "Serene Contemplation",
			mood_description: "Peaceful and meditative",
			sonic_texture: "Layered synths with field recordings",
		});

		expect(text).toContain("An ambient soundscape");
		expect(text).toContain("Serene Contemplation");
		expect(text).toContain("Peaceful and meditative");
		expect(text).toContain("Layered synths");
		expect(text).not.toContain("undefined");
	});

	it("handles missing optional fields gracefully", () => {
		const text = buildText({ headline: "Just a headline" });
		expect(text).toBe("Just a headline");
	});

	it("skips empty themes array", () => {
		const text = buildText({ headline: "Test", themes: [] });
		expect(text).toBe("Test");
	});

	// Regression: the active v17 SongRead schema (image/lens/tension/take/arc/lines/
	// texture) shares no field names with the pre-v17 builder, so a v17 row used to
	// compose an empty string. Empty text yields no embedding row, and since
	// readiness is decided purely on row existence, the song was re-selected every
	// batch — busy-looping the enrichment reconciler. The builder must read v17
	// fields and never return empty.
	it("builds non-empty text from a v17 SongRead row", () => {
		const text = buildText({
			image: "a dark empty road",
			lens: "a goodbye as a homecoming",
			tension: "Quiet Dread",
			take: "The night ends and she is alone.",
			contradiction: "She leaves to feel held",
			arc: [
				{ label: "The Start", mood: "tense", scene: "She waits by the door." },
				{ label: "The End", mood: "calm", scene: "She walks into the cold." },
			],
			lines: [{ line: "I'm still here" }],
			texture: "Warm synths over a brittle drum machine",
		});

		expect(text).not.toBe("Song analysis for track");
		expect(text).toContain("a dark empty road");
		expect(text).toContain("a goodbye as a homecoming");
		expect(text).toContain("The night ends and she is alone.");
		expect(text).toContain("She waits by the door.");
		expect(text).toContain("I'm still here");
		expect(text).toContain("Warm synths");
		expect(text).not.toContain("undefined");
	});

	it("never returns empty text for an unrecognized shape", () => {
		const text = buildText({ some_future_field: "value" });
		expect(text).toBe("Song analysis for track");
	});
});
