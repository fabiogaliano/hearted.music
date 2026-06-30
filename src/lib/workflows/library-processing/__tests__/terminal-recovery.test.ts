import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import { reconcileLibraryProcessing } from "../reconciler";
import type {
	LibraryProcessingApplyOutcome,
	LibraryProcessingState,
} from "../types";

vi.mock("../service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

vi.mock("../queries", async (importOriginal) => {
	const original = await importOriginal<typeof import("../queries")>();
	return {
		...original,
		findTerminalActiveRefs: vi.fn(),
	};
});

vi.mock(
	"@/lib/platform/jobs/execution-measurements",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("@/lib/platform/jobs/execution-measurements")
			>();
		return {
			...original,
			getLatestJobExecutionMeasurement: vi.fn(),
		};
	},
);

// resolveAccountLabel runs a real getAccountById DB query on every recovered
// ref (it's a log-label helper). Unmocked, it connects to the placeholder
// DATABASE_URL in CI and hangs past the 5s test timeout; locally a live
// Supabase masks it. Stub it so these tests stay DB-free and deterministic.
vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: vi.fn(async (accountId: string) => `acct:${accountId}`),
}));

import { getLatestJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import { findTerminalActiveRefs } from "../queries";
import { applyLibraryProcessingChange } from "../service";
import {
	recoverDeadLetteredLibraryProcessingJob,
	recoverDeadLetteredLibraryProcessingJobs,
	recoverTerminalLibraryProcessingRefs,
} from "../terminal-recovery";

const applyMock = vi.mocked(applyLibraryProcessingChange);
const findTerminalActiveRefsMock = vi.mocked(findTerminalActiveRefs);
const getMeasurementMock = vi.mocked(getLatestJobExecutionMeasurement);

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: overrides.id ?? "job-1",
		account_id: overrides.account_id ?? "acct-1",
		type: "enrichment",
		status: "failed",
		attempts: 3,
		max_attempts: 3,
		progress: null,
		queue_priority: null,
		error: null,
		heartbeat_at: null,
		started_at: null,
		completed_at: null,
		satisfies_requested_at: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	} as Job;
}

function makeState(
	overrides: Partial<LibraryProcessingState> = {},
): LibraryProcessingState {
	return {
		accountId: "acct-1",
		enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
		matchSnapshotRefresh: {
			requestedAt: null,
			settledAt: null,
			activeJobId: null,
		},
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeApplyOutcome(
	overrides: Partial<LibraryProcessingApplyOutcome> = {},
): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind: "enrichment_stopped",
		state: makeState(),
		effects: [],
		effectResults: [],
		...overrides,
	};
}

describe("recoverDeadLetteredLibraryProcessingJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies enrichment_stopped for dead enrichment jobs", async () => {
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const result = await recoverDeadLetteredLibraryProcessingJob(
			makeJob({ id: "j-dead", account_id: "acct-1", type: "enrichment" }),
		);

		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_stopped",
			accountId: "acct-1",
			jobId: "j-dead",
			reason: "error",
		});
		expect(result).not.toBeNull();
		if (result === null) {
			throw new Error("expected recovery result");
		}
		expect(result.jobId).toBe("j-dead");
		expect(result.jobType).toBe("enrichment");
		expect(Result.isOk(result.outcome)).toBe(true);
	});

	it("applies match_snapshot_failed for dead match_snapshot_refresh jobs", async () => {
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_failed" })),
		);

		const result = await recoverDeadLetteredLibraryProcessingJob(
			makeJob({
				id: "j-dead-ms",
				account_id: "acct-2",
				type: "match_snapshot_refresh" as Job["type"],
			}),
		);

		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_failed",
			accountId: "acct-2",
			jobId: "j-dead-ms",
		});
		expect(result).not.toBeNull();
		if (result === null) {
			throw new Error("expected recovery result");
		}
		expect(result.jobType).toBe("match_snapshot_refresh");
	});

	it("returns null for non-library-processing job types", async () => {
		const result = await recoverDeadLetteredLibraryProcessingJob(
			makeJob({ type: "sync_liked_songs" as Job["type"] }),
		);

		expect(result).toBeNull();
		expect(applyMock).not.toHaveBeenCalled();
	});

	it("propagates apply errors in the outcome without throwing", async () => {
		const applyError = {
			kind: "load_state" as const,
			cause: new DatabaseError({ code: "500", message: "db down" }),
		};
		applyMock.mockResolvedValue(Result.err(applyError));

		const result = await recoverDeadLetteredLibraryProcessingJob(
			makeJob({ id: "j-fail" }),
		);

		expect(result).not.toBeNull();
		if (result === null) {
			throw new Error("expected recovery result");
		}
		expect(Result.isError(result.outcome)).toBe(true);
	});
});

