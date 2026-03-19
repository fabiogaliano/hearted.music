import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

vi.mock("@/lib/data/jobs", () => ({
	getOrCreateEnrichmentJob: vi.fn(),
}));

vi.mock("../logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { chainNextChunk } from "../chain";
import { getOrCreateEnrichmentJob } from "@/lib/data/jobs";

describe("chainNextChunk", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns completed when no more songs", async () => {
		const result = await chainNextChunk("account-1", 3, false);

		expect(result).toEqual({ status: "completed" });
		expect(getOrCreateEnrichmentJob).not.toHaveBeenCalled();
	});

	it("returns chained with jobId when more songs exist", async () => {
		vi.mocked(getOrCreateEnrichmentJob).mockResolvedValue(
			Result.ok({ id: "new-job-id", account_id: "account-1" } as any),
		);

		const result = await chainNextChunk("account-1", 2, true);

		expect(result).toEqual({ status: "chained", jobId: "new-job-id" });
		expect(getOrCreateEnrichmentJob).toHaveBeenCalledWith(
			"account-1",
			expect.objectContaining({
				batchSize: 25,
				batchSequence: 3,
			}),
		);
	});

	it("returns error when job creation fails", async () => {
		vi.mocked(getOrCreateEnrichmentJob).mockResolvedValue(
			Result.err(new Error("db error") as any),
		);

		const result = await chainNextChunk("account-1", 0, true);

		expect(result).toEqual({ status: "error", error: "db error" });
	});

	it("uses correct batch size for sequence 0 -> 1 transition", async () => {
		vi.mocked(getOrCreateEnrichmentJob).mockResolvedValue(
			Result.ok({ id: "job-1" } as any),
		);

		await chainNextChunk("account-1", 0, true);

		expect(getOrCreateEnrichmentJob).toHaveBeenCalledWith(
			"account-1",
			expect.objectContaining({
				batchSize: 5,
				batchSequence: 1,
			}),
		);
	});

	it("uses steady-state size for high sequence numbers", async () => {
		vi.mocked(getOrCreateEnrichmentJob).mockResolvedValue(
			Result.ok({ id: "job-steady" } as any),
		);

		await chainNextChunk("account-1", 99, true);

		expect(getOrCreateEnrichmentJob).toHaveBeenCalledWith(
			"account-1",
			expect.objectContaining({
				batchSize: 50,
				batchSequence: 100,
			}),
		);
	});
});
