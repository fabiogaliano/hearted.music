import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markDeadDeckJobs,
	sweepStaleDeckJobs,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import { log } from "@/lib/observability/logger";
import {
	claimExtensionSyncPayloadCleanup,
	markDeadExtensionSyncJobs,
	sweepStaleExtensionSyncJobs,
} from "@/lib/platform/jobs/extension-sync-jobs";
import {
	markDeadLibraryProcessingJobs,
	sweepStaleLibraryProcessingJobs,
} from "@/lib/platform/jobs/library-processing-queue";
import type { Job } from "@/lib/platform/jobs/repository";
import { DatabaseError } from "@/lib/shared/errors/database";
import { deleteOrphanedSyncPayloads } from "@/lib/workflows/extension-sync/payload-cleanup";
import { deleteSyncPayload } from "@/lib/workflows/extension-sync/payload-storage";
import { recoverIdleEnrichmentWorkflows } from "@/lib/workflows/library-processing/idle-recovery";
import {
	recoverDeadLetteredLibraryProcessingJobs,
	recoverTerminalLibraryProcessingRefs,
} from "@/lib/workflows/library-processing/terminal-recovery";
import { makeJob } from "@/test/fixtures";
import { workerConfig } from "../config";
import {
	runSweepTick,
	startIdleEnrichmentRecovery,
	startSweep,
} from "../sweep";

vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@sentry/bun", () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	markDeadDeckJobs: vi.fn(),
	sweepStaleDeckJobs: vi.fn(),
}));
vi.mock("@/lib/platform/jobs/extension-sync-jobs", () => ({
	claimExtensionSyncPayloadCleanup: vi.fn(),
	markDeadExtensionSyncJobs: vi.fn(),
	sweepStaleExtensionSyncJobs: vi.fn(),
}));
vi.mock("@/lib/platform/jobs/library-processing-queue", () => ({
	markDeadLibraryProcessingJobs: vi.fn(),
	sweepStaleLibraryProcessingJobs: vi.fn(),
}));
vi.mock("@/lib/workflows/extension-sync/payload-cleanup", () => ({
	deleteOrphanedSyncPayloads: vi.fn(),
}));
vi.mock("@/lib/workflows/extension-sync/payload-storage", () => ({
	deleteSyncPayload: vi.fn(),
}));
vi.mock("@/lib/workflows/library-processing/idle-recovery", () => ({
	recoverIdleEnrichmentWorkflows: vi.fn(),
}));
vi.mock("@/lib/workflows/library-processing/terminal-recovery", () => ({
	recoverDeadLetteredLibraryProcessingJobs: vi.fn(),
	recoverTerminalLibraryProcessingRefs: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(sweepStaleLibraryProcessingJobs).mockResolvedValue(Result.ok([]));
	vi.mocked(markDeadLibraryProcessingJobs).mockResolvedValue(Result.ok([]));
	vi.mocked(recoverDeadLetteredLibraryProcessingJobs).mockResolvedValue([]);
	vi.mocked(recoverTerminalLibraryProcessingRefs).mockResolvedValue([]);
	vi.mocked(recoverIdleEnrichmentWorkflows).mockResolvedValue([]);
	vi.mocked(sweepStaleExtensionSyncJobs).mockResolvedValue(Result.ok([]));
	vi.mocked(markDeadExtensionSyncJobs).mockResolvedValue(Result.ok([]));
	vi.mocked(deleteOrphanedSyncPayloads).mockResolvedValue(undefined);
	vi.mocked(claimExtensionSyncPayloadCleanup).mockResolvedValue(Result.ok([]));
	vi.mocked(deleteSyncPayload).mockResolvedValue(Result.ok(undefined));
	vi.mocked(sweepStaleDeckJobs).mockResolvedValue(Result.ok([]));
	vi.mocked(markDeadDeckJobs).mockResolvedValue(Result.ok([]));
});

describe("runSweepTick", () => {
	it("calls the library-processing sweep RPCs with the stale threshold", async () => {
		await runSweepTick();

		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledWith(
			workerConfig.staleThreshold,
		);
		expect(markDeadLibraryProcessingJobs).toHaveBeenCalledWith(
			workerConfig.staleThreshold,
		);
	});

	it("H1: deck sweep and mark-dead share one lease so a final-attempt job isn't dead-lettered mid-run", async () => {
		await runSweepTick();

		expect(sweepStaleDeckJobs).toHaveBeenCalledWith(900);
		expect(markDeadDeckJobs).toHaveBeenCalledWith(900);
	});

	it("continues through the sweep RPCs even when earlier ones error", async () => {
		const dbErr = new DatabaseError({ code: "500", message: "fail" });
		vi.mocked(sweepStaleLibraryProcessingJobs).mockResolvedValue(
			Result.err(dbErr),
		);
		vi.mocked(markDeadLibraryProcessingJobs).mockResolvedValue(
			Result.err(dbErr),
		);

		await runSweepTick();

		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalled();
		expect(markDeadLibraryProcessingJobs).toHaveBeenCalled();
	});

	it("calls recovery for dead-lettered library-processing jobs", async () => {
		const deadJobs = [
			makeJob({ id: "d-1", type: "enrichment" }),
			makeJob({ id: "d-2", type: "match_snapshot_refresh" as Job["type"] }),
		];
		vi.mocked(markDeadLibraryProcessingJobs).mockResolvedValue(
			Result.ok(deadJobs),
		);

		await runSweepTick();

		expect(recoverDeadLetteredLibraryProcessingJobs).toHaveBeenCalledWith(
			deadJobs,
		);
	});

	it("does not call recovery when no jobs are dead-lettered", async () => {
		await runSweepTick();

		expect(recoverDeadLetteredLibraryProcessingJobs).not.toHaveBeenCalled();
	});

	it("does not call recovery when dead-letter RPC errors", async () => {
		vi.mocked(markDeadLibraryProcessingJobs).mockResolvedValue(
			Result.err(new DatabaseError({ code: "500", message: "fail" })),
		);

		await runSweepTick();

		expect(recoverDeadLetteredLibraryProcessingJobs).not.toHaveBeenCalled();
	});

	it("calls terminal-ref recovery on every sweep tick", async () => {
		await runSweepTick();

		expect(recoverTerminalLibraryProcessingRefs).toHaveBeenCalledTimes(1);
	});

	it("does not run idle-enrichment recovery on the 60s sweep (it dominated idle API traffic)", async () => {
		await runSweepTick();

		expect(recoverIdleEnrichmentWorkflows).not.toHaveBeenCalled();
	});

	it("does not reject when a recovery step throws unexpectedly", async () => {
		vi.mocked(markDeadLibraryProcessingJobs).mockResolvedValue(
			Result.ok([makeJob({ id: "d-1" })]),
		);
		vi.mocked(recoverDeadLetteredLibraryProcessingJobs).mockRejectedValue(
			new Error("recovery exploded"),
		);

		await expect(runSweepTick()).resolves.toBeUndefined();

		expect(log.error).toHaveBeenCalledWith("sweep-step-threw", {
			step: "recover-dead-letters",
			error: "recovery exploded",
		});
	});

	it("runs later steps even when an earlier step throws", async () => {
		vi.mocked(recoverTerminalLibraryProcessingRefs).mockRejectedValue(
			new Error("terminal recovery exploded"),
		);

		await runSweepTick();

		expect(sweepStaleExtensionSyncJobs).toHaveBeenCalled();
		expect(markDeadExtensionSyncJobs).toHaveBeenCalled();
		expect(sweepStaleDeckJobs).toHaveBeenCalled();
		expect(markDeadDeckJobs).toHaveBeenCalled();
	});

	it("calls deleteSyncPayload for each claimed payload path", async () => {
		vi.mocked(claimExtensionSyncPayloadCleanup).mockResolvedValue(
			Result.ok([
				{ jobId: "j-1", accountId: "acct-1", payloadPath: "acct-1/a.json" },
				{ jobId: "j-2", accountId: "acct-2", payloadPath: "acct-2/b.json" },
			]),
		);

		await runSweepTick();

		expect(deleteSyncPayload).toHaveBeenCalledWith(
			expect.anything(),
			"acct-1/a.json",
		);
		expect(deleteSyncPayload).toHaveBeenCalledWith(
			expect.anything(),
			"acct-2/b.json",
		);
	});

	it("does not call deleteSyncPayload when no payloads are claimed", async () => {
		await runSweepTick();

		expect(deleteSyncPayload).not.toHaveBeenCalled();
	});

	it("runs the payload-cleanup step after the dead-letter step", async () => {
		// The dead-letter step must run before payload-cleanup so dead-lettered rows
		// can be processed by deleteOrphanedSyncPayloads while they still have the
		// payload pointer. Verify ordering by checking call sequence.
		const callOrder: string[] = [];
		const deadJobs = [
			makeJob({
				id: "d-1",
				type: "extension_sync" as Job["type"],
				progress: { payload_path: "p" },
			}),
		];
		vi.mocked(markDeadExtensionSyncJobs).mockImplementation(async () => {
			callOrder.push("mark-dead");
			return Result.ok(deadJobs);
		});
		vi.mocked(deleteOrphanedSyncPayloads).mockImplementation(async () => {
			callOrder.push("delete-orphaned");
		});
		vi.mocked(claimExtensionSyncPayloadCleanup).mockImplementation(async () => {
			callOrder.push("claim-cleanup");
			return Result.ok([]);
		});

		await runSweepTick();

		const markDeadIdx = callOrder.indexOf("mark-dead");
		const deleteOrphanedIdx = callOrder.indexOf("delete-orphaned");
		const claimCleanupIdx = callOrder.indexOf("claim-cleanup");

		expect(markDeadIdx).toBeLessThan(claimCleanupIdx);
		expect(deleteOrphanedIdx).toBeLessThan(claimCleanupIdx);
	});
});

describe("startSweep", () => {
	const interval = workerConfig.sweepIntervalMs;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not start the next tick until the current one settles", async () => {
		let resolveTick = () => {};
		vi.mocked(sweepStaleLibraryProcessingJobs).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTick = () => resolve(Result.ok([]));
				}),
		);

		const { stop } = startSweep();

		await vi.advanceTimersByTimeAsync(interval);
		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(interval * 5);
		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledTimes(1);

		resolveTick();
		await vi.advanceTimersByTimeAsync(interval);
		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledTimes(2);

		stop();
	});

	it("stops scheduling further ticks after stop()", async () => {
		const { stop } = startSweep();

		await vi.advanceTimersByTimeAsync(interval);
		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledTimes(1);

		stop();

		await vi.advanceTimersByTimeAsync(interval * 5);
		expect(sweepStaleLibraryProcessingJobs).toHaveBeenCalledTimes(1);
	});
});

describe("startIdleEnrichmentRecovery", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs on its own interval, not the sweep's", async () => {
		const { stop } = startIdleEnrichmentRecovery();

		await vi.advanceTimersByTimeAsync(
			workerConfig.idleEnrichmentRecoveryIntervalMs - 1,
		);
		expect(recoverIdleEnrichmentWorkflows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(recoverIdleEnrichmentWorkflows).toHaveBeenCalledTimes(1);

		stop();
		await vi.advanceTimersByTimeAsync(
			workerConfig.idleEnrichmentRecoveryIntervalMs * 3,
		);
		expect(recoverIdleEnrichmentWorkflows).toHaveBeenCalledTimes(1);
	});
});
