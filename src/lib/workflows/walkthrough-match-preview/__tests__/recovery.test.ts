import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ rpc: mockRpc }),
}));

const { sweepStaleWalkthroughPreviewJobs, markDeadWalkthroughPreviewJobs } =
	await import("@/lib/platform/jobs/walkthrough-preview-queue");

beforeEach(() => {
	vi.clearAllMocks();
});

describe("walkthrough preview stale/dead recovery helpers", () => {
	it("sweepStaleWalkthroughPreviewJobs delegates to the dedicated RPC", async () => {
		mockRpc.mockResolvedValue({ data: [{ id: "job-1" }], error: null });

		const result = await sweepStaleWalkthroughPreviewJobs("5 minutes");

		expect(Result.isOk(result)).toBe(true);
		expect(mockRpc).toHaveBeenCalledWith(
			"sweep_stale_walkthrough_preview_jobs",
			{ stale_threshold: "5 minutes" },
		);
	});

	it("markDeadWalkthroughPreviewJobs delegates to the dedicated RPC", async () => {
		mockRpc.mockResolvedValue({ data: [{ id: "job-2" }], error: null });

		const result = await markDeadWalkthroughPreviewJobs("5 minutes");

		expect(Result.isOk(result)).toBe(true);
		expect(mockRpc).toHaveBeenCalledWith("mark_dead_walkthrough_preview_jobs", {
			stale_threshold: "5 minutes",
		});
	});

	it("propagates RPC errors as Result.err", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "P0001", message: "boom" },
		});

		const result = await sweepStaleWalkthroughPreviewJobs("5 minutes");
		expect(Result.isError(result)).toBe(true);
	});
});
