import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { claimLibraryProcessingJob } from "@/lib/platform/jobs/library-processing-queue";
import type { Job } from "@/lib/platform/jobs/repository";
import { runClaimedJob } from "@/lib/workflows/library-processing/runner";
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
		pollIntervalMs: 5000,
	},
}));
vi.mock("../execute", () => ({
	startHeartbeat: vi.fn(() => ({ stop: vi.fn() })),
}));

function makeJob(): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		type: "enrichment",
		status: "pending",
		progress: null,
		error: null,
		attempts: 0,
		max_attempts: 3,
		queue_priority: 0,
		available_at: "2026-07-08T00:00:00Z",
		started_at: null,
		heartbeat_at: null,
		completed_at: null,
		satisfies_requested_at: null,
		created_at: "2026-07-08T00:00:00Z",
		updated_at: "2026-07-08T00:00:00Z",
	};
}

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
			.mockResolvedValueOnce(Result.ok(null));

		await claimAndDispatchLibraryProcessingJobs();
		await Promise.resolve();

		expect(claimLibraryProcessingJob).toHaveBeenCalledTimes(2);
		expect(resolveAccountLabel).toHaveBeenCalledWith("acct-1");
		expect(runClaimedJob).toHaveBeenCalledWith(job, "@acct");
	});
});
