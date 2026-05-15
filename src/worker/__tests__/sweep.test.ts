import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/data/jobs";
import { DatabaseError } from "@/lib/shared/errors/database";
import { type SweepDeps, runSweepTick } from "../sweep";

vi.mock("../logger", () => ({
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

function makeJob(overrides: Partial<Job> = {}): Job {
	return {
		id: overrides.id ?? "job-1",
		account_id: "acct-1",
		type: "enrichment",
		status: "pending",
		attempts: 0,
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

function makeDeps(overrides: Partial<SweepDeps> = {}): SweepDeps {
	return {
		staleThreshold: "5 minutes",
		sweepStaleLibraryProcessingJobs: vi.fn().mockResolvedValue(Result.ok([])),
		markDeadLibraryProcessingJobs: vi.fn().mockResolvedValue(Result.ok([])),
		sweepStaleWalkthroughPreviewJobs: vi.fn().mockResolvedValue(Result.ok([])),
		markDeadWalkthroughPreviewJobs: vi.fn().mockResolvedValue(Result.ok([])),
		...overrides,
	};
}

describe("runSweepTick", () => {
	let logMod: typeof import("../logger");

	beforeEach(async () => {
		vi.clearAllMocks();
		logMod = await import("../logger");
	});

	it("calls all four RPCs with the stale threshold", async () => {
		const deps = makeDeps();
		await runSweepTick(deps);

		expect(deps.sweepStaleLibraryProcessingJobs).toHaveBeenCalledWith(
			"5 minutes",
		);
		expect(deps.markDeadLibraryProcessingJobs).toHaveBeenCalledWith(
			"5 minutes",
		);
		expect(deps.sweepStaleWalkthroughPreviewJobs).toHaveBeenCalledWith(
			"5 minutes",
		);
		expect(deps.markDeadWalkthroughPreviewJobs).toHaveBeenCalledWith(
			"5 minutes",
		);
	});

	it("logs swept library-processing jobs", async () => {
		const jobs = [makeJob({ id: "j-1" }), makeJob({ id: "j-2" })];
		const deps = makeDeps({
			sweepStaleLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.ok(jobs)),
		});

		await runSweepTick(deps);

		expect(logMod.log.info).toHaveBeenCalledWith("swept-stale-jobs", {
			count: 2,
			jobIds: ["j-1", "j-2"],
		});
	});

	it("logs dead-lettered library-processing jobs as warnings", async () => {
		const jobs = [makeJob({ id: "d-1" })];
		const deps = makeDeps({
			markDeadLibraryProcessingJobs: vi.fn().mockResolvedValue(Result.ok(jobs)),
		});

		await runSweepTick(deps);

		expect(logMod.log.warn).toHaveBeenCalledWith("dead-lettered-jobs", {
			count: 1,
			jobIds: ["d-1"],
		});
	});

	it("logs swept walkthrough preview jobs", async () => {
		const jobs = [
			makeJob({
				id: "p-1",
				type: "walkthrough_match_preview" as Job["type"],
			}),
		];
		const deps = makeDeps({
			sweepStaleWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.ok(jobs)),
		});

		await runSweepTick(deps);

		expect(logMod.log.info).toHaveBeenCalledWith("swept-stale-preview-jobs", {
			count: 1,
			jobIds: ["p-1"],
		});
	});

	it("logs dead-lettered walkthrough preview jobs as warnings", async () => {
		const jobs = [makeJob({ id: "dp-1" })];
		const deps = makeDeps({
			markDeadWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.ok(jobs)),
		});

		await runSweepTick(deps);

		expect(logMod.log.warn).toHaveBeenCalledWith("dead-lettered-preview-jobs", {
			count: 1,
			jobIds: ["dp-1"],
		});
	});

	it("does not log when no jobs are swept or dead-lettered", async () => {
		const deps = makeDeps();
		await runSweepTick(deps);

		expect(logMod.log.info).not.toHaveBeenCalled();
		expect(logMod.log.warn).not.toHaveBeenCalled();
		expect(logMod.log.error).not.toHaveBeenCalled();
	});

	it("logs errors from sweep RPC without throwing", async () => {
		const dbErr = new DatabaseError({
			code: "42P01",
			message: "relation not found",
		});
		const deps = makeDeps({
			sweepStaleLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith("sweep-error", {
			error: "relation not found",
		});
	});

	it("logs errors from dead-letter RPC without throwing", async () => {
		const dbErr = new DatabaseError({
			code: "42P01",
			message: "rpc failed",
		});
		const deps = makeDeps({
			markDeadLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith("dead-letter-error", {
			error: "rpc failed",
		});
	});

	it("logs errors from preview sweep RPC without throwing", async () => {
		const dbErr = new DatabaseError({
			code: "500",
			message: "preview sweep rpc failed",
		});
		const deps = makeDeps({
			sweepStaleWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith("preview-sweep-error", {
			error: "preview sweep rpc failed",
		});
	});

	it("logs errors from preview dead-letter RPC without throwing", async () => {
		const dbErr = new DatabaseError({
			code: "500",
			message: "preview dead-letter rpc failed",
		});
		const deps = makeDeps({
			markDeadWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith("preview-dead-letter-error", {
			error: "preview dead-letter rpc failed",
		});
	});

	it("continues through all four RPCs even when earlier ones error", async () => {
		const dbErr = new DatabaseError({ code: "500", message: "fail" });
		const deps = makeDeps({
			sweepStaleLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
			markDeadLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
			sweepStaleWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
			markDeadWalkthroughPreviewJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(deps.sweepStaleLibraryProcessingJobs).toHaveBeenCalled();
		expect(deps.markDeadLibraryProcessingJobs).toHaveBeenCalled();
		expect(deps.sweepStaleWalkthroughPreviewJobs).toHaveBeenCalled();
		expect(deps.markDeadWalkthroughPreviewJobs).toHaveBeenCalled();
		expect(logMod.log.error).toHaveBeenCalledTimes(4);
	});
});
