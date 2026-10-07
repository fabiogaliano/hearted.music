import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	finalizeEnrichmentJob,
	finalizeMatchSnapshotRefreshJob,
	requeueLibraryProcessingJobForRetry,
} from "@/lib/workflows/library-processing/settlement";

const recordJobExecutionMeasurementMock = vi
	.fn()
	.mockResolvedValue(Result.ok(undefined));

vi.mock("@/lib/platform/jobs/execution-measurements", () => ({
	recordJobExecutionMeasurement: (...args: unknown[]) =>
		recordJobExecutionMeasurementMock(...args),
}));

vi.mock("@/lib/workflows/library-processing/settlement", () => ({
	finalizeEnrichmentJob: vi.fn().mockResolvedValue({ isError: false }),
	finalizeMatchSnapshotRefreshJob: vi
		.fn()
		.mockResolvedValue({ isError: false }),
	requeueLibraryProcessingJobForRetry: vi
		.fn()
		.mockResolvedValue({ isError: false }),
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

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		applyLibraryProcessingChangeMock(...args),
}));

import type { LibraryProcessingApplyError } from "@/lib/workflows/library-processing/types";
import { makeJob } from "@/test/fixtures";
import {
	executeEnrichmentJob,
	executeMatchSnapshotRefreshJob,
} from "@/worker/execute";
import { captureWorkerEvent } from "@/worker/posthog-capture";
import {
	type RunJobOutcome,
	runClaimedJob,
} from "../library-processing-runner";

// A lease the heartbeat never reports lost.
const LIVE_LEASE = new AbortController().signal;

