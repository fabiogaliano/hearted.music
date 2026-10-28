import { describe, expect, it } from "vitest";
import { checkEmbeddingSpace } from "../boot-checks";

const qwen = { model: "Qwen/Qwen3-Embedding-0.6B", dims: 512 };

describe("checkEmbeddingSpace", () => {
	it("lets a fresh database with no stored vectors boot", () => {
		expect(checkEmbeddingSpace(qwen, [])).toBeOk();
	});

	it("accepts a store holding only the provider's model and dims", () => {
		expect(checkEmbeddingSpace(qwen, [qwen])).toBeOk();
	});

	it("refuses the anonymous HuggingFace fallback against Qwen vectors", () => {
		expect(
			checkEmbeddingSpace(
				{ model: "sentence-transformers/all-MiniLM-L6-v2", dims: 384 },
				[qwen],
			),
		).toBeErr();
	});

	it("refuses a store that still holds another model next to the provider's", () => {
		expect(
			checkEmbeddingSpace(qwen, [
				qwen,
				{ model: "sentence-transformers/all-MiniLM-L6-v2", dims: 384 },
			]),
		).toBeErr();
	});

	it("refuses the same model at a different size", () => {
		expect(checkEmbeddingSpace(qwen, [{ ...qwen, dims: 1024 }])).toBeErr();
	});
});
