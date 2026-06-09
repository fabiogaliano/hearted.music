import { describe, expect, it, vi } from "vitest";
import { computeCostUsd, getModelPrice } from "./pricing";

const FLASH = "gemini-2.5-flash";
const FLASH_LITE = "gemini-2.5-flash-lite";
const VERTEX = "google-vertex";

describe("getModelPrice", () => {
	it("returns Vertex rates for gemini-2.5-flash", () => {
		expect(getModelPrice(VERTEX, FLASH)).toEqual({
			inputPerToken: 3e-7,
			cacheReadPerToken: 3e-8,
			outputPerToken: 2.5e-6,
		});
	});

	it("returns Vertex rates for gemini-2.5-flash-lite", () => {
		expect(getModelPrice(VERTEX, FLASH_LITE)).toEqual({
			inputPerToken: 1e-7,
			cacheReadPerToken: 1e-8,
			outputPerToken: 4e-7,
		});
	});

	it("normalizes a combined provider:model id to the bare key", () => {
		expect(getModelPrice(VERTEX, "google-vertex:gemini-2.5-flash")).toEqual(
			getModelPrice(VERTEX, FLASH),
		);
	});

	it("returns null for an unknown model", () => {
		expect(getModelPrice(VERTEX, "gemini-9.9-imaginary")).toBeNull();
	});
});

describe("computeCostUsd", () => {
	it("splits input into non-cached + cached, billing cache at the cheaper rate", () => {
		// flash: 600 non-cached @3e-7 + 400 cached @3e-8 + 500 output @2.5e-6 = 0.001442
		const cost = computeCostUsd(
			{ inputTokens: 1000, cacheReadTokens: 400, outputTokens: 500 },
			VERTEX,
			FLASH,
		);
		expect(cost).toBeCloseTo(600 * 3e-7 + 400 * 3e-8 + 500 * 2.5e-6, 12);
		expect(cost).toBeCloseTo(0.001442, 12);
	});

	it("bills the full output total at the output rate (thinking already folded in)", () => {
		// outputTokens already includes thinking — there is no separate reasoning term.
		const cost = computeCostUsd(
			{ inputTokens: 100, outputTokens: 1000 },
			VERTEX,
			FLASH,
		);
		expect(cost).toBeCloseTo(100 * 3e-7 + 1000 * 2.5e-6, 12);
	});

	it("treats absent cacheReadTokens as zero cached", () => {
		const cost = computeCostUsd(
			{ inputTokens: 1000, outputTokens: 500 },
			VERTEX,
			FLASH_LITE,
		);
		expect(cost).toBeCloseTo(1000 * 1e-7 + 500 * 4e-7, 12);
	});

	it("returns null (not 0) for an unpriced model", () => {
		expect(
			computeCostUsd(
				{ inputTokens: 100, outputTokens: 100 },
				VERTEX,
				"unknown",
			),
		).toBeNull();
	});
});

// The fallback only fires for a model whose snapshot entry has a null cache rate;
// both real Gemini models define one, so inject a synthetic model to exercise it.
describe("computeCostUsd cacheRead rate fallback", () => {
	it("falls back to the input rate when a model has no cache-read price", async () => {
		vi.resetModules();
		vi.doMock("./model-prices.generated.json", () => ({
			default: {
				_synced_at: "test",
				models: {
					"nocache-model": {
						source_key: "nocache-model",
						input_cost_per_token: 2e-6,
						output_cost_per_token: 5e-6,
						cache_read_input_token_cost: null,
					},
				},
			},
		}));

		const { computeCostUsd: fresh } = await import("./pricing");
		// 700 non-cached + 300 cached, both @2e-6 (no cache rate → input rate), + 100 output @5e-6
		const cost = fresh(
			{ inputTokens: 1000, cacheReadTokens: 300, outputTokens: 100 },
			"openai",
			"nocache-model",
		);
		expect(cost).toBeCloseTo(1000 * 2e-6 + 100 * 5e-6, 12);

		vi.doUnmock("./model-prices.generated.json");
		vi.resetModules();
	});
});
