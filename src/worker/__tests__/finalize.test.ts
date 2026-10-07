import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

// `tx` and `sql` are postgres.js tagged templates. The fake keeps one job row:
// the fenced UPDATE ends it only while it is running under this attempt, as the
// real WHERE clause does, so a retry sees what an earlier attempt committed.
const { db } = vi.hoisted(() => ({
	db: {
		log: [] as string[],
		row: { status: "running", attempts: 1, error: null as string | null },
		beginFailures: [] as ("before-commit" | "after-commit")[],
	},
}));

function classify(strings: TemplateStringsArray): string {
	const text = strings.join("?");
	if (text.includes("UPDATE job")) return "fence";
	if (text.includes("INSERT INTO job_execution_measurement"))
		return "measurement";
	if (text.includes("library_processing_state")) return "state";
	if (text.includes("FROM job")) return "reread";
	return "other";
}

vi.mock("postgres", () => {
	const tx = Object.assign(
		vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const kind = classify(strings);
			db.log.push(kind);
			if (kind !== "fence") return [];
			const [status, error, , attempts] = values;
			if (db.row.status !== "running" || db.row.attempts !== attempts) {
				return [];
			}
			db.row = { ...db.row, status: String(status), error: error as string };
			return [{ id: "job-1" }];
		}),
		{ json: (value: unknown) => value },
	);
	const sql = Object.assign(
		vi.fn(async (strings: TemplateStringsArray) => {
			db.log.push(classify(strings));
			return [db.row];
		}),
		{
			begin: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
				const failure = db.beginFailures.shift();
				if (failure === "before-commit") throw new Error("connection reset");
				const committed = await cb(tx);
				if (failure === "after-commit") {
					throw new Error("connection reset after commit");
				}
				return committed;
			}),
		},
	);
	return { default: () => sql };
});

vi.mock("@/lib/account-events/producer", () => ({
	writeAccountEvent: vi.fn(async (_tx: unknown, event: { type: string }) => {
		db.log.push(`event:${event.type}`);
	}),
}));

import { writeAccountEvent } from "@/lib/account-events/producer";
import type { WorkerOutcome } from "@/lib/workflows/library-processing/worker-outcome";
import { makeJob, makeWorkerOutcomes } from "@/test/fixtures";
import { finalizeJob } from "../finalize";

const outcomes = makeWorkerOutcomes();
const job = makeJob({ status: "running", attempts: 1 });

async function finalize(outcome: WorkerOutcome = outcomes.enrichmentCompleted) {
	const promise = finalizeJob(job, outcome);
	await vi.advanceTimersByTimeAsync(10_000);
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	db.log = [];
	db.row = { status: "running", attempts: 1, error: null };
	db.beginFailures = [];
});

afterEach(() => {
	vi.useRealTimers();
});

describe("finalizeJob writes one run's records in one transaction", () => {
	it("enrichment: fence, then measurement, then events", async () => {
		expect(await finalize()).toHaveOkValue("applied");
		expect(db.log).toEqual([
			"fence",
			"measurement",
			"event:enrichment_completed",
		]);
	});

	it("match refresh: fence, then measurement, then events; library_processing_state is left to the reconciler", async () => {
		expect(await finalize(outcomes.refreshPublished)).toHaveOkValue("applied");
		expect(db.log).toEqual([
			"fence",
			"measurement",
			"event:match_snapshot_published",
			"event:match_snapshot_published",
		]);
	});

	it("writes the outcome's events through the transaction", async () => {
		await finalize();
		expect(writeAccountEvent).toHaveBeenCalledWith(expect.anything(), {
			accountId: "acct-1",
			type: "enrichment_completed",
			payload: {
				jobId: "job-1",
				counts: { done: 18, total: 20, succeeded: 16, failed: 2 },
			},
		});
	});

	it("records nothing and reports lease_lost when another claim owns the job", async () => {
		db.row = { status: "running", attempts: 2, error: null };

		expect(await finalize()).toHaveOkValue("lease_lost");
		expect(db.log).toEqual(["fence"]);
	});
});

describe("finalizeJob retries by final status", () => {
	it("regression: retries a completed run's finalize instead of leaving an already-executed job unrecorded", async () => {
		db.beginFailures = ["before-commit"];

		expect(await finalize()).toHaveOkValue("applied");
		expect(db.row.status).toBe("completed");
	});

	it("gives a failed run's finalize a single attempt", async () => {
		db.beginFailures = ["before-commit", "before-commit"];

		const result = await finalize(outcomes.enrichmentFailed);

		expect(result).toBeErr();
		if (result.isErr()) expect(result.error).toBeInstanceOf(DatabaseError);
		expect(db.row.status).toBe("running");
		expect(writeAccountEvent).not.toHaveBeenCalled();
	});
});

describe("finalizeJob after an errored attempt", () => {
	it("regression: a committed finalize whose reply was lost reports applied, not lease_lost", async () => {
		db.beginFailures = ["after-commit"];

		expect(await finalize()).toHaveOkValue("applied");
		expect(db.log.filter((kind) => kind === "measurement")).toHaveLength(1);
	});

	it("reports applied for a failed run whose single attempt committed", async () => {
		db.beginFailures = ["after-commit"];

		expect(await finalize(outcomes.enrichmentFailed)).toHaveOkValue("applied");
	});

	it("keeps lease_lost when a dead-letter ended the row under the same attempt", async () => {
		db.beginFailures = ["before-commit"];
		db.row = {
			status: "failed",
			attempts: 1,
			error: "max attempts exhausted after stale detection",
		};

		expect(await finalize()).toHaveOkValue("lease_lost");
	});
});
