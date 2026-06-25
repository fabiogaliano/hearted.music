/**
 * RerankerService.rerank — instruction override tests (MSR-13).
 *
 * Verifies that a per-call instruction override is forwarded to the provider
 * without mutating the shared service config, so concurrent and sequential
 * calls with different instructions don't contaminate each other.
 */

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { MLProvider } from "@/lib/integrations/providers/ports";
import { DEFAULT_RERANK_INSTRUCTION } from "@/lib/integrations/providers/types";

vi.mock("@/lib/integrations/providers/factory", () => ({
	getMlProvider: vi.fn(),
}));

import { getMlProvider } from "@/lib/integrations/providers/factory";
import {
	DEFAULT_RERANKER_CONFIG,
	RerankerService,
} from "@/lib/integrations/reranker/service";

function makeMockProvider(capturedInstructions: string[]): MLProvider {
	return {
		rerank: vi
			.fn()
			.mockImplementation(
				async (
					_query: string,
					documents: string[],
					opts?: { instruction?: string },
				) => {
					capturedInstructions.push(opts?.instruction ?? "");
					return Result.ok({
						scores: documents.map((_, i) => ({ index: i, score: 0.5 })),
						model: "mock-reranker",
					});
				},
			),
		embed: vi.fn(),
		isAvailable: vi.fn().mockResolvedValue(true),
		getMetadata: vi.fn(),
	} as unknown as MLProvider;
}

describe("RerankerService.rerank — instruction override", () => {
	it("uses the default config instruction when no override is provided", async () => {
		const captured: string[] = [];
		vi.mocked(getMlProvider).mockReturnValue(
			Result.ok(makeMockProvider(captured)),
		);

		const service = new RerankerService();
		const candidates = [{ id: "c1", score: 0.8, document: "doc one" }];
		await service.rerank("query", candidates);

		expect(captured).toEqual([DEFAULT_RERANK_INSTRUCTION]);
	});

	it("forwards the override instruction to the provider", async () => {
		const captured: string[] = [];
		vi.mocked(getMlProvider).mockReturnValue(
			Result.ok(makeMockProvider(captured)),
		);

		const service = new RerankerService();
		const candidates = [{ id: "c1", score: 0.8, document: "doc one" }];
		await service.rerank("query", candidates, {
			instruction: "custom override instruction",
		});

		expect(captured).toEqual(["custom override instruction"]);
	});

	it("does NOT mutate shared config after an override call", async () => {
		const captured: string[] = [];
		vi.mocked(getMlProvider).mockReturnValue(
			Result.ok(makeMockProvider(captured)),
		);

		const service = new RerankerService();
		const candidates = [{ id: "c1", score: 0.8, document: "doc" }];

		await service.rerank("q", candidates, { instruction: "override" });

		// Config must be unchanged after the override call
		expect(service.getConfig().instruction).toBe(
			DEFAULT_RERANKER_CONFIG.instruction,
		);
	});

	it("sequential calls each use their own instruction independently", async () => {
		const captured: string[] = [];
		vi.mocked(getMlProvider).mockReturnValue(
			Result.ok(makeMockProvider(captured)),
		);

		const service = new RerankerService();
		const candidates = [{ id: "c1", score: 0.8, document: "doc" }];

		await service.rerank("q", candidates, { instruction: "instruction-A" });
		await service.rerank("q", candidates, { instruction: "instruction-B" });
		await service.rerank("q", candidates); // no override — falls back to default

		expect(captured).toEqual([
			"instruction-A",
			"instruction-B",
			DEFAULT_RERANK_INSTRUCTION,
		]);
	});

	it("concurrent calls with different instructions each receive their own instruction", async () => {
		const captured: string[] = [];
		vi.mocked(getMlProvider).mockReturnValue(
			Result.ok(makeMockProvider(captured)),
		);

		const service = new RerankerService();
		const candidates = [{ id: "c1", score: 0.8, document: "doc" }];

		// Fire all three concurrently — none must bleed into the others
		await Promise.all([
			service.rerank("q", candidates, { instruction: "instr-1" }),
			service.rerank("q", candidates, { instruction: "instr-2" }),
			service.rerank("q", candidates),
		]);

		// Each call lands its own instruction; order may differ under concurrency
		expect(captured).toContain("instr-1");
		expect(captured).toContain("instr-2");
		expect(captured).toContain(DEFAULT_RERANK_INSTRUCTION);
		// Config must not be dirtied by any of the concurrent calls
		expect(service.getConfig().instruction).toBe(
			DEFAULT_RERANKER_CONFIG.instruction,
		);
	});
});
