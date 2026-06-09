import { describe, expect, it } from "vitest";
import { GOLD_SONG_DETAILS } from "@/features/liked-songs/components/song-detail-panel/song-detail-data";
import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";

const baseRead = GOLD_SONG_DETAILS[0].read;

describe("SongReadSchema", () => {
	it("validates all four gold song-detail-data reads unmodified", () => {
		for (const song of GOLD_SONG_DETAILS) {
			const result = SongReadSchema.safeParse(song.read);
			expect(result.success, `${song.id} should validate`).toBe(true);
		}
	});

	it("accepts a 4-beat arc (Not Like Us, the widest gold)", () => {
		const nlu = GOLD_SONG_DETAILS.find((s) => s.id === "not-like-us");
		expect(nlu?.read.arc.length).toBe(4);
		expect(SongReadSchema.safeParse(nlu?.read).success).toBe(true);
	});

	it("allows repeated mood across arc beats (monochrome songs)", () => {
		const flat = {
			...baseRead,
			arc: [
				{ label: "Verse", mood: "Grateful", scene: "a." },
				{ label: "Chorus", mood: "Grateful", scene: "b." },
			],
		};
		expect(SongReadSchema.safeParse(flat).success).toBe(true);
	});

	it("enforces the arc envelope [2, 4]", () => {
		const oneBeat = { ...baseRead, arc: baseRead.arc.slice(0, 1) };
		expect(SongReadSchema.safeParse(oneBeat).success).toBe(false);

		const fiveBeats = {
			...baseRead,
			arc: Array.from({ length: 5 }, (_, i) => ({
				label: `s${i}`,
				mood: "m",
				scene: "x.",
			})),
		};
		expect(SongReadSchema.safeParse(fiveBeats).success).toBe(false);
	});

	it("enforces the lines envelope [1, 5]", () => {
		const noLines = { ...baseRead, lines: [] };
		expect(SongReadSchema.safeParse(noLines).success).toBe(false);

		const sixLines = {
			...baseRead,
			lines: Array.from({ length: 6 }, () => ({ line: "l" })),
		};
		expect(SongReadSchema.safeParse(sixLines).success).toBe(false);
	});

	it("requires an explicit contradiction key (null allowed, missing rejected)", () => {
		const withNull = { ...baseRead, contradiction: null };
		expect(SongReadSchema.safeParse(withNull).success).toBe(true);

		const { contradiction: _omitted, ...withoutKey } = baseRead;
		expect(SongReadSchema.safeParse(withoutKey).success).toBe(false);
	});

	it("requires an explicit texture key (null allowed when audio features absent, missing rejected)", () => {
		const withNull = { ...baseRead, texture: null };
		expect(SongReadSchema.safeParse(withNull).success).toBe(true);

		const { texture: _omitted, ...withoutKey } = baseRead;
		expect(SongReadSchema.safeParse(withoutKey).success).toBe(false);
	});
});
