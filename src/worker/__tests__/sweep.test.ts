import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import type {
	DeadLetterRecoveryResult,
	TerminalRefRecoveryResult,
} from "@/lib/workflows/library-processing/terminal-recovery";
import type {
	LibraryProcessingApplyOutcome,
	LibraryProcessingState,
} from "@/lib/workflows/library-processing/types";
import { runSweepTick, type SweepDeps } from "../sweep";

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
		recoverDeadLetteredLibraryProcessingJobs: vi.fn().mockResolvedValue([]),
		recoverTerminalLibraryProcessingRefs: vi.fn().mockResolvedValue([]),
		sweepStaleWalkthroughPreviewJobs: vi.fn().mockResolvedValue(Result.ok([])),
		markDeadWalkthroughPreviewJobs: vi.fn().mockResolvedValue(Result.ok([])),
		...overrides,
	};
}

function makeState(): LibraryProcessingState {
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
	};
}

function makeApplyOutcome(
	changeKind: LibraryProcessingApplyOutcome["changeKind"],
): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind,
		state: makeState(),
		effects: [],
		effectResults: [],
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

	it("calls recovery for dead-lettered library-processing jobs", async () => {
		const deadJobs = [
			makeJob({ id: "d-1", type: "enrichment" }),
			makeJob({ id: "d-2", type: "match_snapshot_refresh" as Job["type"] }),
		];
		const recoveryResults: DeadLetterRecoveryResult[] = [
			{
				jobId: "d-1",
				accountId: "acct-1",
				jobType: "enrichment",
				outcome: Result.ok(makeApplyOutcome("enrichment_stopped")),
			},
			{
				jobId: "d-2",
				accountId: "acct-1",
				jobType: "match_snapshot_refresh",
				outcome: Result.ok(makeApplyOutcome("match_snapshot_failed")),
			},
		];
		const deps = makeDeps({
			markDeadLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.ok(deadJobs)),
			recoverDeadLetteredLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(recoveryResults),
		});

		await runSweepTick(deps);

		expect(deps.recoverDeadLetteredLibraryProcessingJobs).toHaveBeenCalledWith(
			deadJobs,
		);
		expect(logMod.log.info).toHaveBeenCalledWith("dead-letter-recovered", {
			jobId: "d-1",
			accountId: "acct-1",
			jobType: "enrichment",
		});
		expect(logMod.log.info).toHaveBeenCalledWith("dead-letter-recovered", {
			jobId: "d-2",
			accountId: "acct-1",
			jobType: "match_snapshot_refresh",
		});
	});

	it("logs structured recovery failures without stopping later recoveries", async () => {
		const applyError = {
			kind: "load_state" as const,
			cause: new DatabaseError({ code: "500", message: "db down" }),
		};
		const recoveryResults: DeadLetterRecoveryResult[] = [
			{
				jobId: "d-1",
				accountId: "acct-1",
				jobType: "enrichment",
				outcome: Result.err(applyError),
			},
			{
				jobId: "d-2",
				accountId: "acct-1",
				jobType: "match_snapshot_refresh",
				outcome: Result.ok(makeApplyOutcome("match_snapshot_failed")),
			},
		];
		const deps = makeDeps({
			markDeadLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(
					Result.ok([makeJob({ id: "d-1" }), makeJob({ id: "d-2" })]),
				),
			recoverDeadLetteredLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(recoveryResults),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith(
			"dead-letter-recovery-failed",
			{
				jobId: "d-1",
				accountId: "acct-1",
				jobType: "enrichment",
				error: applyError,
			},
		);
		expect(logMod.log.info).toHaveBeenCalledWith("dead-letter-recovered", {
			jobId: "d-2",
			accountId: "acct-1",
			jobType: "match_snapshot_refresh",
		});
	});

	it("does not call recovery when no jobs are dead-lettered", async () => {
		const deps = makeDeps();
		await runSweepTick(deps);

		expect(
			deps.recoverDeadLetteredLibraryProcessingJobs,
		).not.toHaveBeenCalled();
	});

	it("does not call recovery when dead-letter RPC errors", async () => {
		const dbErr = new DatabaseError({ code: "500", message: "fail" });
		const deps = makeDeps({
			markDeadLibraryProcessingJobs: vi
				.fn()
				.mockResolvedValue(Result.err(dbErr)),
		});

		await runSweepTick(deps);

		expect(
			deps.recoverDeadLetteredLibraryProcessingJobs,
		).not.toHaveBeenCalled();
	});

	it("calls terminal-ref recovery on every sweep tick", async () => {
		const deps = makeDeps();
		await runSweepTick(deps);

		expect(deps.recoverTerminalLibraryProcessingRefs).toHaveBeenCalledTimes(1);
	});

	it("logs successful terminal-ref recoveries", async () => {
		const terminalResults: TerminalRefRecoveryResult[] = [
			{
				jobId: "j-terminal",
				accountId: "acct-1",
				workflow: "enrichment",
				jobStatus: "completed",
				recoveryStrategy: "completed_from_measurement",
				outcome: Result.ok(makeApplyOutcome("enrichment_completed")),
			},
		];
		const deps = makeDeps({
			recoverTerminalLibraryProcessingRefs: vi
				.fn()
				.mockResolvedValue(terminalResults),
		});

		await runSweepTick(deps);

		expect(logMod.log.info).toHaveBeenCalledWith("terminal-ref-recovered", {
			jobId: "j-terminal",
			accountId: "acct-1",
			workflow: "enrichment",
			jobStatus: "completed",
			recoveryStrategy: "completed_from_measurement",
		});
	});

	it("logs failed terminal-ref recoveries", async () => {
		const applyError = {
			kind: "load_state" as const,
			cause: new DatabaseError({ code: "500", message: "db down" }),
		};
		const terminalResults: TerminalRefRecoveryResult[] = [
			{
				jobId: "j-stuck",
				accountId: "acct-1",
				workflow: "match_snapshot_refresh",
				jobStatus: "failed",
				recoveryStrategy: "conservative_failure",
				outcome: Result.err(applyError),
			},
		];
		const deps = makeDeps({
			recoverTerminalLibraryProcessingRefs: vi
				.fn()
				.mockResolvedValue(terminalResults),
		});

		await runSweepTick(deps);

		expect(logMod.log.error).toHaveBeenCalledWith(
			"terminal-ref-recovery-failed",
			{
				jobId: "j-stuck",
				accountId: "acct-1",
				workflow: "match_snapshot_refresh",
				jobStatus: "failed",
				recoveryStrategy: "conservative_failure",
				error: applyError,
			},
		);
	});
});
