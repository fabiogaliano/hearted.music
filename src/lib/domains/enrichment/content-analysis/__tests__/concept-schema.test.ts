import { describe, expect, it } from "vitest";
import { CONCEPT_SONGS } from "@/features/liked-songs/components/concept-panel/concept-data";
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
