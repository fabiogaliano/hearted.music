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

vi.mock("@/worker/posthog-capture", () => ({
	captureWorkerEvent: vi.fn(),
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
import { captureWorkerEvent } from "@/worker/posthog-capture";
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
	newCandidateSongIds: ["song-a", "song-b"],
	selectionMode: "normal" as const,
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
			status: "published" as const,
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
				status: "published" as const,
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
				status: "published" as const,
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

	describe("blocked chunk detection", () => {
		// A chunk that attempts zero songs while work is still owed is blocked.
		// It must stop instead of completing-unsatisfied to avoid a hot loop.
		const BLOCKED_EXEC_RESULT = {
			accountId: "acct-1",
			jobId: "job-1",
			batchSequence: 0,
			hasMoreSongs: true,
			newCandidatesAvailable: false,
			newCandidateSongIds: [] as string[],
			selectionMode: "normal" as const,
			readyCount: 1,
			doneCount: 0,
			succeededCount: 0,
			failedCount: 0,
		};

		const PARTIAL_EXEC_RESULT = {
			accountId: "acct-1",
			jobId: "job-1",
			batchSequence: 0,
			hasMoreSongs: true,
			newCandidatesAvailable: false,
			newCandidateSongIds: [] as string[],
			selectionMode: "normal" as const,
			readyCount: 3,
			doneCount: 2,
			succeededCount: 1,
			failedCount: 1,
		};

		it("applies enrichment_stopped(blocked) when zero songs attempted and work remains", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(BLOCKED_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "enrichment_stopped",
					reason: "blocked",
					accountId: "acct-1",
					jobId: "job-1",
				}),
			);
		});

		it("does not apply enrichment_completed for a blocked chunk", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(BLOCKED_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).not.toBe("enrichment_completed");
		});

		it("leaves workflow stale without re-ensuring a job for a blocked chunk", async () => {
			// The reconciler only emits ensure_* effects when isFailureChange is false.
			// enrichment_stopped always sets isFailureChange = true, so no effects are
			// produced and no re-ensure fires in the same apply cycle.
			vi.mocked(executeEnrichmentJob).mockResolvedValue(BLOCKED_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			const staleWithoutJobState = {
				accountId: "acct-1",
				enrichment: {
					requestedAt: "2026-03-27T12:00:00Z",
					settledAt: null,
					activeJobId: null,
				},
				matchSnapshotRefresh: {
					requestedAt: null,
					settledAt: null,
					activeJobId: null,
				},
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			};

			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.ok({
					accountId: "acct-1",
					changeKind: "enrichment_stopped" as const,
					state: staleWithoutJobState,
					effects: [],
					effectResults: [],
				}),
			);

			const outcome = await runClaimedJob(makeJob(), "@test");

			expect(outcome.status).toBe("completed");
			// The apply was called with enrichment_stopped (not enrichment_completed),
			// and the returned effects list is empty — no re-ensure was triggered.
			const callArg = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(callArg?.kind).toBe("enrichment_stopped");
			expect(callArg?.reason).toBe("blocked");
		});

		it("applies enrichment_completed(requestSatisfied:false) for a normal partial chunk", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(PARTIAL_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "enrichment_completed",
					requestSatisfied: false,
				}),
			);
		});

		it("does not treat a completed chunk (doneCount > 0, hasMoreSongs true) as blocked", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(PARTIAL_EXEC_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).not.toBe("enrichment_stopped");
		});

		it("does not treat a zero-done chunk as blocked when no work remains", async () => {
			// doneCount=0 + hasMoreSongs=false means nothing left to do — normal completion
			vi.mocked(executeEnrichmentJob).mockResolvedValue({
				...BLOCKED_EXEC_RESULT,
				hasMoreSongs: false,
			});
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);

			await runClaimedJob(makeJob(), "@test");

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).toBe("enrichment_completed");
			expect(call?.requestSatisfied).toBe(true);
		});
	});

	it("propagates newCandidateSongIds into the enrichment_completed change", async () => {
		vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
		vi.mocked(markJobCompleted).mockResolvedValue(
			Result.ok(makeJob({ status: "completed" })),
		);

		await runClaimedJob(makeJob(), "@test");

		expect(applyLibraryProcessingChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "enrichment_completed",
				newCandidateSongIds: ENRICHMENT_EXEC_RESULT.newCandidateSongIds,
			}),
		);
	});

	describe("Phase 9 observability events", () => {
		beforeEach(() => {
			vi.clearAllMocks();
			recordJobExecutionMeasurementMock.mockResolvedValue(Result.ok(undefined));
			applyLibraryProcessingChangeMock.mockResolvedValue(APPLY_OK_RESULT);
			vi.mocked(markJobCompleted).mockResolvedValue(
				Result.ok(makeJob({ status: "completed" })),
			);
		});

		it("captures enrichment_candidate_batch_ready when newCandidatesAvailable", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

			await runClaimedJob(makeJob(), "@test");

			expect(vi.mocked(captureWorkerEvent)).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "enrichment_candidate_batch_ready",
					distinctId: "acct-1",
					properties: expect.objectContaining({
						new_candidate_count:
							ENRICHMENT_EXEC_RESULT.newCandidateSongIds.length,
						batch_sequence: ENRICHMENT_EXEC_RESULT.batchSequence,
						selection_mode: "normal",
					}),
				}),
			);
		});

		it("captures first_match_refresh_queued with bootstrap flag derived from selectionMode", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue({
				...ENRICHMENT_EXEC_RESULT,
				selectionMode: "first_match_bootstrap",
			});

			await runClaimedJob(makeJob(), "@test");

			expect(vi.mocked(captureWorkerEvent)).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "first_match_refresh_queued",
					properties: expect.objectContaining({
						// bootstrap mode → first_visible_match_ready_before_queue is false
						first_visible_match_ready_before_queue: false,
						selection_mode: "first_match_bootstrap",
					}),
				}),
			);
		});

		it("does not capture Phase 9 enrichment events when newCandidatesAvailable is false", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue({
				...ENRICHMENT_EXEC_RESULT,
				newCandidatesAvailable: false,
				newCandidateSongIds: [],
			});

			await runClaimedJob(makeJob(), "@test");

			const calls = vi.mocked(captureWorkerEvent).mock.calls;
			const eventNames = calls.map((c) => c[0].event);
			expect(eventNames).not.toContain("enrichment_candidate_batch_ready");
			expect(eventNames).not.toContain("first_match_refresh_queued");
		});

		it("does not capture first_match_refresh_queued when settlement fails", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			// Use a non-retryable error (cause is plain Error, not DatabaseError) so
			// withRetry does not loop and the test terminates promptly.
			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.err({
					kind: "persist_state" as const,
					cause: new Error("non-retryable failure"),
				}),
			);

			await runClaimedJob(makeJob(), "@test");

			const calls = vi.mocked(captureWorkerEvent).mock.calls;
			const eventNames = calls.map((c) => c[0].event);
			// enrichment_candidate_batch_ready fires before settlement
			expect(eventNames).toContain("enrichment_candidate_batch_ready");
			// first_match_refresh_queued requires "settled" status — must be absent
			expect(eventNames).not.toContain("first_match_refresh_queued");
		});
	});
});
