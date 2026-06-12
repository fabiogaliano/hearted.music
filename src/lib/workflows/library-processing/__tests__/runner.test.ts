import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

vi.mock("@/lib/platform/jobs/repository", () => ({
	markJobCompleted: vi.fn(),
	markJobFailed: vi.fn(),
}));

const recordJobExecutionMeasurementMock = vi
	.fn()
	.mockResolvedValue(Result.ok(undefined));

vi.mock("@/lib/platform/jobs/execution-measurements", () => ({
	recordJobExecutionMeasurement: (...args: unknown[]) =>
		recordJobExecutionMeasurementMock(...args),
}));

vi.mock("@/worker/execute", () => ({
	executeEnrichmentJob: vi.fn(),
	executeMatchSnapshotRefreshJob: vi.fn(),
}));

vi.mock("@sentry/bun", () => ({
	captureException: vi.fn(),
}));

const applyLibraryProcessingChangeMock = vi.fn();

vi.mock("../service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		applyLibraryProcessingChangeMock(...args),
}));

import type { Job } from "@/lib/platform/jobs/repository";
import {
	markJobCompleted,
	markJobFailed,
} from "@/lib/platform/jobs/repository";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "@/worker/execute";
import { runClaimedJob } from "../runner";
import type { LibraryProcessingApplyError } from "../types";

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
		recordJobExecutionMeasurementMock.mockResolvedValue(Result.ok(undefined));
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

		const outcome = await runClaimedJob(makeJob(), "@test");

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
			"@test",
		);

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("match_snapshot_refresh");
		expect(executeMatchSnapshotRefreshJob).toHaveBeenCalledTimes(1);
		expect(executeEnrichmentJob).not.toHaveBeenCalled();
	});

	it("returns failed outcome and marks job failed on execution error", async () => {
		const thrown = new Error("provider down");
		vi.mocked(executeEnrichmentJob).mockRejectedValue(thrown);
		vi.mocked(markJobFailed).mockResolvedValue(
			Result.ok(makeJob({ status: "failed" })),
		);

		const outcome = await runClaimedJob(makeJob(), "@test");

		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error).toBe("provider down");
		}
		expect(markJobFailed).toHaveBeenCalledWith("job-1", "provider down");
		expect(captureException).toHaveBeenCalledWith(
			thrown,
			expect.objectContaining({
				tags: { workflow: "enrichment", phase: "job-execution" },
				extra: { jobId: "job-1", accountId: "acct-1" },
			}),
		);
	});

	it("reports match_snapshot_refresh execution errors to Sentry", async () => {
		const thrown = new Error("snapshot exploded");
		vi.mocked(executeMatchSnapshotRefreshJob).mockRejectedValue(thrown);
		vi.mocked(markJobFailed).mockResolvedValue(
			Result.ok(makeJob({ status: "failed" })),
		);

		const outcome = await runClaimedJob(
			makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
			"@test",
		);

		expect(outcome.status).toBe("failed");
		expect(captureException).toHaveBeenCalledWith(
			thrown,
			expect.objectContaining({
				tags: { workflow: "match_snapshot_refresh", phase: "job-execution" },
				extra: { jobId: "job-2", accountId: "acct-1" },
			}),
		);
	});

	it("preserves workflow result payloads on completed outcomes", async () => {
		vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
		vi.mocked(markJobCompleted).mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);

		const outcome = await runClaimedJob(makeJob(), "@test");

		expect(outcome.status).toBe("completed");
		if (outcome.status === "completed" && outcome.workflow === "enrichment") {
			expect(outcome.result).toEqual(ENRICHMENT_EXEC_RESULT);
		}
	});

	describe("measurement-before-apply ordering", () => {
		it("writes measurement before applying library-processing change on success", async () => {
			const callOrder: string[] = [];
			recordJobExecutionMeasurementMock.mockImplementation(async () => {
				callOrder.push("measurement");
				return Result.ok(undefined);
			});
			applyLibraryProcessingChangeMock.mockImplementation(async () => {
				callOrder.push("apply");
				return APPLY_OK_RESULT;
			});

			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			expect(callOrder).toEqual(["measurement", "apply"]);
		});

		it("writes measurement before applying library-processing change on failure", async () => {
			const callOrder: string[] = [];
			recordJobExecutionMeasurementMock.mockImplementation(async () => {
				callOrder.push("measurement");
				return Result.ok(undefined);
			});
			applyLibraryProcessingChangeMock.mockImplementation(async () => {
				callOrder.push("apply");
				return APPLY_OK_RESULT;
			});

			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);
			vi.mocked(markJobFailed).mockResolvedValue(
				Result.ok(makeJob({ status: "failed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			expect(callOrder).toEqual(["measurement", "apply"]);
		});

		it("writes measurement before applying change for match_snapshot_refresh", async () => {
			const callOrder: string[] = [];
			recordJobExecutionMeasurementMock.mockImplementation(async () => {
				callOrder.push("measurement");
				return Result.ok(undefined);
			});
			applyLibraryProcessingChangeMock.mockImplementation(async () => {
				callOrder.push("apply");
				return APPLY_OK_RESULT;
			});

			vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue({
				accountId: "acct-1",
				jobId: "job-2",
				published: true,
				isEmpty: false,
			});
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(
				makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
				"@test",
			);

			expect(callOrder).toEqual(["measurement", "apply"]);
		});
	});

	describe("settlement", () => {
		it("returns settled when apply succeeds on first attempt", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			const outcome = await runClaimedJob(makeJob(), "@test");

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

			const promise = runClaimedJob(makeJob(), "@test");
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

			const promise = runClaimedJob(makeJob(), "@test");
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.settlement).toBe("settlement_failed");
			// 1 initial + 3 retries = 4 total attempts
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(4);

			expect(captureException).toHaveBeenCalledWith(
				error,
				expect.objectContaining({
					tags: { workflow: "enrichment", phase: "settlement" },
					extra: expect.objectContaining({
						jobId: "job-1",
						accountId: "acct-1",
						changeKind: "enrichment_completed",
					}),
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

			const settlementError = makePersistStateError();
			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.err(settlementError),
			);

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const promise = runClaimedJob(makeJob(), "@test");
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.status).toBe("failed");
			expect(outcome.settlement).toBe("settlement_failed");

			expect(captureException).toHaveBeenCalledWith(
				settlementError,
				expect.objectContaining({
					tags: { workflow: "enrichment", phase: "settlement" },
					extra: expect.objectContaining({
						jobId: "job-1",
						accountId: "acct-1",
						changeKind: "enrichment_stopped",
					}),
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
				"@test",
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

			const promise = runClaimedJob(makeJob(), "@test");
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.settlement).toBe("settlement_failed");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);

			consoleSpy.mockRestore();
		});
	});
});
