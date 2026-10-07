import { describe, expect, it } from "vitest";
import { makeWorkerOutcomes } from "@/test/fixtures";
import {
	accountEventsOf,
	changeOf,
	enrichmentRunOutcome,
	finalStatusOf,
	measurementOf,
	type WorkerOutcome,
	workerOutcomeFromMeasurement,
} from "../worker-outcome";

const outcomes = makeWorkerOutcomes();
const ids = { jobId: "job-1", accountId: "acct-1" };

describe("changeOf follows the spec's worker outcome tables", () => {
	it.each<[string, WorkerOutcome, unknown]>([
		[
			"enrichment completed",
			outcomes.enrichmentCompleted,
			{
				kind: "enrichment_completed",
				...ids,
				requestSatisfied: false,
				newCandidatesAvailable: true,
			},
		],
		[
			"enrichment blocked",
			outcomes.enrichmentBlocked,
			{ kind: "enrichment_stopped", ...ids, reason: "blocked" },
		],
		[
			"enrichment failed",
			outcomes.enrichmentFailed,
			{ kind: "enrichment_stopped", ...ids, reason: "error" },
		],
		[
			"refresh published",
			outcomes.refreshPublished,
			{ kind: "match_snapshot_published", ...ids },
		],
		[
			"refresh superseded",
			outcomes.refreshSuperseded,
			{ kind: "match_snapshot_superseded", ...ids },
		],
		[
			"refresh failed",
			outcomes.refreshFailed,
			{ kind: "match_snapshot_failed", ...ids },
		],
	])("%s", (_, outcome, change) => {
		expect(changeOf(outcome)).toEqual(change);
	});
});

describe("finalStatusOf", () => {
	it("fails the job row only for failed runs; blocked and superseded runs complete it", () => {
		expect(finalStatusOf(outcomes.enrichmentCompleted)).toBe("completed");
		expect(finalStatusOf(outcomes.enrichmentBlocked)).toBe("completed");
		expect(finalStatusOf(outcomes.refreshPublished)).toBe("completed");
		expect(finalStatusOf(outcomes.refreshSuperseded)).toBe("completed");
		expect(finalStatusOf(outcomes.enrichmentFailed)).toBe("failed");
		expect(finalStatusOf(outcomes.refreshFailed)).toBe("failed");
	});
});

describe("accountEventsOf", () => {
	it.each<[string, WorkerOutcome, unknown[]]>([
		[
			"enrichment completed reports the run's counts",
			outcomes.enrichmentCompleted,
			[
				{
					accountId: "acct-1",
					type: "enrichment_completed",
					payload: {
						jobId: "job-1",
						counts: { done: 18, total: 20, succeeded: 16, failed: 2 },
					},
				},
			],
		],
		[
			"a blocked run stops with reason blocked, not failed",
			outcomes.enrichmentBlocked,
			[
				{
					accountId: "acct-1",
					type: "enrichment_stopped",
					payload: {
						jobId: "job-1",
						reason: "blocked",
						counts: { done: 0, total: 4, succeeded: 0, failed: 0 },
					},
				},
			],
		],
		[
			"enrichment failed",
			outcomes.enrichmentFailed,
			[
				{
					accountId: "acct-1",
					type: "enrichment_stopped",
					payload: {
						jobId: "job-1",
						reason: "failed",
						counts: { done: 0, total: 0, succeeded: 0, failed: 0 },
					},
				},
			],
		],
		[
			"refresh published, one event per orientation",
			outcomes.refreshPublished,
			[
				{
					accountId: "acct-1",
					type: "match_snapshot_published",
					payload: { orientation: "song", snapshotId: "snap-1" },
				},
				{
					accountId: "acct-1",
					type: "match_snapshot_published",
					payload: { orientation: "playlist", snapshotId: "snap-1" },
				},
			],
		],
		[
			"a no-op publish only wakes active jobs",
			{ ...outcomes.refreshPublished, snapshotId: null },
			[{ accountId: "acct-1", type: "active_jobs_changed", payload: {} }],
		],
		[
			"refresh superseded",
			outcomes.refreshSuperseded,
			[{ accountId: "acct-1", type: "active_jobs_changed", payload: {} }],
		],
		[
			"refresh failed",
			outcomes.refreshFailed,
			[
				{
					accountId: "acct-1",
					type: "match_snapshot_failed",
					payload: {
						orientation: null,
						snapshotId: null,
						reason: "snapshot exploded",
					},
				},
			],
		],
	])("%s", (_, outcome, events) => {
		expect(accountEventsOf(outcome)).toEqual(events);
	});
});

