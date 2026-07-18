import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/jobs/repository", () => ({
	markJobCompleted: vi.fn(),
	markJobFailed: vi.fn(),
	heartbeatJob: vi.fn(),
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

vi.mock("@/worker/job-failure-reporting", () => ({
	captureWorkerJobFailure: vi.fn(),
}));

const applyLibraryProcessingChangeMock = vi.fn();

vi.mock("../service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		applyLibraryProcessingChangeMock(...args),
}));

import { captureException } from "@sentry/bun";
import type { Job } from "@/lib/platform/jobs/repository";

import { settleMatchSnapshotRefreshJobTerminal } from "../settlement";

vi.mock("../settlement", () => ({
	settleMatchSnapshotRefreshJobTerminal: vi.fn(),
	settleEnrichmentJobTerminal: vi.fn(),
}));

import { executeMatchSnapshotRefreshJob } from "@/worker/execute";
import { captureWorkerJobFailure } from "@/worker/job-failure-reporting";
import { runClaimedJob } from "../runner";

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-2",
		account_id: "acct-1",
		type: "match_snapshot_refresh",
		status: "running",
		progress: {},
		error: null,
		attempts: 1,
		max_attempts: 3,
		created_at: "2026-06-25T00:00:00Z",
		updated_at: "2026-06-25T00:00:00Z",
		started_at: "2026-06-25T00:00:00Z",
		completed_at: null,
		heartbeat_at: "2026-06-25T00:00:00Z",
		queue_priority: 0,
		satisfies_requested_at: "2026-06-25T09:00:00Z",
		...overrides,
	} as Job;
}

const SUPERSEDED_EXEC_RESULT = {
	status: "superseded" as const,
	accountId: "acct-1",
	jobId: "job-2",
};

const APPLY_OK_RESULT = Result.ok({
	accountId: "acct-1",
	changeKind: "match_snapshot_superseded" as const,
	state: {
		accountId: "acct-1",
		enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
		matchSnapshotRefresh: {
			requestedAt: "2026-06-25T10:00:00Z",
			settledAt: null,
			activeJobId: null,
		},
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	effects: [],
	effectResults: [],
});

describe("runClaimedJob — superseded match_snapshot_refresh", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		recordJobExecutionMeasurementMock.mockResolvedValue(Result.ok(undefined));
		applyLibraryProcessingChangeMock.mockResolvedValue(APPLY_OK_RESULT);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("marks job completed (not failed) when superseded", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		await runClaimedJob(makeJob(), "@test");

		expect(settleMatchSnapshotRefreshJobTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ id: "job-2" }),
			"completed",
			"superseded",
			null,
		);
	});

	it("applies match_snapshot_superseded change (not published) when superseded", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		await runClaimedJob(makeJob(), "@test");

		expect(applyLibraryProcessingChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "match_snapshot_superseded",
				accountId: "acct-1",
				jobId: "job-2",
			}),
		);

		const changeArg = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
		expect(changeArg?.kind).not.toBe("match_snapshot_published");
	});

	it("writes measurement with superseded outcome", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		await runClaimedJob(makeJob(), "@test");

		expect(recordJobExecutionMeasurementMock).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "superseded" }),
		);
	});

	it("does not call captureWorkerJobFailure or captureException when superseded", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		await runClaimedJob(makeJob(), "@test");

		expect(captureWorkerJobFailure).not.toHaveBeenCalled();
		expect(captureException).not.toHaveBeenCalled();
	});

	it("returns completed outcome with superseded result and settlement", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		const outcome = await runClaimedJob(makeJob(), "@test");

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("match_snapshot_refresh");
		expect(outcome.status === "retrying" ? null : outcome.settlement).toBe(
			"settled",
		);
		if (
			outcome.status === "completed" &&
			outcome.workflow === "match_snapshot_refresh"
		) {
			expect(outcome.result).toEqual(SUPERSEDED_EXEC_RESULT);
		}
	});

	it("settles after superseded with match_snapshot_superseded change", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(settleMatchSnapshotRefreshJobTerminal).mockResolvedValue(
			Result.ok(undefined),
		);

		const outcome = await runClaimedJob(makeJob(), "@test");

		expect(outcome.status === "retrying" ? null : outcome.settlement).toBe(
			"settled",
		);
		expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);
		const changeArg = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
		expect(changeArg?.kind).toBe("match_snapshot_superseded");
	});
});
