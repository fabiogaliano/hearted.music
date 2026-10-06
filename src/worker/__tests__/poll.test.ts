import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { claimLibraryProcessingJob } from "@/lib/platform/jobs/library-processing-queue";
import { runClaimedJob } from "@/lib/workflows/library-processing/runner";
import { makeJob } from "@/test/fixtures";
import { claimAndDispatchLibraryProcessingJobs } from "../poll";

vi.mock("@/lib/platform/jobs/library-processing-queue", () => ({
	claimLibraryProcessingJob: vi.fn(),
}));
vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));
vi.mock("@/lib/workflows/library-processing/runner", () => ({
	runClaimedJob: vi.fn(),
}));
vi.mock("../config", () => ({
	workerConfig: {
		concurrency: 2,
		heartbeatIntervalMs: 1000,
		notifyBackedPollIntervalMs: 5000,
	},
}));
vi.mock("../execute", () => ({
	startHeartbeat: vi.fn(() => ({
		stop: vi.fn(),
		leaseLost: new AbortController().signal,
	})),
}));

describe("claimAndDispatchLibraryProcessingJobs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(resolveAccountLabel).mockResolvedValue("@acct");
		vi.mocked(runClaimedJob).mockResolvedValue({
			status: "completed",
			workflow: "enrichment",
			result: {
				accountId: "acct-1",
				jobId: "job-1",
				batchSequence: 0,
				hasMoreSongs: false,
				newCandidatesAvailable: false,
				newCandidateSongIds: [],
				selectionMode: "normal",
				readyCount: 0,
				doneCount: 0,
				succeededCount: 0,
				failedCount: 0,
			},
			settlement: "settled",
		});
	});

	it("still claims and dispatches work through the poll path when no notify fired", async () => {
		const job = makeJob();
		vi.mocked(claimLibraryProcessingJob)
			.mockResolvedValueOnce(Result.ok(job))
			.mockResolvedValue(Result.ok(null));

		await claimAndDispatchLibraryProcessingJobs();

		// Drains until empty (2 claims), then the finished job's freed slot
		// claims once more.
		await vi.waitFor(() =>
			expect(claimLibraryProcessingJob).toHaveBeenCalledTimes(3),
		);
		expect(resolveAccountLabel).toHaveBeenCalledWith("acct-1");
		expect(runClaimedJob).toHaveBeenCalledWith(
			job,
			"@acct",
			expect.any(AbortSignal),
		);
	});
});
