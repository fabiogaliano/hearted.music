import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMatchBatch = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/service", () => ({
	createMatchingService: (...args: unknown[]) => ({
		matchBatch: (...batchArgs: unknown[]) => mockMatchBatch(...batchArgs),
		__ctorArgs: args,
	}),
}));

const { runScoring } = await import("../matching");

function pair(songId: string, playlistId: string, score: number) {
	return {
		songId,
		playlistId,
		score,
		fusedScore: score,
		rank: 1,
		factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
		normalizedFactors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
		confidence: score,
		fromCache: false,
	};
}

describe("runScoring", () => {
	beforeEach(() => vi.clearAllMocks());

	it("flattens matchBatch results into retained storedPairs", async () => {
		mockMatchBatch.mockResolvedValue(
			Result.ok({
				matches: new Map([["s1", [pair("s1", "p1", 0.9)]]]),
			}),
		);

		const result = await runScoring(
			{} as never,
			{} as never,
			[],
			[],
			new Map(),
			undefined,
		);

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value.storedPairs).toHaveLength(1);
			expect(result.value.storedPairs[0]).toMatchObject({
				songId: "s1",
				playlistId: "p1",
			});
			expect(result.value.matches.size).toBe(1);
		}
	});

	it("forwards the exclusion set to matchBatch only when non-empty", async () => {
		mockMatchBatch.mockResolvedValue(Result.ok({ matches: new Map() }));
		const exclusionSet = new Set(["s1:p1"]);

		await runScoring({} as never, {} as never, [], [], new Map(), exclusionSet);

		const [, , , opts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			{ exclusionSet: Set<string> } | undefined,
		];
		expect(opts?.exclusionSet).toBe(exclusionSet);
	});

	it("passes undefined options when the exclusion set is undefined", async () => {
		mockMatchBatch.mockResolvedValue(Result.ok({ matches: new Map() }));

		await runScoring({} as never, {} as never, [], [], new Map(), undefined);

		const [, , , opts] = mockMatchBatch.mock.calls[0] as [
			unknown,
			unknown,
			unknown,
			unknown,
		];
		expect(opts).toBeUndefined();
	});

	it("propagates a matchBatch error without computing storedPairs", async () => {
		mockMatchBatch.mockResolvedValue(Result.err({ message: "scoring failed" }));

		const result = await runScoring(
			{} as never,
			{} as never,
			[],
			[],
			new Map(),
			undefined,
		);

		expect(Result.isError(result)).toBe(true);
	});
});
