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

import {
	hashMatchingConfig,
	hashRerankerConfig,
} from "@/lib/domains/enrichment/embeddings/hashing";
import { DEFAULT_RERANK_INSTRUCTION } from "@/lib/integrations/providers/types";
import { DEFAULT_RERANKER_CONFIG } from "@/lib/integrations/reranker/service";
import { computeMatchSnapshotMetadata } from "../cache";
import { DEFAULT_MATCHING_CONFIG } from "../config";

describe("hashMatchingConfig", () => {
	it("changing normalization method changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			normalization: {
				...DEFAULT_MATCHING_CONFIG.normalization,
				method: "minmax",
			},
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

	it("changing fallbackSimilarityBaseline changes the hash", async () => {
		const baseline = await hashMatchingConfig(
			DEFAULT_MATCHING_CONFIG as unknown as Record<string, unknown>,
		);

		const tweaked = await hashMatchingConfig({
			...DEFAULT_MATCHING_CONFIG,
			normalization: {
				...DEFAULT_MATCHING_CONFIG.normalization,
				fallbackSimilarityBaseline:
					DEFAULT_MATCHING_CONFIG.normalization.fallbackSimilarityBaseline +
					0.05,
			},
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

	it("changing exclusionSet changes snapshotHash", async () => {
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

		const baseline = await computeMatchSnapshotMetadata(songs, profiles);
		const withExclusions = await computeMatchSnapshotMetadata(
			songs,
			profiles,
			{},
			new Set(["song-1:playlist-1"]),
		);

		expect(withExclusions.snapshotHash).not.toBe(baseline.snapshotHash);
	});
});

describe("rerankerConfigHash busting", () => {
	it("changing the instruction inside the config produces a different hash", async () => {
		const baseline = await hashRerankerConfig({
			model: null,
			provider: null,
			config: { ...DEFAULT_RERANKER_CONFIG, instruction: "instruction A" },
			documentMode: "analysis",
		});
		const changed = await hashRerankerConfig({
			model: null,
			provider: null,
			config: { ...DEFAULT_RERANKER_CONFIG, instruction: "instruction B" },
			documentMode: "analysis",
		});
		expect(changed).not.toBe(baseline);
	});

	it("changing documentMode produces a different hash", async () => {
		const analysis = await hashRerankerConfig({
			model: null,
			provider: null,
			config: DEFAULT_RERANKER_CONFIG,
			documentMode: "analysis",
		});
		const metadata = await hashRerankerConfig({
			model: null,
			provider: null,
			config: DEFAULT_RERANKER_CONFIG,
			documentMode: "metadata",
		});
		expect(metadata).not.toBe(analysis);
	});

	it("identical inputs produce identical hash (deterministic)", async () => {
		const a = await hashRerankerConfig({
			model: null,
			provider: null,
			config: DEFAULT_RERANKER_CONFIG,
			documentMode: "analysis",
		});
		const b = await hashRerankerConfig({
			model: null,
			provider: null,
			config: DEFAULT_RERANKER_CONFIG,
			documentMode: "analysis",
		});
		expect(a).toBe(b);
	});

	it("the default config carries the canonical instruction", () => {
		expect(DEFAULT_RERANKER_CONFIG.instruction).toBe(
			DEFAULT_RERANK_INSTRUCTION,
		);
	});

	it("rerankDocumentMode changes the snapshotHash", async () => {
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

		const metadata = await computeMatchSnapshotMetadata(
			songs,
			profiles,
			{},
			undefined,
			"metadata",
		);
		const analysis = await computeMatchSnapshotMetadata(
			songs,
			profiles,
			{},
			undefined,
			"analysis",
		);

		expect(analysis.snapshotHash).not.toBe(metadata.snapshotHash);
	});
});
