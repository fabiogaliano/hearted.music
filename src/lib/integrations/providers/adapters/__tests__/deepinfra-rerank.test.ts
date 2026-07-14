/**
 * Pins the DeepInfra Qwen3-Reranker request/response contract.
 *
 * The original integration silently sent the Cohere/Jina shape
 * ({query, documents, return_documents} → results[].relevance_score), which
 * DeepInfra rejected — response validation failed and reranking was skipped
 * on every call. These tests pin the verified contract (parallel arrays in,
 * positional scores out) so a regression to the old shape fails the suite
 * instead of degrading silently in production.
 */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: { DEEPINFRA_API_KEY: "test-key" },
}));

import { rerank } from "@/lib/integrations/deepinfra/service";
import { DEFAULT_RERANK_INSTRUCTION } from "@/lib/integrations/providers/types";

const RERANKER_URL =
	"https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B";

function mockFetchResponse(body: unknown, status = 200) {
	const fetchMock = vi.fn(
		async () => new Response(JSON.stringify(body), { status }),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function requestBodyOf(fetchMock: ReturnType<typeof vi.fn>): {
	url: string;
	body: Record<string, unknown>;
} {
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
	return { url, body: JSON.parse(init.body as string) };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deepinfra rerank contract", () => {
	it("sends parallel queries/documents arrays and parses positional scores", async () => {
		const fetchMock = mockFetchResponse({
			scores: [0.2, 0.9],
			input_tokens: 12,
			inference_status: { status: "succeeded" },
		});

		const result = await rerank("playlist query", ["doc one", "doc two"], {
			instruction: "custom instruction",
		});

		const { url, body } = requestBodyOf(fetchMock);
		expect(url).toBe(RERANKER_URL);
		// Pairwise contract: the query is repeated once per document
		expect(body.queries).toEqual(["playlist query", "playlist query"]);
		expect(body.documents).toEqual(["doc one", "doc two"]);
		expect(body.instruction).toBe("custom instruction");
		// Legacy Cohere/Jina fields must never reappear
		expect(body).not.toHaveProperty("query");
		expect(body).not.toHaveProperty("return_documents");
		expect(body).not.toHaveProperty("top_n");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			// scores[i] is positional; results come back sorted by score desc
			expect(result.value.scores).toEqual([
				{ index: 1, score: 0.9 },
				{ index: 0, score: 0.2 },
			]);
			expect(result.value.model).toBe("Qwen/Qwen3-Reranker-0.6B");
		}
	});

	it("sends the canonical instruction when none is provided", async () => {
		const fetchMock = mockFetchResponse({ scores: [0.5] });

		await rerank("q", ["d"]);

		const { body } = requestBodyOf(fetchMock);
		expect(body.instruction).toBe(DEFAULT_RERANK_INSTRUCTION);
	});

	it("rejects the legacy Cohere/Jina response shape", async () => {
		mockFetchResponse({
			results: [{ index: 0, relevance_score: 0.9 }],
		});

		const result = await rerank("q", ["d"]);

		expect(Result.isError(result)).toBe(true);
	});

	it("targets the overridden model's inference URL and reports it back", async () => {
		const fetchMock = mockFetchResponse({ scores: [0.7] });

		const result = await rerank("q", ["d"], {
			model: "Qwen/Qwen3-Reranker-4B",
		});

		const { url } = requestBodyOf(fetchMock);
		expect(url).toBe(
			"https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-4B",
		);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value.model).toBe("Qwen/Qwen3-Reranker-4B");
		}
	});

	it("returns an empty result without calling the API for zero documents", async () => {
		const fetchMock = mockFetchResponse({ scores: [] });

		const result = await rerank("q", []);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value.scores).toEqual([]);
		}
	});
});