describe("recoverDeadLetteredLibraryProcessingJobs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("recovers multiple jobs sequentially", async () => {
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverDeadLetteredLibraryProcessingJobs([
			makeJob({ id: "j-1", type: "enrichment" }),
			makeJob({
				id: "j-2",
				type: "match_snapshot_refresh" as Job["type"],
			}),
		]);

		expect(results).toHaveLength(2);
		expect(results[0].jobId).toBe("j-1");
		expect(results[1].jobId).toBe("j-2");
		expect(applyMock).toHaveBeenCalledTimes(2);
	});

	it("skips non-library-processing jobs", async () => {
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverDeadLetteredLibraryProcessingJobs([
			makeJob({ id: "j-1", type: "enrichment" }),
			makeJob({ id: "j-2", type: "sync_liked_songs" as Job["type"] }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].jobId).toBe("j-1");
	});

	it("continues processing after a failed recovery", async () => {
		const applyError = {
			kind: "load_state" as const,
			cause: new DatabaseError({ code: "500", message: "db down" }),
		};
		applyMock
			.mockResolvedValueOnce(Result.err(applyError))
			.mockResolvedValueOnce(Result.ok(makeApplyOutcome()));

		const results = await recoverDeadLetteredLibraryProcessingJobs([
			makeJob({ id: "j-1", type: "enrichment" }),
			makeJob({
				id: "j-2",
				type: "match_snapshot_refresh" as Job["type"],
			}),
		]);

		expect(results).toHaveLength(2);
		expect(Result.isError(results[0].outcome)).toBe(true);
		expect(Result.isOk(results[1].outcome)).toBe(true);
	});
});

describe("reconciler: dead-letter recovery changes", () => {
	it("enrichment_stopped clears the active ref", () => {
		const state = makeState({
			enrichment: {
				requestedAt: "2026-01-01T00:00:00Z",
				settledAt: null,
				activeJobId: "j-dead",
			},
		});

		const { state: newState } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "enrichment_stopped",
				accountId: "acct-1",
				jobId: "j-dead",
				reason: "error",
			},
			requestMarker: "2026-01-02T00:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(newState.enrichment.activeJobId).toBeNull();
	});

	it("match_snapshot_failed clears the active ref", () => {
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-01-01T00:00:00Z",
				settledAt: null,
				activeJobId: "j-dead",
			},
		});

		const { state: newState } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_failed",
				accountId: "acct-1",
				jobId: "j-dead",
			},
			requestMarker: "2026-01-02T00:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(newState.matchSnapshotRefresh.activeJobId).toBeNull();
	});

	it("enrichment_stopped does not immediately ensure a new job", () => {
		const state = makeState({
			enrichment: {
				requestedAt: "2026-01-01T00:00:00Z",
				settledAt: null,
				activeJobId: "j-dead",
			},
		});

		const { effects } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "enrichment_stopped",
				accountId: "acct-1",
				jobId: "j-dead",
				reason: "error",
			},
			requestMarker: "2026-01-02T00:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(effects).toHaveLength(0);
	});

	it("match_snapshot_failed does not immediately ensure a new job", () => {
		const state = makeState({
			matchSnapshotRefresh: {
				requestedAt: "2026-01-01T00:00:00Z",
				settledAt: null,
				activeJobId: "j-dead",
			},
		});

		const { effects } = reconcileLibraryProcessing({
			state,
			change: {
				kind: "match_snapshot_failed",
				accountId: "acct-1",
				jobId: "j-dead",
			},
			requestMarker: "2026-01-02T00:00:00Z",
			hasTargetPlaylists: true,
			satisfiedMarker: null,
		});

		expect(effects).toHaveLength(0);
	});
});

