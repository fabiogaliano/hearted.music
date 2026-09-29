import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { makeJob } from "@/test/fixtures";
import type { Job } from "../repository";

const {
	row,
	mockMarkClaimedJobTerminal,
	mockMarkJobRunning,
	mockMarkJobCompleted,
	mockMarkJobFailed,
} = vi.hoisted(() => ({
	row: { current: null as Job | null },
	mockMarkClaimedJobTerminal: vi.fn(),
	mockMarkJobRunning: vi.fn(),
	mockMarkJobCompleted: vi.fn(),
	mockMarkJobFailed: vi.fn(),
}));

vi.mock("../repository", () => ({
	markClaimedJobTerminal: mockMarkClaimedJobTerminal,
	markJobRunning: mockMarkJobRunning,
	markJobCompleted: mockMarkJobCompleted,
	markJobFailed: mockMarkJobFailed,
	getJobById: vi.fn(async () => Result.ok(row.current)),
}));

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { completeJob, failJob, settleClaimedJob, startJob } = await import(
	"../lifecycle"
);

const lostResponse = () =>
	Result.err(
		new DatabaseError({ code: "ECONNRESET", message: "socket hang up" }),
	);

// The row as the database holds it: each write is compare-and-set against it,
// and `commitThenLoseResponse` makes the first write commit before erroring.
function casWrite(
	matches: (job: Job) => boolean,
	apply: (job: Job) => Job,
	opts: { commitThenLoseResponse: boolean },
) {
	let calls = 0;
	return async () => {
		calls++;
		const current = row.current;
		const applied = current !== null && matches(current);
		if (applied) row.current = apply(current);
		if (calls === 1 && opts.commitThenLoseResponse) return lostResponse();
		return Result.ok(applied ? ("applied" as const) : ("superseded" as const));
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("a CAS write retried after its response was lost (regression: the retry saw its own committed write and reported superseded)", () => {
	const claim = makeJob({ id: "job-1", status: "running", attempts: 2 });
	const settle = (status: "completed" | "failed", error?: string) =>
		casWrite(
			(j) => j.status === "running" && j.attempts === claim.attempts,
			(j) => ({ ...j, status, error: error ?? null }),
			{ commitThenLoseResponse: true },
		);

	async function run<T>(promise: Promise<T>): Promise<T> {
		await vi.runAllTimersAsync();
		return promise;
	}

	it("settleClaimedJob reports applied when its first attempt committed", async () => {
		row.current = claim;
		mockMarkClaimedJobTerminal.mockImplementation(settle("completed"));

		expect(await run(settleClaimedJob(claim, "completed"))).toHaveOkValue(
			"applied",
		);
	});

	it("settleClaimedJob stays superseded when a sweep dead-lettered the claim instead", async () => {
		row.current = {
			...claim,
			status: "failed",
			error: "max attempts exhausted after stale detection",
		};
		mockMarkClaimedJobTerminal.mockImplementation(settle("failed", "boom"));

		expect(await run(settleClaimedJob(claim, "failed", "boom"))).toHaveOkValue(
			"superseded",
		);
	});

	it("settleClaimedJob stays superseded when another claim now owns the row", async () => {
		row.current = claim;
		mockMarkClaimedJobTerminal.mockImplementation(async () => {
			row.current = { ...claim, attempts: claim.attempts + 1 };
			return mockMarkClaimedJobTerminal.mock.calls.length === 1
				? lostResponse()
				: Result.ok("superseded" as const);
		});

		expect(await run(settleClaimedJob(claim, "completed"))).toHaveOkValue(
			"superseded",
		);
	});

	it("startJob reports applied when its first attempt committed", async () => {
		row.current = makeJob({ id: "job-1", status: "pending", attempts: 0 });
		mockMarkJobRunning.mockImplementation(
			casWrite(
				(j) => j.status === "pending",
				(j) => ({ ...j, status: "running", attempts: 1 }),
				{ commitThenLoseResponse: true },
			),
		);

		expect(await run(startJob({ id: "job-1", attempts: 1 }))).toHaveOkValue(
			"applied",
		);
	});

	// Phase runs now stop on a superseded complete/fail, so a false
	// "superseded" here would abandon a phase this run actually settled.
	it("completeJob reports applied when its first attempt committed", async () => {
		row.current = makeJob({ id: "job-1", status: "running", attempts: 1 });
		mockMarkJobCompleted.mockImplementation(
			casWrite(
				(j) => j.status === "running" && j.attempts === 1,
				(j) => ({ ...j, status: "completed" }),
				{ commitThenLoseResponse: true },
			),
		);

		expect(
			await run(completeJob({ id: "job-1", attempts: 1 }, { result: {} })),
		).toHaveOkValue("applied");
	});

	it("failJob reports applied when its first attempt committed", async () => {
		row.current = makeJob({ id: "job-1", status: "running" });
		mockMarkJobFailed.mockImplementation(
			casWrite(
				(j) => j.status === "pending" || j.status === "running",
				(j) => ({ ...j, status: "failed", error: "boom" }),
				{ commitThenLoseResponse: true },
			),
		);

		expect(await run(failJob("job-1", "boom"))).toHaveOkValue("applied");
	});
});
