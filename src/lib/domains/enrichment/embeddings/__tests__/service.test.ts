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
});
