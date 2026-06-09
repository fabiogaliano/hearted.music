import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../annotation-distillation-queries", () => ({
	getAnnotationDistillations: vi.fn(),
	upsertAnnotationDistillations: vi.fn(),
}));
vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: vi.fn(),
}));
vi.mock("../llm-usage-queries", () => ({
	recordLlmUsage: vi.fn(),
}));

import { normalizeAnnotationText } from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import type { TransformedLyricsBySection } from "@/lib/domains/enrichment/lyrics/utils/lyrics-transformer";
import { createLlmService } from "@/lib/integrations/llm/service";
import { ensureAnnotationDistillations } from "../annotation-distillation";
import {
	getAnnotationDistillations,
	upsertAnnotationDistillations,
} from "../annotation-distillation-queries";
import { hashAnnotationText } from "../annotation-hash";
import { recordLlmUsage } from "../llm-usage-queries";

const ONE = "Raw annotation ONE about line a.";
const TWO = "Raw annotation TWO about line b.";

// ONE recurs on a chorus repeat: the same text on two lines should distill once.
const sections: TransformedLyricsBySection[] = [
	{
		type: "Verse 1",
		lines: [
			{
				id: 1,
				text: "line a",
				annotations: [{ text: ONE, verified: false, votes_total: 20 }],
			},
			{
				id: 2,
				text: "line b",
				annotations: [{ text: TWO, verified: false, votes_total: 20 }],
			},
		],
	},
	{
		type: "Chorus",
		lines: [
			{
				id: 3,
				text: "line a",
				annotations: [{ text: ONE, verified: false, votes_total: 20 }],
			},
		],
	},
];

const generateText = vi.fn();

function distillsByKeyword() {
	generateText.mockImplementation(async (prompt: string) =>
		Result.ok({
			text: prompt.includes("ONE") ? "facts one" : "facts two",
			model: "google-vertex:gemini-2.5-flash-lite",
			modelId: "gemini-2.5-flash-lite",
			provider: "google-vertex",
			tokens: {
				prompt: 50,
				completion: 10,
				total: 60,
				cacheReadTokens: 0,
				reasoningTokens: 0,
			},
			costUsd: 0.000009,
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(createLlmService).mockReturnValue({ generateText } as never);
	vi.mocked(upsertAnnotationDistillations).mockResolvedValue(Result.ok(null));
	vi.mocked(recordLlmUsage).mockResolvedValue(Result.ok(undefined));
	distillsByKeyword();
});

describe("ensureAnnotationDistillations", () => {
	it("distills each distinct annotation once and caches the result", async () => {
		vi.mocked(getAnnotationDistillations).mockResolvedValue(Result.ok([]));

		const map = await ensureAnnotationDistillations(sections);

		// Three annotation occurrences, two distinct texts -> two LLM calls, not three.
		expect(generateText).toHaveBeenCalledTimes(2);
		expect(map.get(normalizeAnnotationText(ONE))).toBe("facts one");
		expect(map.get(normalizeAnnotationText(TWO))).toBe("facts two");

		expect(vi.mocked(upsertAnnotationDistillations)).toHaveBeenCalledTimes(1);
		const rows = vi.mocked(upsertAnnotationDistillations).mock.calls[0][0];
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.distiller_version === "v2")).toBe(true);

		// One ledger row per freshly distilled annotation, keyed by content_hash (not song),
		// using the bare model id — two distinct hashes for the two distinct texts.
		const usageCalls = vi.mocked(recordLlmUsage).mock.calls.map((c) => c[0]);
		expect(usageCalls).toHaveLength(2);
		expect(
			usageCalls.every(
				(u) =>
					u.functionId === "annotation-distillation" &&
					u.model === "gemini-2.5-flash-lite" &&
					typeof u.contentHash === "string" &&
					u.contentHash.length > 0,
			),
		).toBe(true);
		expect(new Set(usageCalls.map((u) => u.contentHash)).size).toBe(2);
	});

	it("reuses a cached distillation and only distills the miss", async () => {
		const hashOne = await hashAnnotationText(normalizeAnnotationText(ONE));
		vi.mocked(getAnnotationDistillations).mockResolvedValue(
			Result.ok([{ content_hash: hashOne, distilled_text: "cached one" }]),
		);

		const map = await ensureAnnotationDistillations(sections);

		expect(generateText).toHaveBeenCalledTimes(1);
		expect(map.get(normalizeAnnotationText(ONE))).toBe("cached one");
		expect(map.get(normalizeAnnotationText(TWO))).toBe("facts two");

		// Only the miss (TWO) made a call, so only it is ledgered — the cache hit gets no row.
		const hashTwo = await hashAnnotationText(normalizeAnnotationText(TWO));
		expect(recordLlmUsage).toHaveBeenCalledTimes(1);
		expect(vi.mocked(recordLlmUsage).mock.calls[0][0]).toMatchObject({
			functionId: "annotation-distillation",
			contentHash: hashTwo,
		});
	});

	it("returns cached hits and never throws when distillation fails", async () => {
		const hashOne = await hashAnnotationText(normalizeAnnotationText(ONE));
		vi.mocked(getAnnotationDistillations).mockResolvedValue(
			Result.ok([{ content_hash: hashOne, distilled_text: "cached one" }]),
		);
		vi.mocked(createLlmService).mockImplementation(() => {
			throw new Error("provider not configured");
		});

		const map = await ensureAnnotationDistillations(sections);

		// Cached hit survives; the miss is simply absent (formatter falls back to raw).
		expect(map.get(normalizeAnnotationText(ONE))).toBe("cached one");
		expect(map.has(normalizeAnnotationText(TWO))).toBe(false);
		expect(vi.mocked(upsertAnnotationDistillations)).not.toHaveBeenCalled();
		// No call happened, so nothing is ledgered.
		expect(recordLlmUsage).not.toHaveBeenCalled();
	});

	it("returns an empty map for a document with no annotations", async () => {
		vi.mocked(getAnnotationDistillations).mockResolvedValue(Result.ok([]));
		const map = await ensureAnnotationDistillations([
			{ type: "Verse 1", lines: [{ id: 1, text: "no notes here" }] },
		]);
		expect(map.size).toBe(0);
		expect(generateText).not.toHaveBeenCalled();
	});
});
