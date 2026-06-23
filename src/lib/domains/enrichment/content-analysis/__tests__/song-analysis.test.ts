import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	get as getSongAnalysis,
	upsert as upsertSongAnalysis,
} from "@/lib/domains/enrichment/content-analysis/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { recordLlmUsage } from "../llm-usage-queries";
import type { SongRead } from "../read-schema";
import type { AnalyzeSongInput } from "../song-analysis";
import { isRetryCandidate, SongAnalysisService } from "../song-analysis";
import { runAllRules } from "../voice/tier1-rules";

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: vi.fn(),
	upsert: vi.fn(),
}));
vi.mock("../llm-usage-queries", () => ({
	recordLlmUsage: vi.fn(),
}));
vi.mock("../../lyrics/queries", () => ({
	settleInstrumentalFromAnalysis: vi.fn(),
}));
vi.mock("../instrumental-review-queries", () => ({
	hasRejectedInstrumentalReview: vi.fn(),
	upsertPendingInstrumentalReview: vi.fn(),
}));

import { settleInstrumentalFromAnalysis } from "../../lyrics/queries";
import {
	hasRejectedInstrumentalReview,
	upsertPendingInstrumentalReview,
} from "../instrumental-review-queries";

const service = new SongAnalysisService({} as any);
const classify = (input: Partial<AnalyzeSongInput>) =>
	service.classifyContentType({
		songId: "1",
		artist: "Test",
		title: "Test",
		...input,
	});

describe("classifyContentType (replaces detectInstrumental)", () => {
	it("returns instrumental when lyrics are null", () => {
		// No lyrics, no genre, no instrumentalness → unknown (not instrumental)
		// The old detectInstrumental would have said true; now we need more signal.
		expect(classify({ lyrics: null })).toBe("unknown");
	});

	it("returns instrumental when lyrics are empty and genres include 'instrumental'", () => {
		expect(classify({ lyrics: "", genres: ["instrumental"] })).toBe(
			"instrumental",
		);
	});

	it("returns instrumental for empty lyrics with instrumentalness ≥ 0.9", () => {
		expect(classify({ lyrics: "", instrumentalness: 0.95 })).toBe(
			"instrumental",
		);
	});

	it("returns unknown for empty lyrics with no strong signal", () => {
		expect(classify({ lyrics: "" })).toBe("unknown");
	});

	it("returns unknown for whitespace-only lyrics with no strong signal", () => {
		expect(classify({ lyrics: "   " })).toBe("unknown");
	});

	// Regression: a song we hold real lyrics for must be analyzed lyrically even
	// when Spotify reports a high instrumentalness. The old order trusted that
	// score first and misrouted vocal songs (Lorde's "Ribs" at 0.61, Hot Chip's
	// "Need You Now" at 0.70) to the instrumental read the panel can't render.
	it("stays lyrical with full lyrics despite a high instrumentalness score", () => {
		expect(
			classify({ lyrics: "word ".repeat(60), instrumentalness: 0.8 }),
		).toBe("lyrical");
	});

	it("stays lyrical with full lyrics despite high audioFeatures.instrumentalness", () => {
		expect(
			classify({
				lyrics: "word ".repeat(60),
				audioFeatures: { instrumentalness: 0.7 } as any,
			}),
		).toBe("lyrical");
	});

	it("returns unknown (not lyrical) when lyrics have fewer than 50 words and no other signal", () => {
		expect(classify({ lyrics: "word ".repeat(30) })).toBe("unknown");
	});

	it("returns lyrical for song with sufficient words", () => {
		expect(
			classify({ lyrics: "word ".repeat(60), instrumentalness: 0.1 }),
		).toBe("lyrical");
	});
});

