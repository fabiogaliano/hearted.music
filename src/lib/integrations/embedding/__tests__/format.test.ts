import { describe, expect, it } from "vitest";
import {
	EMBEDDING_TASK_DESCRIPTION,
	formatEmbeddingInput,
	truncateAndNormalize,
} from "../format";

describe("formatEmbeddingInput", () => {
	it("wraps queries with the Instruct/Query format for instruction-tuned models", () => {
		const out = formatEmbeddingInput("dreamy late-night drive", "query", true);
		expect(out).toBe(
			`Instruct: ${EMBEDDING_TASK_DESCRIPTION}\nQuery:dreamy late-night drive`,
		);
	});

	it("leaves documents unprefixed for instruction-tuned models", () => {
		const text = "a song analysis about heartbreak and neon";
		expect(formatEmbeddingInput(text, "passage", true)).toBe(text);
	});

	it("passes text through verbatim for non-instruct models on both roles", () => {
		const text = "symmetric model input";
		expect(formatEmbeddingInput(text, "query", false)).toBe(text);
		expect(formatEmbeddingInput(text, "passage", false)).toBe(text);
	});
});

describe("truncateAndNormalize", () => {
	it("truncates to the target dimension", () => {
		const vec = Array.from({ length: 1024 }, (_, i) => i + 1);
		const out = truncateAndNormalize(vec, 512);
		expect(out).toHaveLength(512);
	});

	it("returns a unit vector after truncation", () => {
		const vec = Array.from({ length: 1024 }, (_, i) => (i % 7) - 3 + 0.5);
		const out = truncateAndNormalize(vec, 512);
		const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
		expect(norm).toBeCloseTo(1, 10);
	});

	it("renormalizes but does not pad vectors shorter than the target", () => {
		const vec = [3, 4]; // norm 5
		const out = truncateAndNormalize(vec, 512);
		expect(out).toHaveLength(2);
		expect(out[0]).toBeCloseTo(0.6, 10);
		expect(out[1]).toBeCloseTo(0.8, 10);
	});

	it("leaves an all-zero vector untouched instead of dividing by zero", () => {
		const vec = new Array(1024).fill(0);
		const out = truncateAndNormalize(vec, 512);
		expect(out).toHaveLength(512);
		expect(out.every((v) => v === 0)).toBe(true);
	});
});
