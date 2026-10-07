import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

// One returned row = the fenced job UPDATE won its compare-and-set.
const WON_FENCE = [{ id: "job-1" }];

const { txMock, beginMock } = vi.hoisted(() => {
	const txMock = vi.fn().mockResolvedValue([{ id: "job-1" }]);
	return {
		txMock,
		beginMock: vi.fn(async (cb) => cb(txMock)),
	};
});

vi.mock("postgres", () => ({
	default: () => ({
		begin: beginMock,
	}),
}));

vi.mock("@/lib/account-events/producer", () => ({
	writeAccountEvent: vi.fn(),
}));

import { writeAccountEvent } from "@/lib/account-events/producer";
import { makeJob, makeWorkerOutcomes } from "@/test/fixtures";
import { finalizeJob } from "../finalize";

// The claim-time progress the job row carried; events must not echo it.
const ENRICHMENT_PROGRESS = { done: 10, total: 20, succeeded: 8, failed: 2 };
const outcomes = makeWorkerOutcomes();

describe("finalizeJob: enrichment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txMock.mockResolvedValue(WON_FENCE);
		beginMock.mockImplementation(async (cb) => cb(txMock));
	});

	it("writes enrichment_completed with the run's counts, not the claim-time progress", async () => {
		const job = makeJob({ progress: ENRICHMENT_PROGRESS });
		const result = await finalizeJob(job, outcomes.enrichmentCompleted);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "enrichment_completed",
			payload: {
				jobId: "job-1",
				counts: { done: 18, total: 20, succeeded: 16, failed: 2 },
			},
		});
	});

	it("writes enrichment_stopped(failed) for a failed run", async () => {
		const job = makeJob({ progress: ENRICHMENT_PROGRESS });
		const result = await finalizeJob(job, outcomes.enrichmentFailed);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "enrichment_stopped",
			payload: {
				jobId: "job-1",
				reason: "failed",
				counts: { done: 0, total: 0, succeeded: 0, failed: 0 },
			},
		});
	});

	it("does not write account_event if transaction fails", async () => {
		// Mock the query inside tx to throw
		txMock.mockRejectedValueOnce(new Error("Update failed"));

		const job = makeJob({ progress: ENRICHMENT_PROGRESS });
		const result = await finalizeJob(job, outcomes.enrichmentCompleted);

		expect(result.isErr()).toBe(true);
		if (!result.isOk()) {
			expect(result.error).toBeInstanceOf(DatabaseError);
			if (result.error instanceof DatabaseError) {
				expect(result.error.code).toBe("finalize_failed");
			}
		}
		expect(writeAccountEvent).not.toHaveBeenCalled();
	});
});

describe("finalizeJob: match snapshot refresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txMock.mockResolvedValue(WON_FENCE);
		beginMock.mockImplementation(async (cb) => cb(txMock));
	});

	it("writes published events for both orientations with the snapshot id", async () => {
		const job = makeJob({ type: "match_snapshot_refresh" });

		const result = await finalizeJob(job, outcomes.refreshPublished);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenNthCalledWith(1, txMock, {
			accountId: "acct-1",
			type: "match_snapshot_published",
			payload: { orientation: "song", snapshotId: "snap-1" },
		});
		expect(writeAccountEvent).toHaveBeenNthCalledWith(2, txMock, {
			accountId: "acct-1",
			type: "match_snapshot_published",
			payload: { orientation: "playlist", snapshotId: "snap-1" },
		});
	});

	it("writes active_jobs_changed when a published refresh no-ops", async () => {
		const job = makeJob({ type: "match_snapshot_refresh" });

		const result = await finalizeJob(job, {
			...outcomes.refreshPublished,
			snapshotId: null,
		});

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "active_jobs_changed",
			payload: {},
		});
	});

	it("writes active_jobs_changed when a refresh is superseded", async () => {
		const job = makeJob({ type: "match_snapshot_refresh" });

		const result = await finalizeJob(job, outcomes.refreshSuperseded);

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "active_jobs_changed",
			payload: {},
		});
	});

	it("writes a failure event that tolerates null orientation and snapshot id", async () => {
		const job = makeJob({ type: "match_snapshot_refresh" });

		const result = await finalizeJob(job, {
			...outcomes.refreshFailed,
			error: "match snapshot refresh crashed during publish",
		});

		expect(result.isOk()).toBe(true);
		expect(writeAccountEvent).toHaveBeenCalledWith(txMock, {
			accountId: "acct-1",
			type: "match_snapshot_failed",
			payload: {
				orientation: null,
				snapshotId: null,
				reason: "match snapshot refresh crashed during publish",
			},
		});
	});
});