describe("analyzeSong cache control", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSongAnalysis).mockResolvedValue(Result.ok(null) as any);
		vi.mocked(upsertSongAnalysis).mockResolvedValue(Result.ok({} as any));
		vi.mocked(recordLlmUsage).mockResolvedValue(Result.ok(undefined));
	});

	it("bypasses the existing-analysis cache when ignoreExistingAnalysis is true", async () => {
		vi.mocked(getSongAnalysis).mockResolvedValue(
			Result.ok({ song_id: "s1", analysis: {}, model: "cached" } as any),
		);
		const generateObject = vi.fn().mockResolvedValue(
			Result.ok({
				output: {
					headline: "h",
					compound_mood: "Quiet Calm",
					mood_description: "d",
					sonic_texture: "s",
				},
				model: "google-vertex:gemini-2.5-flash",
				modelId: "gemini-2.5-flash",
				provider: "google-vertex",
				tokens: {
					prompt: 1,
					completion: 1,
					total: 2,
					cacheReadTokens: 0,
					reasoningTokens: 0,
				},
				costUsd: 0.0001,
			}),
		);
		const svc = new SongAnalysisService({ generateObject } as any);

		const result = await svc.analyzeSong({
			songId: "s1",
			artist: "A",
			title: "T",
			fetchOutcome: { kind: "instrumental", source: "lrclib" },
			ignoreExistingAnalysis: true,
		});

		expect(Result.isOk(result)).toBe(true);
		expect(generateObject).toHaveBeenCalledTimes(1);
		expect(upsertSongAnalysis).toHaveBeenCalledTimes(1);
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

	// A service generation/rewrite result carries the bare modelId, provider, the full
	// token split, and the cost estimate — what the ledger rows are built from.
	const genResult = (output: unknown, total: number) =>
		Result.ok({
			output,
			model: "google-vertex:gemini-2.5-flash",
			modelId: "gemini-2.5-flash",
			provider: "google-vertex",
			tokens: {
				prompt: total - 100,
				completion: 100,
				total,
				cacheReadTokens: 0,
				reasoningTokens: 0,
			},
			costUsd: 0.0005,
		});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSongAnalysis).mockResolvedValue(Result.ok(null) as any);
		vi.mocked(upsertSongAnalysis).mockResolvedValue(Result.ok({} as any));
		vi.mocked(recordLlmUsage).mockResolvedValue(Result.ok(undefined));
	});

	it("runs the rewrite on a lyrical read and stores the cleaned version", async () => {
		expect(
			runAllRules(dirtyRead).filter((h) => h.severity === "high"),
		).toHaveLength(1);

		const generateObject = vi
			.fn()
			.mockResolvedValueOnce(genResult(dirtyRead, 1000))
			.mockResolvedValue(genResult(cleanRead, 800));
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

		const insertArg = vi.mocked(upsertSongAnalysis).mock.calls[0][0];
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

		// Ledger: one generation row + one rewrite row, both for this song, with the
		// bare model id and provider (so the rewrite tokens are no longer discarded).
		const usageCalls = vi.mocked(recordLlmUsage).mock.calls.map((c) => c[0]);
		expect(usageCalls).toHaveLength(2);
		expect(
			usageCalls.find((u) => u.functionId === "song-analysis"),
		).toMatchObject({
			songId: "s1",
			model: "gemini-2.5-flash",
			provider: "google-vertex",
		});
		expect(
			usageCalls.find((u) => u.functionId === "song-rewrite"),
		).toMatchObject({
			songId: "s1",
			model: "gemini-2.5-flash",
			provider: "google-vertex",
		});
	});

	it("does not run the rewrite for an instrumental analysis", async () => {
		const instrumental = {
			headline: "h",
			compound_mood: "Quiet Calm",
			mood_description: "d",
			sonic_texture: "s",
		};
		const generateObject = vi
			.fn()
			.mockResolvedValue(genResult(instrumental, 100));
		const svc = new SongAnalysisService({ generateObject } as any);

		// Use a confirmed-instrumental fetch outcome so the classifier routes to
		// the instrumental prompt rather than returning retry_candidate.
		const res = await svc.analyzeSong({
			songId: "s2",
			artist: "A",
			title: "T",
			lyrics: null,
			fetchOutcome: { kind: "instrumental", source: "lrclib" },
		});

		expect(Result.isOk(res)).toBe(true);
		if (Result.isOk(res)) {
			expect(isRetryCandidate(res.value)).toBe(false);
		}
		// generation only — the rewrite pass is lyrical-only
		expect(generateObject).toHaveBeenCalledTimes(1);

		// No rewrite ran, so cleanup columns stay null (not 0) for instrumentals.
		const insertArg = vi.mocked(upsertSongAnalysis).mock.calls[0][0];
		expect(insertArg.cleanup_passes).toBeNull();
		expect(insertArg.cleanup_tells_before).toBeNull();
		expect(insertArg.cleanup_tells_after).toBeNull();
		expect(insertArg.cleanup_error).toBeNull();

		// Exactly one ledger row (the generation), no song-rewrite row.
		const usageCalls = vi.mocked(recordLlmUsage).mock.calls.map((c) => c[0]);
		expect(usageCalls).toHaveLength(1);
		expect(usageCalls[0]).toMatchObject({
			functionId: "song-analysis",
			songId: "s2",
		});
	});

	it("does not fail the analysis when a ledger insert fails", async () => {
		// Real failure mode: recordLlmUsage returns Result.err (e.g. the insert was
		// rejected). The generation + rewrite rows both fail, yet the analysis succeeds.
		vi.mocked(recordLlmUsage).mockResolvedValue(
			Result.err(new DatabaseError({ code: "x", message: "ledger down" })),
		);
		const generateObject = vi.fn().mockResolvedValue(genResult(dirtyRead, 900));
		const svc = new SongAnalysisService({ generateObject } as any);

		const res = await svc.analyzeSong({
			songId: "s3",
			artist: "A",
			title: "T",
			lyrics: "word ".repeat(60),
			instrumentalness: 0.1,
		});

		expect(Result.isOk(res)).toBe(true);
		expect(vi.mocked(recordLlmUsage).mock.calls.length).toBeGreaterThanOrEqual(
			1,
		);
	});
});

