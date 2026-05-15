import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

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

const applyLibraryProcessingChangeMock = vi.fn();

vi.mock("../service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		applyLibraryProcessingChangeMock(...args),
}));

import type { Job } from "@/lib/data/jobs";
import { markJobCompleted, markJobFailed } from "@/lib/data/jobs";
import type { LibraryProcessingApplyError } from "../types";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "@/worker/execute";
import { runClaimedJob } from "../runner";

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

const APPLY_OK_RESULT = Result.ok({
	accountId: "acct-1",
	changeKind: "enrichment_completed" as const,
	state: {
		accountId: "acct-1",
		enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
		matchSnapshotRefresh: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	effects: [],
	effectResults: [],
});

const ENRICHMENT_EXEC_RESULT = {
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

function makePersistStateError(): LibraryProcessingApplyError {
	return {
		kind: "persist_state",
		cause: new DatabaseError({ code: "PGRST", message: "connection reset" }),
	};
}

describe("runClaimedJob", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		applyLibraryProcessingChangeMock.mockResolvedValue(APPLY_OK_RESULT);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("dispatches enrichment jobs and returns completed outcome", async () => {
		vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
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

	it("preserves workflow result payloads on completed outcomes", async () => {
		vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
		vi.mocked(markJobCompleted).mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);

		const outcome = await runClaimedJob(makeJob());

		expect(outcome.status).toBe("completed");
		if (outcome.status === "completed" && outcome.workflow === "enrichment") {
			expect(outcome.result).toEqual(ENRICHMENT_EXEC_RESULT);
		}
	});

	describe("settlement", () => {
		it("returns settled when apply succeeds on first attempt", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			const outcome = await runClaimedJob(makeJob());

			expect(outcome.settlement).toBe("settled");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);
		});

		it("retries transient DatabaseError and settles on success", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			applyLibraryProcessingChangeMock
				.mockResolvedValueOnce(Result.err(makePersistStateError()))
				.mockResolvedValueOnce(APPLY_OK_RESULT);

			const promise = runClaimedJob(makeJob());
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.settlement).toBe("settled");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(2);
		});

		it("returns settlement_failed after retry exhaustion", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			const error = makePersistStateError();
			applyLibraryProcessingChangeMock.mockResolvedValue(Result.err(error));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const promise = runClaimedJob(makeJob());
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.settlement).toBe("settlement_failed");
			// 1 initial + 3 retries = 4 total attempts
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(4);

			expect(consoleSpy).toHaveBeenCalledWith(
				"[runner] library-processing-settlement-failed",
				expect.objectContaining({
					jobId: "job-1",
					accountId: "acct-1",
					workflow: "enrichment",
					changeKind: "enrichment_completed",
					error: expect.objectContaining({ kind: "persist_state" }),
				}),
			);

			consoleSpy.mockRestore();
		});

		it("returns settlement_failed on error-path settlement failures", async () => {
			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);
			vi.mocked(markJobFailed).mockResolvedValue(
				Result.ok(makeJob({ status: "failed" })),
			);

			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.err(makePersistStateError()),
			);

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const promise = runClaimedJob(makeJob());
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.status).toBe("failed");
			expect(outcome.settlement).toBe("settlement_failed");

			expect(consoleSpy).toHaveBeenCalledWith(
				"[runner] library-processing-settlement-failed",
				expect.objectContaining({
					jobId: "job-1",
					accountId: "acct-1",
					workflow: "enrichment",
					changeKind: "enrichment_stopped",
				}),
			);

			consoleSpy.mockRestore();
		});

		it("returns settled for match_snapshot_refresh settlement", async () => {
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

			expect(outcome.settlement).toBe("settled");
		});

		it("does not retry non-DatabaseError apply failures", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			const nonRetryableError: LibraryProcessingApplyError = {
				kind: "effect_ensure_failed",
				effectKind: "ensure_enrichment_job",
				cause: { kind: "unexpected", message: "billing read exploded" },
			};
			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.err(nonRetryableError),
			);

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const promise = runClaimedJob(makeJob());
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.settlement).toBe("settlement_failed");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);

			consoleSpy.mockRestore();
		});
	});
});
