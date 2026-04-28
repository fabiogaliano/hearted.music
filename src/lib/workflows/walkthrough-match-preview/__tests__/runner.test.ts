import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMarkCompleted = vi.fn();
const mockMarkFailed = vi.fn();
vi.mock("@/lib/data/jobs", () => ({
	markJobCompleted: (...args: unknown[]) => mockMarkCompleted(...args),
	markJobFailed: (...args: unknown[]) => mockMarkFailed(...args),
}));

const mockExecute = vi.fn();
vi.mock("../orchestrator", () => ({
	executeWalkthroughPreview: (...args: unknown[]) => mockExecute(...args),
}));

const { runWalkthroughPreviewJob } = await import("../runner");

import type { Job } from "@/lib/data/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-1",
		account_id: "acct-1",
		type: "walkthrough_match_preview",
		status: "running",
		progress: {},
		error: null,
		attempts: 1,
		max_attempts: 3,
		created_at: "2026-04-28T00:00:00Z",
		updated_at: "2026-04-28T00:00:00Z",
		started_at: "2026-04-28T00:00:00Z",
		completed_at: null,
		heartbeat_at: "2026-04-28T00:00:00Z",
		queue_priority: 0,
		satisfies_requested_at: null,
		...overrides,
	} as Job;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runWalkthroughPreviewJob", () => {
	it("executes preview and marks job completed", async () => {
		mockExecute.mockResolvedValue({
			accountId: "acct-1",
			status: "ready",
			matchedPlaylists: 2,
			fingerprint: "fp",
		});
		mockMarkCompleted.mockResolvedValue(Result.ok({}));

		const outcome = await runWalkthroughPreviewJob(makeJob());

		expect(outcome.status).toBe("completed");
		expect(mockExecute).toHaveBeenCalledWith("acct-1");
		expect(mockMarkCompleted).toHaveBeenCalledWith("job-1");
	});

	it("marks the job failed when execute throws", async () => {
		mockExecute.mockRejectedValue(new Error("boom"));
		mockMarkFailed.mockResolvedValue(Result.ok({}));

		const outcome = await runWalkthroughPreviewJob(makeJob());

		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error).toBe("boom");
		}
		expect(mockMarkFailed).toHaveBeenCalledWith("job-1", "boom");
	});
});
