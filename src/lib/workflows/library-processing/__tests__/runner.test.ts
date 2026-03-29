import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

vi.mock("@/lib/data/jobs", () => ({
	markJobCompleted: vi.fn(),
	markJobFailed: vi.fn(),
}));

vi.mock("@/lib/data/job-measurements", () => ({
	recordExecutionMeasurement: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/worker/execute", () => ({
	executeEnrichmentJob: vi.fn(),
	executeMatchSnapshotRefreshJob: vi.fn(),
}));

vi.mock("../service", () => ({
	applyLibraryProcessingChange: vi.fn().mockResolvedValue(undefined),
}));

import { runClaimedJob } from "../runner";
import { markJobCompleted, markJobFailed } from "@/lib/data/jobs";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "@/worker/execute";
import type { Job } from "@/lib/data/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		type: "enrichment",
		status: "running",
		progress: {},
		error: null,
		attempts: 1,
		max_attempts: 3,
		created_at: "2026-03-26T00:00:00Z",
		updated_at: "2026-03-26T00:00:00Z",
		started_at: "2026-03-26T00:00:00Z",
		completed_at: null,
		heartbeat_at: "2026-03-26T00:00:00Z",
		queue_priority: 0,
		satisfies_requested_at: null,
		...overrides,
	} as Job;
}

describe("runClaimedJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("dispatches enrichment jobs and returns completed outcome", async () => {
		const execResult = {
			accountId: "acct-1",
			jobId: "job-1",
			batchSequence: 0,
			hasMoreSongs: false,
			newCandidatesAvailable: true,
			readyCount: 5,
			doneCount: 20,
			succeededCount: 18,
			failedCount: 2,
		};
		vi.mocked(executeEnrichmentJob).mockResolvedValue(execResult);
		vi.mocked(markJobCompleted).mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);

		const outcome = await runClaimedJob(makeJob());

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("enrichment");
		expect(executeEnrichmentJob).toHaveBeenCalledTimes(1);
		expect(executeMatchSnapshotRefreshJob).not.toHaveBeenCalled();
	});

	it("dispatches match_snapshot_refresh jobs", async () => {
		const execResult = {
			accountId: "acct-1",
			jobId: "job-2",
			published: true,
			isEmpty: false,
		};
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(execResult);
		vi.mocked(markJobCompleted).mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);

		const outcome = await runClaimedJob(
			makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
		);

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("match_snapshot_refresh");
		expect(executeMatchSnapshotRefreshJob).toHaveBeenCalledTimes(1);
		expect(executeEnrichmentJob).not.toHaveBeenCalled();
	});

	it("returns failed outcome and marks job failed on execution error", async () => {
		vi.mocked(executeEnrichmentJob).mockRejectedValue(
			new Error("provider down"),
		);
		vi.mocked(markJobFailed).mockResolvedValue(
			Result.ok(makeJob({ status: "failed" })),
		);

		const outcome = await runClaimedJob(makeJob());

		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error).toBe("provider down");
		}
		expect(markJobFailed).toHaveBeenCalledWith("job-1", "provider down");
	});
});