describe("analyzeSong instrumental settle + review (Task 2)", () => {
	const instrumentalOutput = {
		headline: "h",
		compound_mood: "Quiet Calm",
		mood_description: "d",
		sonic_texture: "s",
	};

	function instrumentalGen() {
		return vi.fn().mockResolvedValue(
			Result.ok({
				output: instrumentalOutput,
				model: "google-vertex:gemini-2.5-flash",
				modelId: "gemini-2.5-flash",
				provider: "google-vertex",
				tokens: {
					prompt: 1,
					completion: 1,
					total: 2,
					cacheReadTokens: 0,
					reasoningTokens: 0,
				},
				costUsd: 0.0001,
			}),
		);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSongAnalysis).mockResolvedValue(Result.ok(null) as any);
		vi.mocked(upsertSongAnalysis).mockResolvedValue(Result.ok({} as any));
		vi.mocked(recordLlmUsage).mockResolvedValue(Result.ok(undefined));
		vi.mocked(settleInstrumentalFromAnalysis).mockResolvedValue(
			Result.ok({} as any),
		);
		vi.mocked(upsertPendingInstrumentalReview).mockResolvedValue(
			Result.ok({ id: "rev-1" }),
		);
		vi.mocked(hasRejectedInstrumentalReview).mockResolvedValue(false);
	});

	it("settles + logs a pending review for a genre-determined instrumental (fetch not_found)", async () => {
		const svc = new SongAnalysisService({
			generateObject: instrumentalGen(),
		} as any);
		const res = await svc.analyzeSong({
			songId: "s1",
			artist: "A",
			title: "T",
			lyrics: "",
			genres: ["ambient"],
			instrumentalness: 0.3,
			fetchOutcome: { kind: "not_found" },
		});

		expect(Result.isOk(res)).toBe(true);
		expect(settleInstrumentalFromAnalysis).toHaveBeenCalledWith("s1");
		const reviewArg = vi.mocked(upsertPendingInstrumentalReview).mock
			.calls[0][0];
		expect(reviewArg.signal).toBe("genre");
		expect(reviewArg.matchedGenre).toBe("ambient");
	});

	it("records signal=instrumentalness when no genre matched", async () => {
		const svc = new SongAnalysisService({
			generateObject: instrumentalGen(),
		} as any);
		await svc.analyzeSong({
			songId: "s2",
			artist: "A",
			title: "T",
			lyrics: "",
			instrumentalness: 0.95,
			fetchOutcome: { kind: "not_found" },
		});

		const reviewArg = vi.mocked(upsertPendingInstrumentalReview).mock
			.calls[0][0];
		expect(reviewArg.signal).toBe("instrumentalness");
		expect(reviewArg.instrumentalness).toBe(0.95);
		expect(reviewArg.matchedGenre).toBeNull();
	});

	it("does NOT settle when the instrumental verdict came from the fetch outcome", async () => {
		const svc = new SongAnalysisService({
			generateObject: instrumentalGen(),
		} as any);
		await svc.analyzeSong({
			songId: "s3",
			artist: "A",
			title: "T",
			fetchOutcome: { kind: "instrumental", source: "lrclib" },
		});

		expect(settleInstrumentalFromAnalysis).not.toHaveBeenCalled();
		expect(upsertPendingInstrumentalReview).not.toHaveBeenCalled();
	});

	it("honors a prior rejection: retry_candidate, no LLM call, no settle", async () => {
		vi.mocked(hasRejectedInstrumentalReview).mockResolvedValue(true);
		const generateObject = instrumentalGen();
		const svc = new SongAnalysisService({ generateObject } as any);

		const res = await svc.analyzeSong({
			songId: "s4",
			artist: "A",
			title: "T",
			lyrics: "",
			genres: ["ambient"],
			fetchOutcome: { kind: "not_found" },
		});

		expect(Result.isOk(res)).toBe(true);
		expect(isRetryCandidate((res as any).value)).toBe(true);
		expect(generateObject).not.toHaveBeenCalled();
		expect(upsertSongAnalysis).not.toHaveBeenCalled();
		expect(settleInstrumentalFromAnalysis).not.toHaveBeenCalled();
	});
});
