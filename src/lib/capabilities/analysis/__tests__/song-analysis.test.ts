import { describe, expect, it } from "vitest";
import { SongAnalysisService } from "../song-analysis";
import type { AnalyzeSongInput } from "../song-analysis";

const service = new SongAnalysisService({} as any);
const detect = (input: Partial<AnalyzeSongInput>) =>
	(service as any).detectInstrumental({
		songId: "1",
		artist: "Test",
		title: "Test",
		...input,
	});

describe("detectInstrumental", () => {
	it("returns true when lyrics are null", () => {
		expect(detect({ lyrics: null })).toBe(true);
	});

	it("returns true when lyrics are empty string", () => {
		expect(detect({ lyrics: "" })).toBe(true);
	});

	it("returns true when lyrics are whitespace only", () => {
		expect(detect({ lyrics: "   " })).toBe(true);
	});

	it("returns true when instrumentalness > 0.5", () => {
		expect(detect({ lyrics: "word ".repeat(60), instrumentalness: 0.8 })).toBe(
			true,
		);
	});

	it("returns true when audioFeatures.instrumentalness > 0.5 (fallback)", () => {
		expect(
			detect({
				lyrics: "word ".repeat(60),
				audioFeatures: { instrumentalness: 0.7 } as any,
			}),
		).toBe(true);
	});

	it("returns true when lyrics have fewer than 50 words", () => {
		expect(detect({ lyrics: "word ".repeat(30) })).toBe(true);
	});

	it("returns false for lyrical song with sufficient words", () => {
		expect(detect({ lyrics: "word ".repeat(60), instrumentalness: 0.1 })).toBe(
			false,
		);
	});

	it("returns false when instrumentalness is exactly 0.5", () => {
		expect(detect({ lyrics: "word ".repeat(60), instrumentalness: 0.5 })).toBe(
			false,
		);
	});
});
