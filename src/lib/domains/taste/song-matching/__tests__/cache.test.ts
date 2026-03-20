import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

vi.mock(
	"@/lib/domains/enrichment/embeddings/versioning",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/lib/domains/enrichment/embeddings/versioning")
			>();
		return {
			...actual,
			getModelBundleHash: vi.fn(async () => Result.ok("mb_test")),
		};
	},
);

vi.mock("@/lib/integrations/providers/factory", () => ({
	getMlProvider: vi.fn(() => Result.err({ message: "unavailable" } as any)),
}));

import { hashMatchingConfig } from "@/lib/domains/enrichment/embeddings/hashing";
import { computeMatchContextMetadata } from "../cache";
import { DEFAULT_MATCHING_CONFIG } from "../config";

describe("hashMatchingConfig", () => {
	it("changing similarityBaseline changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			similarityBaseline: DEFAULT_MATCHING_CONFIG.similarityBaseline + 0.1,
		} as unknown as Record<string, unknown>);

		expect(tweaked).not.toBe(baseline);
	});

	it("changing skipVectorScoring changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			skipVectorScoring: !DEFAULT_MATCHING_CONFIG.skipVectorScoring,
		} as unknown as Record<string, unknown>);

		expect(tweaked).not.toBe(baseline);
	});

	it("changing vetoThreshold changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			vetoThreshold: DEFAULT_MATCHING_CONFIG.vetoThreshold + 0.05,
		} as unknown as Record<string, unknown>);

		expect(tweaked).not.toBe(baseline);
	});

	it("changing maxResultsPerSong changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			maxResultsPerSong: DEFAULT_MATCHING_CONFIG.maxResultsPerSong + 5,
		} as unknown as Record<string, unknown>);

		expect(tweaked).not.toBe(baseline);
	});

	it("identical config produces identical hash", async () => {
		const a = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);
		const b = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		expect(a).toBe(b);
	});

	it("changing exclusionSet changes contextHash", async () => {
		const songs = [
			{
				id: "song-1",
				spotifyId: "sp-1",
				name: "Alpha",
				artists: ["Artist"],
				genres: ["pop"],
			},
		];
		const profiles = [
			{
				playlistId: "playlist-1",
				embedding: [0.1, 0.2],
				audioCentroid: { energy: 0.5 },
				genreDistribution: { pop: 1 },
			},
		];

		const baseline = await computeMatchContextMetadata(songs, profiles);
		const withExclusions = await computeMatchContextMetadata(
			songs,
			profiles,
			{},
			new Set(["song-1:playlist-1"]),
		);

		expect(withExclusions.contextHash).not.toBe(baseline.contextHash);
	});
});
