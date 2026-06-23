import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSongEmbeddingsBatch = vi.fn();
const mockGetSongAnalysis = vi.fn();
const mockUpsertSongEmbeddings = vi.fn();
const mockProviderEmbedBatch = vi.fn();

vi.mock("@/lib/integrations/providers/factory", () => ({
	getMlProvider: () =>
		Result.ok({
			getMetadata: () => ({ embeddingModel: "test-model", embeddingDims: 3 }),
			embed: vi.fn(),
			embedBatch: (...args: unknown[]) => mockProviderEmbedBatch(...args),
		}),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (...args: unknown[]) => mockGetSongAnalysis(...args),
}));

vi.mock("@/lib/domains/enrichment/embeddings/queries", () => ({
	getSongEmbedding: vi.fn(),
	getSongEmbeddingsBatch: (...args: unknown[]) =>
		mockGetSongEmbeddingsBatch(...args),
	upsertSongEmbedding: vi.fn(),
	upsertSongEmbeddings: (...args: unknown[]) =>
		mockUpsertSongEmbeddings(...args),
}));

vi.mock("../versioning", () => ({
	getModelBundleHash: () => Promise.resolve(Result.ok("bundle-1")),
}));

import { EmbeddingService } from "../service";

// buildEmbeddingText reads the `analysis` JSON; a headline-only row yields the
// headline verbatim, giving a deterministic text to hash against.
const ANALYSIS_ROW = { song_id: "s1", analysis: { headline: "Test headline" } };

function makeService(): EmbeddingService {
	const result = EmbeddingService.create();
	if (Result.isError(result)) throw result.error;
	return result.value;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetSongAnalysis.mockResolvedValue(
		Result.ok(new Map([["s1", ANALYSIS_ROW]])),
	);
	mockProviderEmbedBatch.mockResolvedValue(
		Result.ok([{ embedding: [0, 1, 2], dims: 3 }]),
	);
	mockUpsertSongEmbeddings.mockResolvedValue(
		Result.ok([{ song_id: "s1", content_hash: "new" }]),
	);
});

describe("EmbeddingService.embedBatch content-hash freshness", () => {
	it("re-embeds when the stored content_hash no longer matches the current analysis", async () => {
		const svc = makeService();
		// A re-analyzed song's stored vector was built from the old analysis text,
		// so its content_hash differs from the current one — it must re-embed.
		mockGetSongEmbeddingsBatch.mockResolvedValue(
			Result.ok(
				new Map([["s1", { song_id: "s1", content_hash: "stale-hash" }]]),
			),
		);

		const result = await svc.embedBatch(["s1"]);

		expect(Result.isOk(result)).toBe(true);
		expect(mockProviderEmbedBatch).toHaveBeenCalledTimes(1);
		expect(mockUpsertSongEmbeddings).toHaveBeenCalledTimes(1);
	});

	it("treats a matching content_hash as cached without calling the provider", async () => {
		const svc = makeService();
		// Reach the private hashing helpers so the expected hash matches exactly
		// what embedBatch computes from the same analysis row.
		const text = (svc as any).buildEmbeddingText(ANALYSIS_ROW);
		const hash = await (svc as any).hashContent(text);

		mockGetSongEmbeddingsBatch.mockResolvedValue(
			Result.ok(new Map([["s1", { song_id: "s1", content_hash: hash }]])),
		);

		const result = await svc.embedBatch(["s1"]);

		expect(Result.isOk(result)).toBe(true);
		expect(mockProviderEmbedBatch).not.toHaveBeenCalled();
		expect(mockUpsertSongEmbeddings).not.toHaveBeenCalled();
		if (Result.isOk(result)) {
			expect(result.value.succeeded).toHaveLength(1);
			expect(result.value.succeeded[0].cached).toBe(true);
		}
	});

	it("re-embeds a song that has no stored embedding yet", async () => {
		const svc = makeService();
		mockGetSongEmbeddingsBatch.mockResolvedValue(Result.ok(new Map()));

		const result = await svc.embedBatch(["s1"]);

		expect(Result.isOk(result)).toBe(true);
		expect(mockProviderEmbedBatch).toHaveBeenCalledTimes(1);
		expect(mockUpsertSongEmbeddings).toHaveBeenCalledTimes(1);
	});
});