function makeMeasurement(
	overrides: Partial<JobExecutionMeasurement> = {},
): JobExecutionMeasurement {
	return {
		id: "meas-1",
		job_id: "job-1",
		account_id: "acct-1",
		workflow: "enrichment",
		queue_priority: null,
		attempt_number: 1,
		queued_at: null,
		started_at: null,
		finished_at: "2026-01-01T01:00:00Z",
		outcome: "completed",
		details: null,
		created_at: "2026-01-01T01:00:00Z",
		...overrides,
	};
}

describe("recoverTerminalLibraryProcessingRefs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty when no terminal refs found", async () => {
		findTerminalActiveRefsMock.mockResolvedValue(Result.ok([]));

		const results = await recoverTerminalLibraryProcessingRefs();
		expect(results).toHaveLength(0);
	});

	it("applies enrichment_stopped for failed enrichment refs", async () => {
		const job = makeJob({ id: "j-fail", status: "failed", type: "enrichment" });
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([{ state: makeState(), workflow: "enrichment", job }]),
		);
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(results[0].jobStatus).toBe("failed");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_stopped",
			accountId: "acct-1",
			jobId: "j-fail",
			reason: "error",
		});
	});

	it("applies match_snapshot_failed for failed match_snapshot_refresh refs", async () => {
		const job = makeJob({
			id: "j-fail-ms",
			status: "failed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_failed" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_failed",
			accountId: "acct-1",
			jobId: "j-fail-ms",
		});
	});

	it("reconstructs enrichment_completed from valid measurement details", async () => {
		const job = makeJob({
			id: "j-comp",
			status: "completed",
			type: "enrichment",
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([{ state: makeState(), workflow: "enrichment", job }]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-comp",
					outcome: "completed",
					details: {
						requestSatisfied: true,
						newCandidatesAvailable: false,
					},
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "enrichment_completed" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("completed_from_measurement");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_completed",
			accountId: "acct-1",
			jobId: "j-comp",
			requestSatisfied: true,
			newCandidatesAvailable: false,
			newCandidateSongIds: [],
		});
	});

	it("reconstructs match_snapshot_published from valid measurement", async () => {
		const job = makeJob({
			id: "j-comp-ms",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-comp-ms",
					workflow: "match_snapshot_refresh",
					outcome: "completed",
					details: { published: true, isEmpty: false },
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_published" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("completed_from_measurement");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_published",
			accountId: "acct-1",
			jobId: "j-comp-ms",
		});
	});

	it("reconstructs match_snapshot_superseded from superseded measurement", async () => {
		const job = makeJob({
			id: "j-superseded-ms",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-superseded-ms",
					workflow: "match_snapshot_refresh",
					outcome: "superseded",
					details: null,
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_superseded" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("completed_from_measurement");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_superseded",
			accountId: "acct-1",
			jobId: "j-superseded-ms",
		});
	});

	it("does not treat a superseded match_snapshot_refresh as failed", async () => {
		const job = makeJob({
			id: "j-sup-not-fail",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-sup-not-fail",
					workflow: "match_snapshot_refresh",
					outcome: "superseded",
					details: null,
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_superseded" })),
		);

		await recoverTerminalLibraryProcessingRefs();

		// Must not emit the failed change kind
		const calls = applyMock.mock.calls;
		for (const [change] of calls) {
			expect(change.kind).not.toBe("match_snapshot_failed");
		}
	});

	it("falls back to conservative failure when measurement is missing", async () => {
		const job = makeJob({
			id: "j-no-meas",
			status: "completed",
			type: "enrichment",
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([{ state: makeState(), workflow: "enrichment", job }]),
		);
		getMeasurementMock.mockResolvedValue(Result.ok(null));
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_stopped",
			accountId: "acct-1",
			jobId: "j-no-meas",
			reason: "error",
		});
	});

	it("falls back to conservative failure when measurement details are invalid", async () => {
		const job = makeJob({
			id: "j-bad-details",
			status: "completed",
			type: "enrichment",
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([{ state: makeState(), workflow: "enrichment", job }]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-bad-details",
					outcome: "completed",
					details: { irrelevantField: "bad" },
				}),
			),
		);
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_stopped",
			accountId: "acct-1",
			jobId: "j-bad-details",
			reason: "error",
		});
	});

	it("falls back to conservative failure when match snapshot measurement details are missing", async () => {
		const job = makeJob({
			id: "j-ms-no-details",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-ms-no-details",
					workflow: "match_snapshot_refresh",
					outcome: "completed",
					details: null,
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_failed" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_failed",
			accountId: "acct-1",
			jobId: "j-ms-no-details",
		});
	});

	it("falls back to conservative failure when measurement outcome is not completed", async () => {
		const job = makeJob({
			id: "j-err-meas",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "match_snapshot_refresh", job },
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-err-meas",
					workflow: "match_snapshot_refresh",
					outcome: "error",
				}),
			),
		);
		applyMock.mockResolvedValue(
			Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_failed" })),
		);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "match_snapshot_failed",
			accountId: "acct-1",
			jobId: "j-err-meas",
		});
	});

	it("propagates apply errors without stopping subsequent recoveries", async () => {
		const failedJob = makeJob({
			id: "j-1",
			account_id: "acct-1",
			status: "failed",
			type: "enrichment",
		});
		const completedJob = makeJob({
			id: "j-2",
			account_id: "acct-2",
			status: "completed",
			type: "match_snapshot_refresh" as Job["type"],
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([
				{ state: makeState(), workflow: "enrichment", job: failedJob },
				{
					state: makeState({ accountId: "acct-2" }),
					workflow: "match_snapshot_refresh",
					job: completedJob,
				},
			]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.ok(
				makeMeasurement({
					job_id: "j-2",
					workflow: "match_snapshot_refresh",
					outcome: "completed",
					details: { published: true, isEmpty: false },
				}),
			),
		);

		const applyError = {
			kind: "load_state" as const,
			cause: new DatabaseError({ code: "500", message: "db down" }),
		};
		applyMock
			.mockResolvedValueOnce(Result.err(applyError))
			.mockResolvedValueOnce(
				Result.ok(makeApplyOutcome({ changeKind: "match_snapshot_published" })),
			);

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(2);
		expect(Result.isError(results[0].outcome)).toBe(true);
		expect(Result.isOk(results[1].outcome)).toBe(true);
	});

	it("returns empty when findTerminalActiveRefs query fails", async () => {
		const dbErr = new DatabaseError({ code: "500", message: "query failed" });
		findTerminalActiveRefsMock.mockResolvedValue(Result.err(dbErr));

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(0);
		expect(applyMock).not.toHaveBeenCalled();
	});

	it("falls back to conservative failure when measurement query errors", async () => {
		const job = makeJob({
			id: "j-db-err",
			status: "completed",
			type: "enrichment",
		});
		findTerminalActiveRefsMock.mockResolvedValue(
			Result.ok([{ state: makeState(), workflow: "enrichment", job }]),
		);
		getMeasurementMock.mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "500", message: "measurement query failed" }),
			),
		);
		applyMock.mockResolvedValue(Result.ok(makeApplyOutcome()));

		const results = await recoverTerminalLibraryProcessingRefs();

		expect(results).toHaveLength(1);
		expect(results[0].recoveryStrategy).toBe("conservative_failure");
		expect(applyMock).toHaveBeenCalledWith({
			kind: "enrichment_stopped",
			accountId: "acct-1",
			jobId: "j-db-err",
			reason: "error",
		});
	});
});