describe("measurementOf keeps the persisted outcome strings and details keys", () => {
	it("records enrichment completion under 'completed' with its counts", () => {
		expect(measurementOf(outcomes.enrichmentCompleted)).toEqual({
			job_id: "job-1",
			account_id: "acct-1",
			workflow: "enrichment",
			outcome: "completed",
			details: {
				requestSatisfied: false,
				newCandidatesAvailable: true,
				batchSequence: 2,
				readyCount: 5,
				doneCount: 18,
				totalCount: 20,
				succeededCount: 16,
				failedCount: 2,
			},
		});
	});

	it.each<[string, WorkerOutcome, string]>([
		["enrichment blocked", outcomes.enrichmentBlocked, "blocked"],
		["enrichment failed", outcomes.enrichmentFailed, "error"],
		["refresh published", outcomes.refreshPublished, "completed"],
		["refresh superseded", outcomes.refreshSuperseded, "superseded"],
		["refresh failed", outcomes.refreshFailed, "error"],
	])("records %s as '%s'", (_, outcome, persisted) => {
		expect(measurementOf(outcome).outcome).toBe(persisted);
	});

	it("records a published refresh's published/isEmpty flags", () => {
		expect(measurementOf(outcomes.refreshPublished).details).toMatchObject({
			published: true,
			isEmpty: false,
		});
	});
});

describe("workerOutcomeFromMeasurement", () => {
	it.each(
		Object.entries(outcomes),
	)("round-trips %s through its measurement", (_, outcome) => {
		expect(workerOutcomeFromMeasurement(measurementOf(outcome))).toEqual(
			outcome,
		);
	});

	const legacy = { job_id: "job-1", account_id: "acct-1" };

	it("decodes a legacy enrichment completion that predates totalCount", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "enrichment",
				outcome: "completed",
				details: {
					requestSatisfied: true,
					newCandidatesAvailable: false,
					batchSequence: 1,
					readyCount: 3,
					doneCount: 3,
					succeededCount: 3,
					failedCount: 0,
				},
			}),
		).toEqual({
			...ids,
			workflow: "enrichment",
			status: "completed",
			batchSequence: 1,
			requestSatisfied: true,
			newCandidatesAvailable: false,
			counts: { ready: 3, done: 3, total: 0, succeeded: 3, failed: 0 },
		});
	});

	it("decodes a legacy blocked row as blocked", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "enrichment",
				outcome: "blocked",
				details: { batchSequence: 4, readyCount: 2, doneCount: 0 },
			}),
		).toEqual({
			...ids,
			workflow: "enrichment",
			status: "blocked",
			batchSequence: 4,
			counts: { ready: 2, done: 0, total: 0, succeeded: 0, failed: 0 },
		});
	});

	it("decodes a legacy published row without a snapshot id", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "match_snapshot_refresh",
				outcome: "completed",
				details: { published: true, isEmpty: true },
			}),
		).toEqual({
			...ids,
			workflow: "match_snapshot_refresh",
			status: "published",
			published: true,
			isEmpty: true,
			snapshotId: null,
		});
	});

	it("decodes a legacy error row without its error text as failed", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "match_snapshot_refresh",
				outcome: "error",
				details: {},
			}),
		).toMatchObject({ status: "failed" });
	});

	it("reads a retried attempt as no ending", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "enrichment",
				outcome: "error",
				details: { retrying: true },
			}),
		).toBeNull();
	});

	it("reads a completion missing its decisive flags as no ending", () => {
		expect(
			workerOutcomeFromMeasurement({
				...legacy,
				workflow: "enrichment",
				outcome: "completed",
				details: { doneCount: 3 },
			}),
		).toBeNull();
	});
});

describe("enrichmentRunOutcome", () => {
	const run = {
		accountId: "acct-1",
		jobId: "job-1",
		batchSequence: 0,
		hasMoreSongs: true,
		newCandidatesAvailable: false,
		newCandidateSongIds: [],
		selectionMode: "normal" as const,
		readyCount: 2,
		doneCount: 0,
		totalCount: 6,
		succeededCount: 0,
		failedCount: 0,
	};

	it("is blocked when the chunk attempted nothing while work is still owed", () => {
		expect(enrichmentRunOutcome(run).status).toBe("blocked");
	});

	it("completes, satisfied, when the chunk attempted nothing because nothing is owed", () => {
		expect(enrichmentRunOutcome({ ...run, hasMoreSongs: false })).toMatchObject(
			{ status: "completed", requestSatisfied: true },
		);
	});

	it("carries the run's own counts (regression: events reported the claim-time job.progress)", () => {
		expect(
			enrichmentRunOutcome({
				...run,
				doneCount: 5,
				succeededCount: 4,
				failedCount: 1,
			}),
		).toMatchObject({
			status: "completed",
			requestSatisfied: false,
			counts: { ready: 2, done: 5, total: 6, succeeded: 4, failed: 1 },
		});
	});
});
