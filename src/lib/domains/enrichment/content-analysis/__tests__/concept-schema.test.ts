import { describe, expect, it } from "vitest";
import { CONCEPT_SONGS } from "@/features/liked-songs/components/concept-panel/concept-data";
import { transformLegacyToConceptDraft } from "@/lib/domains/enrichment/content-analysis/concept-migration";
import {
	ConceptReadSchema,
	SignalsSchema,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";

const baseRead = CONCEPT_SONGS[0].read;

describe("ConceptReadSchema", () => {
	it("validates all four gold concept-data reads unmodified", () => {
		for (const song of CONCEPT_SONGS) {
			const result = ConceptReadSchema.safeParse(song.read);
			expect(result.success, `${song.id} should validate`).toBe(true);
		}
	});

	it("accepts a 6-beat arc (Not Like Us, the widest gold)", () => {
		const nlu = CONCEPT_SONGS.find((s) => s.id === "not-like-us");
		expect(nlu?.read.arc.length).toBe(6);
		expect(ConceptReadSchema.safeParse(nlu?.read).success).toBe(true);
	});

	it("allows repeated mood across arc beats (monochrome songs)", () => {
		const flat = {
			...baseRead,
			arc: [
				{ label: "Verse", mood: "Grateful", scene: "a." },
				{ label: "Chorus", mood: "Grateful", scene: "b." },
			],
		};
		expect(ConceptReadSchema.safeParse(flat).success).toBe(true);
	});

	it("enforces the arc envelope [2, 6]", () => {
		const oneBeat = { ...baseRead, arc: baseRead.arc.slice(0, 1) };
		expect(ConceptReadSchema.safeParse(oneBeat).success).toBe(false);

		const sevenBeats = {
			...baseRead,
			arc: Array.from({ length: 7 }, (_, i) => ({
				label: `s${i}`,
				mood: "m",
				scene: "x.",
			})),
		};
		expect(ConceptReadSchema.safeParse(sevenBeats).success).toBe(false);
	});

	it("enforces the lines envelope [1, 5]", () => {
		const noLines = { ...baseRead, lines: [] };
		expect(ConceptReadSchema.safeParse(noLines).success).toBe(false);

		const sixLines = {
			...baseRead,
			lines: Array.from({ length: 6 }, () => ({ line: "l", insight: "i." })),
		};
		expect(ConceptReadSchema.safeParse(sixLines).success).toBe(false);
	});

	it("requires an explicit contradiction key (null allowed, missing rejected)", () => {
		const withNull = { ...baseRead, contradiction: null };
		expect(ConceptReadSchema.safeParse(withNull).success).toBe(true);

		const { contradiction: _omitted, ...withoutKey } = baseRead;
		expect(ConceptReadSchema.safeParse(withoutKey).success).toBe(false);
	});
});

describe("SignalsSchema", () => {
	it("accepts the lazy-migration stub { theme_tags: [] }", () => {
		expect(SignalsSchema.safeParse({ theme_tags: [] }).success).toBe(true);
	});

	it("accepts an empty object (signals not yet generated)", () => {
		expect(SignalsSchema.safeParse({}).success).toBe(true);
	});

	it("caps theme_tags at 3", () => {
		expect(
			SignalsSchema.safeParse({ theme_tags: ["a", "b", "c"] }).success,
		).toBe(true);
		expect(
			SignalsSchema.safeParse({ theme_tags: ["a", "b", "c", "d"] }).success,
		).toBe(false);
	});

	it("rejects unknown scene / register enum values", () => {
		expect(SignalsSchema.safeParse({ scenes: ["driving"] }).success).toBe(true);
		expect(SignalsSchema.safeParse({ scenes: ["commuting"] }).success).toBe(
			false,
		);
	});
});

describe("transformLegacyToConceptDraft", () => {
	const legacy = {
		headline: "the long way home",
		compound_mood: "Aching Disbelief",
		mood_description: "Quiet, then it floods.",
		interpretation: "A milestone reached alone.",
		themes: [{ name: "promise", description: "outlived the couple" }],
		journey: [
			{ section: "Verse", mood: "Hushed", description: "diary on the dash." },
			{ section: "Chorus", mood: "Cathartic", description: "the dam breaks." },
		],
		key_lines: [
			{ line: "I got my driver's license", insight: "a win as loss." },
		],
		sonic_texture: "A ballad that grows a spine.",
	};

	it("maps mechanical fields and stubs lens/contradiction", () => {
		const { read } = transformLegacyToConceptDraft(legacy);
		expect(read.image).toBe("the long way home");
		expect(read.tension).toBe("Aching Disbelief");
		expect(read.texture).toBe("A ballad that grows a spine.");
		expect(read.lens).toBeNull();
		expect(read.contradiction).toBeNull();
	});

	it("renames journey -> arc fields and key_lines -> lines", () => {
		const { read } = transformLegacyToConceptDraft(legacy);
		expect(read.arc).toEqual([
			{ label: "Verse", mood: "Hushed", scene: "diary on the dash." },
			{ label: "Chorus", mood: "Cathartic", scene: "the dam breaks." },
		]);
		expect(read.lines).toEqual([
			{ line: "I got my driver's license", insight: "a win as loss." },
		]);
	});

	it("concatenates interpretation + mood_description into the take scaffold", () => {
		const { read } = transformLegacyToConceptDraft(legacy);
		expect(read.take).toBe("A milestone reached alone. Quiet, then it floods.");
	});

	it("passes legacy themes through to signals and stubs empty theme_tags", () => {
		const { signals } = transformLegacyToConceptDraft(legacy);
		expect(signals.theme_tags).toEqual([]);
		expect(signals.themes).toEqual([
			{ name: "promise", description: "outlived the couple" },
		]);
	});
});
