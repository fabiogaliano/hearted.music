import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		applyLibraryProcessingChangeMock(...args),
}));

import { captureException } from "@sentry/bun";
import { makeJob } from "@/test/fixtures";
import { finalizeJob } from "@/worker/finalize";

vi.mock("@/worker/finalize", () => ({
	finalizeJob: vi.fn(),
}));

import { executeMatchSnapshotRefreshJob } from "@/worker/execute";
import { captureWorkerJobFailure } from "@/worker/job-failure-reporting";
import { runClaimedJob } from "../library-processing-runner";

// A lease the heartbeat never reports lost.
const LIVE_LEASE = new AbortController().signal;

const supersedableRefreshJob = makeJob({
	id: "job-2",
	type: "match_snapshot_refresh",
	status: "running",
	attempts: 1,
	satisfies_requested_at: "2026-06-25T09:00:00Z",
});

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
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		await runClaimedJob(supersedableRefreshJob, "@test", LIVE_LEASE);

		expect(finalizeJob).toHaveBeenCalledWith(
			expect.objectContaining({ id: "job-2" }),
			expect.objectContaining({
				workflow: "match_snapshot_refresh",
				status: "superseded",
			}),
		);
	});

	it("applies match_snapshot_superseded change (not published) when superseded", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		await runClaimedJob(supersedableRefreshJob, "@test", LIVE_LEASE);

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
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		await runClaimedJob(supersedableRefreshJob, "@test", LIVE_LEASE);

		expect(recordJobExecutionMeasurementMock).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "superseded" }),
		);
	});

	it("does not call captureWorkerJobFailure or captureException when superseded", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		await runClaimedJob(supersedableRefreshJob, "@test", LIVE_LEASE);

		expect(captureWorkerJobFailure).not.toHaveBeenCalled();
		expect(captureException).not.toHaveBeenCalled();
	});

	it("returns a completed outcome with its settlement", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		const outcome = await runClaimedJob(
			supersedableRefreshJob,
			"@test",
			LIVE_LEASE,
		);

		expect(outcome.status).toBe("completed");
		expect(outcome.workflow).toBe("match_snapshot_refresh");
		expect("settlement" in outcome ? outcome.settlement : null).toBe("settled");
	});

	it("settles after superseded with match_snapshot_superseded change", async () => {
		vi.mocked(executeMatchSnapshotRefreshJob).mockResolvedValue(
			SUPERSEDED_EXEC_RESULT,
		);
		vi.mocked(finalizeJob).mockResolvedValue(Result.ok("applied"));

		const outcome = await runClaimedJob(
			supersedableRefreshJob,
			"@test",
			LIVE_LEASE,
		);

		expect("settlement" in outcome ? outcome.settlement : null).toBe("settled");
		expect(applyLibraryProcessingChangeMock).toHaveBeenCalledTimes(1);
		const changeArg = applyLibraryProcessingChangeMock.mock.calls[0]?.[0];
		expect(changeArg?.kind).toBe("match_snapshot_superseded");
	});
});
