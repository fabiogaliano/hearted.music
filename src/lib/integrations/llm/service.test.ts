import { generateObject, generateText } from "ai";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmService } from "./service";

// Mock only the two generation entry points; keep the rest of the SDK (error
// classes used by normalizeError) real.
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return { ...actual, generateText: vi.fn(), generateObject: vi.fn() };
});

// A google (AI-Studio) service defaults to gemini-2.5-flash, which the price
// snapshot covers — so costUsd is a real number, not null.
const svc = new LlmService({ provider: "google", apiKey: "test" });

// 1000 prompt incl. 400 cached read; 500 output incl. 100 thinking.
const FULL_USAGE = {
	inputTokens: 1000,
	outputTokens: 500,
	totalTokens: 1500,
	inputTokenDetails: { cacheReadTokens: 400 },
	outputTokenDetails: { reasoningTokens: 100 },
};

// flash: 600 non-cached @3e-7 + 400 cached @3e-8 + 500 output @2.5e-6
const EXPECTED_COST = 600 * 3e-7 + 400 * 3e-8 + 500 * 2.5e-6;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("generateText usage + cost enrichment", () => {
	it("maps cache-read and reasoning splits and attaches provider/modelId/costUsd", async () => {
		vi.mocked(generateText).mockResolvedValue({
			text: "ok",
			usage: FULL_USAGE,
		} as never);

		const res = await svc.generateText("prompt");
		expect(Result.isOk(res)).toBe(true);
		if (!Result.isOk(res)) return;

		expect(res.value.provider).toBe("google");
		expect(res.value.modelId).toBe("gemini-2.5-flash");
		expect(res.value.model).toBe("google:gemini-2.5-flash");
		expect(res.value.tokens).toEqual({
			prompt: 1000,
			completion: 500,
			total: 1500,
			cacheReadTokens: 400,
			reasoningTokens: 100,
		});
		expect(res.value.costUsd).toBeCloseTo(EXPECTED_COST, 12);
	});

	it("defaults the splits to 0 when the provider omits token details", async () => {
		vi.mocked(generateText).mockResolvedValue({
			text: "ok",
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		} as never);

		const res = await svc.generateText("prompt");
		if (!Result.isOk(res)) throw new Error("expected ok");
		expect(res.value.tokens).toEqual({
			prompt: 100,
			completion: 50,
			total: 150,
			cacheReadTokens: 0,
			reasoningTokens: 0,
		});
		expect(res.value.costUsd).toBeCloseTo(100 * 3e-7 + 50 * 2.5e-6, 12);
	});

	it("returns undefined tokens and null cost when usage is absent", async () => {
		vi.mocked(generateText).mockResolvedValue({ text: "ok" } as never);

		const res = await svc.generateText("prompt");
		if (!Result.isOk(res)) throw new Error("expected ok");
		expect(res.value.tokens).toBeUndefined();
		expect(res.value.costUsd).toBeNull();
	});
});

describe("generateObject usage + cost enrichment", () => {
	it("attaches provider/modelId/costUsd alongside the parsed object", async () => {
		vi.mocked(generateObject).mockResolvedValue({
			object: { ok: true },
			usage: FULL_USAGE,
		} as never);

		const res = await svc.generateObject(
			"prompt",
			z.object({ ok: z.boolean() }),
		);
		if (!Result.isOk(res)) throw new Error("expected ok");
		expect(res.value.output).toEqual({ ok: true });
		expect(res.value.provider).toBe("google");
		expect(res.value.modelId).toBe("gemini-2.5-flash");
		expect(res.value.costUsd).toBeCloseTo(EXPECTED_COST, 12);
	});
});
