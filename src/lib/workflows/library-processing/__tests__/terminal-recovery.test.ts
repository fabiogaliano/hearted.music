import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/data/jobs";
import { DatabaseError } from "@/lib/shared/errors/database";
import { reconcileLibraryProcessing } from "../reconciler";
import type {
	LibraryProcessingApplyOutcome,
	LibraryProcessingState,
} from "../types";

vi.mock("../service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

import { applyLibraryProcessingChange } from "../service";
import {
	recoverDeadLetteredLibraryProcessingJob,
	recoverDeadLetteredLibraryProcessingJobs,
} from "../terminal-recovery";

const applyMock = vi.mocked(applyLibraryProcessingChange);

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