function settlementOf(outcome: RunJobOutcome) {
	return "settlement" in outcome ? outcome.settlement : null;
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
		vi.mocked(finalizeEnrichmentJob).mockResolvedValue(Result.ok("applied"));
		vi.mocked(finalizeMatchSnapshotRefreshJob).mockResolvedValue(
			Result.ok("applied"),
		);
		// Default: no retry budget consumed successfully — existing failure-path
		// tests keep exercising terminal settlement. Retry tests override to true.
		vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
			Result.ok(false),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("dispatches enrichment jobs and returns completed outcome", async () => {
		vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

		const outcome = await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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
			snapshotId: "snap-1",
		};
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(execResult);

		const outcome = await runClaimedJob(
			makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
			"@test",
			LIVE_LEASE,
		);

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("match_snapshot_refresh");
		expect(executeMatchSnapshotRefreshJob).toHaveBeenCalledTimes(1);
		expect(executeEnrichmentJob).not.toHaveBeenCalled();
	});

	it("returns failed outcome and marks job failed on execution error", async () => {
		const thrown = new Error("provider down");
		vi.mocked(executeEnrichmentJob).mockRejectedValue(thrown);

		const outcome = await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error).toBe("provider down");
		}
		expect(finalizeEnrichmentJob).toHaveBeenCalledWith(
			expect.objectContaining({ id: "job-1" }),
			"failed",
			"failed",
			"provider down",
		);
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

		const outcome = await runClaimedJob(
			makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
			"@test",
			LIVE_LEASE,
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

	describe("app-error retry budget", () => {
		it("requeues an enrichment job with attempts remaining instead of failing terminally", async () => {
			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);
			vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
				Result.ok(true),
			);

			const outcome = await runClaimedJob(
				makeJob({ attempts: 1, max_attempts: 3 }),
				"@test",
				LIVE_LEASE,
			);

			expect(outcome.status).toBe("retrying");
			expect(requeueLibraryProcessingJobForRetry).toHaveBeenCalledWith(
				expect.objectContaining({ id: "job-1" }),
				"provider down",
			);
			expect(finalizeEnrichmentJob).not.toHaveBeenCalled();
			// The job is still active (back to pending) — no reconciler change.
			expect(applyLibraryProcessingChangeMock).not.toHaveBeenCalled();
		});

		it("requeues a match_snapshot_refresh job with attempts remaining", async () => {
			vi.mocked(executeMatchSnapshotRefreshJob).mockRejectedValue(
				new Error("snapshot exploded"),
			);
			vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
				Result.ok(true),
			);

			const outcome = await runClaimedJob(
				makeJob({
					id: "job-2",
					type: "match_snapshot_refresh",
					attempts: 2,
					max_attempts: 3,
				}),
				"@test",
				LIVE_LEASE,
			);

			expect(outcome.status).toBe("retrying");
			expect(finalizeMatchSnapshotRefreshJob).not.toHaveBeenCalled();
			expect(applyLibraryProcessingChangeMock).not.toHaveBeenCalled();
		});

		it("fails terminally once attempts are exhausted", async () => {
			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);

			const outcome = await runClaimedJob(
				makeJob({ attempts: 3, max_attempts: 3 }),
				"@test",
				LIVE_LEASE,
			);

			expect(outcome.status).toBe("failed");
			expect(requeueLibraryProcessingJobForRetry).not.toHaveBeenCalled();
			expect(finalizeEnrichmentJob).toHaveBeenCalledWith(
				expect.objectContaining({ id: "job-1" }),
				"failed",
				"failed",
				"provider down",
			);
		});

		it("falls back to terminal failure when the requeue does not land", async () => {
			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);
			vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
				Result.ok(false),
			);

			const outcome = await runClaimedJob(
				makeJob({ attempts: 1, max_attempts: 3 }),
				"@test",
				LIVE_LEASE,
			);

			expect(outcome.status).toBe("failed");
			expect(finalizeEnrichmentJob).toHaveBeenCalled();
		});
	});

	describe("a lease lost at the terminal settle records nothing (regression: match_snapshot_refresh wrote its measurement before the fenced settle, double-recording a reclaimed run)", () => {
		const refreshJob = makeJob({ id: "job-2", type: "match_snapshot_refresh" });
		const cases = [
			{
				name: "match refresh published",
				job: refreshJob,
				arrange: () =>
					vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue({
						status: "published",
						accountId: "acct-1",
						jobId: "job-2",
						published: true,
						isEmpty: false,
						snapshotId: "snap-1",
					}),
			},
			{
				name: "match refresh superseded by a newer request",
				job: refreshJob,
				arrange: () =>
					vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue({
						status: "superseded",
						accountId: "acct-1",
						jobId: "job-2",
					}),
			},
			{
				name: "match refresh failed with no retry budget",
				job: refreshJob,
				arrange: () =>
					vi
						.mocked(executeMatchSnapshotRefreshJob)
						.mockRejectedValue(new Error("snapshot exploded")),
			},
			{
				name: "enrichment completed",
				job: makeJob(),
				arrange: () =>
					vi
						.mocked(executeEnrichmentJob)
						.mockResolvedValue(ENRICHMENT_EXEC_RESULT),
			},
		];

		it.each(cases)("$name", async ({ job, arrange }) => {
			arrange();
			vi.mocked(finalizeEnrichmentJob).mockResolvedValue(
				Result.ok("superseded"),
			);
			vi.mocked(finalizeMatchSnapshotRefreshJob).mockResolvedValue(
				Result.ok("superseded"),
			);

			const outcome = await runClaimedJob(job, "@test", LIVE_LEASE);

			expect(outcome.status).toBe("lease_lost");
			expect(recordJobExecutionMeasurementMock).not.toHaveBeenCalled();
			expect(applyLibraryProcessingChangeMock).not.toHaveBeenCalled();
		});
	});

	describe("a lease the heartbeat reports lost mid-run stops before any settle (regression: a taken-over run kept going and only the fenced settle discarded it)", () => {
		const refreshJob = makeJob({ id: "job-2", type: "match_snapshot_refresh" });
		const cases = [
			{
				name: "enrichment chunk returns",
				job: makeJob(),
				arrange: (lose: () => void) =>
					vi.mocked(executeEnrichmentJob).mockImplementation(async () => {
						lose();
						return ENRICHMENT_EXEC_RESULT;
					}),
			},
			{
				name: "enrichment chunk throws",
				job: makeJob({ attempts: 1, max_attempts: 3 }),
				arrange: (lose: () => void) =>
					vi.mocked(executeEnrichmentJob).mockImplementation(async () => {
						lose();
						throw new Error("chunk exploded");
					}),
			},
			{
				name: "match refresh reports the lost lease",
				job: refreshJob,
				arrange: (lose: () => void) =>
					vi
						.mocked(executeMatchSnapshotRefreshJob)
						.mockImplementation(async () => {
							lose();
							return {
								status: "lease_lost",
								accountId: "acct-1",
								jobId: "job-2",
							};
						}),
			},
			{
				name: "match refresh throws",
				job: { ...refreshJob, attempts: 1, max_attempts: 3 },
				arrange: (lose: () => void) =>
					vi
						.mocked(executeMatchSnapshotRefreshJob)
						.mockImplementation(async () => {
							lose();
							throw new Error("snapshot exploded");
						}),
			},
		];

		it.each(cases)("$name", async ({ job, arrange }) => {
			const lease = new AbortController();
			arrange(() => lease.abort());

			const outcome = await runClaimedJob(job, "@test", lease.signal);

			expect(outcome.status).toBe("lease_lost");
			expect(finalizeEnrichmentJob).not.toHaveBeenCalled();
			expect(finalizeMatchSnapshotRefreshJob).not.toHaveBeenCalled();
			expect(requeueLibraryProcessingJobForRetry).not.toHaveBeenCalled();
			expect(recordJobExecutionMeasurementMock).not.toHaveBeenCalled();
			expect(applyLibraryProcessingChangeMock).not.toHaveBeenCalled();
		});
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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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
				snapshotId: "snap-1",
			});

			await runClaimedJob(
				makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
				"@test",
				LIVE_LEASE,
			);

			expect(callOrder).toEqual(["measurement", "apply"]);
		});
	});

	describe("terminal settle failure", () => {
		const settleError = new DatabaseError({
			code: "PGRST",
			message: "connection reset",
		});

		it("regression: retries the completed settle instead of requeueing an already-executed job", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
				Result.ok(true),
			);
			vi.mocked(finalizeEnrichmentJob)
				.mockResolvedValueOnce(Result.err(settleError))
				.mockResolvedValueOnce(Result.ok("applied"));

			const promise = runClaimedJob(
				makeJob({ attempts: 1, max_attempts: 3 }),
				"@test",
				LIVE_LEASE,
			);
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.status).toBe("completed");
			expect(finalizeEnrichmentJob).toHaveBeenCalledTimes(2);
			expect(requeueLibraryProcessingJobForRetry).not.toHaveBeenCalled();
		});

		it("leaves the job for the stale sweep when the settle keeps failing", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);
			vi.mocked(requeueLibraryProcessingJobForRetry).mockResolvedValue(
				Result.ok(true),
			);
			vi.mocked(finalizeEnrichmentJob).mockResolvedValue(
				Result.err(settleError),
			);

			const promise = runClaimedJob(
				makeJob({ attempts: 1, max_attempts: 3 }),
				"@test",
				LIVE_LEASE,
			);
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(outcome.status).toBe("finalize_failed");
			expect(requeueLibraryProcessingJobForRetry).not.toHaveBeenCalled();
			expect(applyLibraryProcessingChangeMock).not.toHaveBeenCalled();
		});
	});

	describe("settlement", () => {
		it("returns settled when apply succeeds on first attempt", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

			const outcome = await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			expect(settlementOf(outcome)).toBe("settled");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);
		});

		it("retries transient DatabaseError and settles on success", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

			applyLibraryProcessingChangeMock
				.mockResolvedValueOnce(Result.err(makePersistStateError()))
				.mockResolvedValueOnce(APPLY_OK_RESULT);

			const promise = runClaimedJob(makeJob(), "@test", LIVE_LEASE);
			await vi.advanceTimersByTimeAsync(60_000);
			const outcome = await promise;

			expect(settlementOf(outcome)).toBe("settled");
			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(2);
		});

		it("returns settlement_failed after retry exhaustion", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

			const error = makePersistStateError();
			applyLibraryProcessingChangeMock.mockResolvedValue(Result.err(error));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			try {
				const promise = runClaimedJob(makeJob(), "@test", LIVE_LEASE);
				await vi.advanceTimersByTimeAsync(60_000);
				const outcome = await promise;

				expect(settlementOf(outcome)).toBe("settlement_failed");
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
			} finally {
				consoleSpy.mockRestore();
			}
		});

		it("returns settlement_failed on error-path settlement failures", async () => {
			vi.mocked(executeEnrichmentJob).mockRejectedValue(
				new Error("provider down"),
			);

			const settlementError = makePersistStateError();
			applyLibraryProcessingChangeMock.mockResolvedValue(
				Result.err(settlementError),
			);

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			try {
				const promise = runClaimedJob(makeJob(), "@test", LIVE_LEASE);
				await vi.advanceTimersByTimeAsync(60_000);
				const outcome = await promise;

				expect(outcome.status).toBe("failed");
				expect(settlementOf(outcome)).toBe("settlement_failed");

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
			} finally {
				consoleSpy.mockRestore();
			}
		});

		it("returns settled for match_snapshot_refresh settlement", async () => {
			const execResult = {
				status: "published" as const,
				accountId: "acct-1",
				jobId: "job-2",
				published: true,
				isEmpty: false,
				snapshotId: "snap-1",
			};
			vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(execResult);

			const outcome = await runClaimedJob(
				makeJob({ id: "job-2", type: "match_snapshot_refresh" }),
				"@test",
				LIVE_LEASE,
			);

			expect(settlementOf(outcome)).toBe("settled");
		});

		it("does not retry non-DatabaseError apply failures", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

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

			try {
				const promise = runClaimedJob(makeJob(), "@test", LIVE_LEASE);
				await vi.advanceTimersByTimeAsync(60_000);
				const outcome = await promise;

				expect(settlementOf(outcome)).toBe("settlement_failed");
				expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);
			} finally {
				consoleSpy.mockRestore();
			}
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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).not.toBe("enrichment_completed");
		});

		it("leaves workflow stale without re-ensuring a job for a blocked chunk", async () => {
			// The reconciler only emits ensure_* effects when isFailureChange is false.
			// enrichment_stopped always sets isFailureChange = true, so no effects are
			// produced and no re-ensure fires in the same apply cycle.
			vi.mocked(executeEnrichmentJob).mockResolvedValue(BLOCKED_EXEC_RESULT);

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

			const outcome = await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			expect(outcome.status).toBe("completed");
			// The apply was called with enrichment_stopped (not enrichment_completed),
			// and the returned effects list is empty — no re-ensure was triggered.
			const callArg = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(callArg?.kind).toBe("enrichment_stopped");
			expect(callArg?.reason).toBe("blocked");
		});

		it("applies enrichment_completed(requestSatisfied:false) for a normal partial chunk", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(PARTIAL_EXEC_RESULT);

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			expect(applyLibraryProcessingChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "enrichment_completed",
					requestSatisfied: false,
				}),
			);
		});

		it("does not treat a completed chunk (doneCount > 0, hasMoreSongs true) as blocked", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(PARTIAL_EXEC_RESULT);

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).not.toBe("enrichment_stopped");
		});

		it("does not treat a zero-done chunk as blocked when no work remains", async () => {
			// doneCount=0 + hasMoreSongs=false means nothing left to do — normal completion
			vi.mocked(executeEnrichmentJob).mockResolvedValue({
				...BLOCKED_EXEC_RESULT,
				hasMoreSongs: false,
			});

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			const call = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
			expect(call?.kind).toBe("enrichment_completed");
			expect(call?.requestSatisfied).toBe(true);
		});
	});

	describe("Phase 9 observability events", () => {
		beforeEach(() => {
			vi.clearAllMocks();
			recordJobExecutionMeasurementMock.mockResolvedValue(Result.ok(undefined));
			applyLibraryProcessingChangeMock.mockResolvedValue(APPLY_OK_RESULT);
			vi.mocked(finalizeEnrichmentJob).mockResolvedValue(Result.ok("applied"));
		});

		it("captures enrichment_candidate_batch_ready when newCandidatesAvailable", async () => {
			vi.mocked(executeEnrichmentJob).mockResolvedValue(ENRICHMENT_EXEC_RESULT);

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

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

			await runClaimedJob(makeJob(), "@test", LIVE_LEASE);

			const calls = vi.mocked(captureWorkerEvent).mock.calls;
			const eventNames = calls.map((c) => c[0].event);
			// enrichment_candidate_batch_ready fires before settlement
			expect(eventNames).toContain("enrichment_candidate_batch_ready");
			// first_match_refresh_queued requires "settled" status — must be absent
			expect(eventNames).not.toContain("first_match_refresh_queued");
		});
	});
});
