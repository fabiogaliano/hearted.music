import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	get as getSongAnalysis,
	insert as insertSongAnalysis,
} from "@/lib/domains/enrichment/content-analysis/queries";
import type { SongRead } from "../read-schema";
import type { AnalyzeSongInput } from "../song-analysis";
import { SongAnalysisService } from "../song-analysis";
import { runAllRules } from "../voice/tier1-rules";

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: vi.fn(),
	insert: vi.fn(),
}));

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

// Locks the post-generation cleanup pass wired into analyzeSong (see song-analysis.ts). The pass is
// the proven tier1 lever — Round 5b measured 5.28 → 0.19 HIGH tells/read on the real population — so a
// future change must not silently drop it. A fake LlmService returns a read with one AI tell from the
// generation call, then a clean read from the rewrite call; the stored read must be the clean one.
describe("analyzeSong cleanup pass", () => {
	const cleanBeats = [
		{ label: "The Start", mood: "tense", scene: "She waits by the door." },
		{ label: "The End", mood: "calm", scene: "She walks out into the cold." },
	];
	// `take` ends on a participial-closure ("..., leaving her alone.") — a HIGH tier1 tell.
	const dirtyRead: SongRead = {
		image: "a dark empty road",
		lens: "a goodbye as a homecoming",
		tension: "Quiet Dread",
		take: "The night ends, leaving her alone.",
		contradiction: null,
		arc: cleanBeats,
		lines: [{ line: "I'm still here" }],
		texture: null,
	};
	// Same read with the tell recast away — what the rewrite call returns.
	const cleanRead: SongRead = {
		...dirtyRead,
		take: "The night ends and she is alone.",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSongAnalysis).mockResolvedValue(Result.ok(null) as any);
		vi.mocked(insertSongAnalysis).mockResolvedValue(Result.ok({} as any));
	});

	it("runs the rewrite on a lyrical read and stores the cleaned version", async () => {
		expect(
			runAllRules(dirtyRead).filter((h) => h.severity === "high"),
		).toHaveLength(1);

		const generateObject = vi
			.fn()
			.mockResolvedValueOnce(
				Result.ok({ output: dirtyRead, model: "test", tokens: { total: 100 } }),
			)
			.mockResolvedValue(
				Result.ok({ output: cleanRead, model: "test", tokens: { total: 50 } }),
			);
		const svc = new SongAnalysisService({ generateObject } as any);

		const res = await svc.analyzeSong({
			songId: "s1",
			artist: "A",
			title: "T",
			lyrics: "word ".repeat(60),
			instrumentalness: 0.1,
		});

		expect(Result.isOk(res)).toBe(true);
		// generation call + at least one rewrite pass
		expect(generateObject.mock.calls.length).toBeGreaterThanOrEqual(2);

		const insertArg = vi.mocked(insertSongAnalysis).mock.calls[0][0];
		const stored = insertArg.analysis as unknown as SongRead;
		expect(stored.take).toBe(cleanRead.take);
		expect(
			runAllRules(stored).filter((h) => h.severity === "high"),
		).toHaveLength(0);

		// Cleanup outcome is persisted: one targeted tell going in, none left, one pass, no error.
		expect(insertArg.cleanup_tells_before).toBe(1);
		expect(insertArg.cleanup_tells_after).toBe(0);
		expect(insertArg.cleanup_passes).toBeGreaterThanOrEqual(1);
		expect(insertArg.cleanup_error).toBeNull();
	});

	it("does not run the rewrite for an instrumental analysis", async () => {
		const instrumental = {
			headline: "h",
			compound_mood: "Quiet Calm",
			mood_description: "d",
			sonic_texture: "s",
		};
		const generateObject = vi.fn().mockResolvedValue(
			Result.ok({
				output: instrumental,
				model: "test",
				tokens: { total: 100 },
			}),
		);
		const svc = new SongAnalysisService({ generateObject } as any);

		const res = await svc.analyzeSong({
			songId: "s2",
			artist: "A",
			title: "T",
			lyrics: null,
		});

		expect(Result.isOk(res)).toBe(true);
		// generation only — the rewrite pass is lyrical-only
		expect(generateObject).toHaveBeenCalledTimes(1);

		// No rewrite ran, so cleanup columns stay null (not 0) for instrumentals.
		const insertArg = vi.mocked(insertSongAnalysis).mock.calls[0][0];
		expect(insertArg.cleanup_passes).toBeNull();
		expect(insertArg.cleanup_tells_before).toBeNull();
		expect(insertArg.cleanup_tells_after).toBeNull();
		expect(insertArg.cleanup_error).toBeNull();
	});
});
