import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prodRef: () => "test-ref" }));

// The real adapters import @/ helpers + the prod connection; the runner contract
// is what we test here, so we drive it with a controllable fake registry.
const adapterState = vi.hoisted(() => {
	interface FakeTarget {
		targetType: string;
		targetId: string;
		targetLabel: string | null;
		eligible: boolean;
		skipReason?: string | null;
	}
	interface FakeAdapter {
		actionType: string;
		targetType: string;
		concurrency: number;
		maxTargets: number;
		label: string;
		resolve: (input: Record<string, unknown>) => Promise<{
			targets: FakeTarget[];
			warnings: string[];
			summary: Record<string, number>;
			estimatedActions: number;
		}>;
		process: (
			target: { targetId: string; targetLabel: string | null },
			input: Record<string, unknown>,
		) => Promise<{ result: Record<string, unknown>; externalId?: string | null }>;
	}
	return { adapters: new Map<string, FakeAdapter>() };
});

vi.mock("../batch-adapters", () => ({
	getBatchAdapter: (actionType: string) =>
		adapterState.adapters.get(actionType) ?? null,
}));

import {
	batchProgress,
	cancelPendingTargets,
	finalizeBatch,
	getBatch,
	getTargets,
	insertBatch,
	markStaleBatchesInterrupted,
	markTargetRunning,
	recordTargetOutcome,
	requeueFailedTargets,
	resumableTargets,
	setBatchStatus,
} from "../local-store/batches";
import { applyMigrations } from "../local-store/migrations";
import { openSqlite, type SqliteDriver } from "../local-store/sqlite";
import {
	getLocalStore,
	initLocalStore,
	resetLocalStoreForTests,
} from "../local-store/store";
import {
	cancelBatch,
	commitBatch,
	getBatchView,
	previewBatch,
	resumeBatch,
	retryFailedBatch,
} from "../batches";

describe("batch repository", () => {
	let db: SqliteDriver;

	beforeEach(async () => {
		db = await openSqlite(":memory:");
		applyMigrations(db);
	});

	afterEach(() => db.close());

	function seed() {
		insertBatch(
			db,
			{
				id: "b1",
				prodRef: "test-ref",
				actionType: "grant-batch",
				filter: null,
				input: { limit: 500 },
				inputHash: "h",
				concurrency: 2,
				total: 2,
				createdAt: "2026-07-15T10:00:00.000Z",
			},
			[
				{ ordinal: 0, targetType: "account", targetId: "a", targetLabel: "A", status: "pending" },
				{ ordinal: 1, targetType: "account", targetId: "b", targetLabel: "B", status: "pending" },
				{ ordinal: 2, targetType: "account", targetId: "c", targetLabel: "C", status: "skipped", skipReason: "Already granted" },
			],
		);
	}

	it("snapshots targets and computes live progress", () => {
		seed();
		expect(getBatch(db, "b1")?.total).toBe(2);
		expect(getBatch(db, "b1")?.skipped).toBe(1);
		expect(batchProgress(db, "b1")).toMatchObject({ pending: 2, skipped: 1 });
		expect(getTargets(db, "b1")).toHaveLength(3);
	});

	it("only resumes pending/interrupted targets without an external id", () => {
		seed();
		markTargetRunning(db, "b1", 0);
		recordTargetOutcome(db, "b1", 0, {
			status: "succeeded",
			externalId: "resend-1",
		});
		// A crash leaves target 1 running → interrupted.
		markTargetRunning(db, "b1", 1);
		markStaleBatchesInterrupted(db);
		const resumable = resumableTargets(db, "b1");
		expect(resumable.map((t) => t.ordinal)).toEqual([1]);
	});

	it("requeues only failed targets without an external id", () => {
		seed();
		recordTargetOutcome(db, "b1", 0, { status: "failed", errorMessage: "boom" });
		recordTargetOutcome(db, "b1", 1, {
			status: "failed",
			errorMessage: "sent then failed",
			externalId: "resend-2",
		});
		expect(requeueFailedTargets(db, "b1")).toBe(1);
		expect(getTargets(db, "b1")[0]?.status).toBe("pending");
		expect(getTargets(db, "b1")[1]?.status).toBe("failed");
	});

	it("cancel affects only unstarted targets", () => {
		seed();
		recordTargetOutcome(db, "b1", 0, { status: "succeeded" });
		expect(cancelPendingTargets(db, "b1")).toBe(1);
		expect(getTargets(db, "b1")[1]?.status).toBe("cancelled");
		expect(getTargets(db, "b1")[0]?.status).toBe("succeeded");
	});

	it("finalize persists counts and status", () => {
		seed();
		recordTargetOutcome(db, "b1", 0, { status: "succeeded" });
		recordTargetOutcome(db, "b1", 1, { status: "failed", errorMessage: "x" });
		setBatchStatus(db, "b1", "running");
		finalizeBatch(db, "b1", "partial", "2026-07-15T10:05:00.000Z");
		const batch = getBatch(db, "b1");
		expect(batch?.status).toBe("partial");
		expect(batch?.succeeded).toBe(1);
		expect(batch?.failed).toBe(1);
		expect(batch?.skipped).toBe(1);
	});
});

describe("batch orchestration", () => {
	let dir: string;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "cp-batch-"));
		await initLocalStore(join(dir, "batch.sqlite"));
		adapterState.adapters.clear();
	});

	afterEach(() => {
		resetLocalStoreForTests();
		rmSync(dir, { recursive: true, force: true });
	});

	function registerFake(
		overrides: Partial<{
			concurrency: number;
			maxTargets: number;
			resolve: (input: Record<string, unknown>) => Promise<{
				targets: {
					targetType: string;
					targetId: string;
					targetLabel: string | null;
					eligible: boolean;
					skipReason?: string | null;
				}[];
				warnings: string[];
				summary: Record<string, number>;
				estimatedActions: number;
			}>;
			process: (
				t: { targetId: string; targetLabel: string | null },
				input: Record<string, unknown>,
			) => Promise<{ result: Record<string, unknown>; externalId?: string | null }>;
			actionType: string;
		}> = {},
	) {
		const actionType = overrides.actionType ?? "grant-batch";
		adapterState.adapters.set(actionType, {
			actionType,
			targetType: "account",
			concurrency: overrides.concurrency ?? 2,
			maxTargets: overrides.maxTargets ?? 100,
			label: "Fake",
			resolve:
				overrides.resolve ??
				(async () => ({
					targets: [
						{ targetType: "account", targetId: "a", targetLabel: "A", eligible: true },
						{ targetType: "account", targetId: "b", targetLabel: "B", eligible: true },
						{ targetType: "account", targetId: "c", targetLabel: "C", eligible: false, skipReason: "Already granted" },
					],
					warnings: ["heads up"],
					summary: { eligible: 2 },
					estimatedActions: 2,
				})),
			process:
				overrides.process ??
				(async (t) => ({ result: { ok: true, id: t.targetId } })),
		});
	}

	it("previews eligible + skipped and returns first labels", async () => {
		registerFake();
		const preview = await previewBatch("grant-batch", { limit: 500 });
		expect(preview.eligible).toBe(2);
		expect(preview.skipped).toBe(1);
		expect(preview.warnings).toEqual(["heads up"]);
		expect(preview.targetsPreview.map((t) => t.targetId)).toEqual(["a", "b"]);
		expect(preview.skippedReasons).toEqual([
			{ reason: "Already granted", count: 1 },
		]);
	});

	it("refuses a cohort above the cap with 422", async () => {
		registerFake({ maxTargets: 1 });
		await expect(previewBatch("grant-batch", {})).rejects.toMatchObject({
			status: 422,
		});
	});

	it("commits and runs every eligible target to success", async () => {
		registerFake();
		const preview = await previewBatch("grant-batch", { limit: 500 });
		commitBatch(preview.batchId, {});
		await vi.waitFor(() => {
			expect(getBatchView(preview.batchId).batch?.status).toBe("succeeded");
		});
		const view = getBatchView(preview.batchId);
		expect(view.progress).toMatchObject({ succeeded: 2, skipped: 1 });
	});

	it("marks a mixed run partial", async () => {
		registerFake({
			process: async (t) => {
				if (t.targetId === "b") throw new Error("nope");
				return { result: { ok: true } };
			},
		});
		const preview = await previewBatch("grant-batch", {});
		commitBatch(preview.batchId, {});
		await vi.waitFor(() => {
			expect(getBatchView(preview.batchId).batch?.status).toBe("partial");
		});
		expect(getBatchView(preview.batchId).progress).toMatchObject({
			succeeded: 1,
			failed: 1,
		});
	});

	it("refuses to commit an empty batch", async () => {
		registerFake({
			resolve: async () => ({
				targets: [
					{ targetType: "account", targetId: "a", targetLabel: "A", eligible: false, skipReason: "Already granted" },
				],
				warnings: [],
				summary: { eligible: 0 },
				estimatedActions: 0,
			}),
		});
		const preview = await previewBatch("grant-batch", {});
		expect(() => commitBatch(preview.batchId, {})).toThrow(/no eligible/i);
	});

	it("retries only failed targets and can then succeed", async () => {
		let failB = true;
		registerFake({
			process: async (t) => {
				if (t.targetId === "b" && failB) throw new Error("transient");
				return { result: { ok: true } };
			},
		});
		const preview = await previewBatch("grant-batch", {});
		commitBatch(preview.batchId, {});
		await vi.waitFor(() =>
			expect(getBatchView(preview.batchId).batch?.status).toBe("partial"),
		);
		failB = false;
		retryFailedBatch(preview.batchId);
		await vi.waitFor(() =>
			expect(getBatchView(preview.batchId).batch?.status).toBe("succeeded"),
		);
		expect(getBatchView(preview.batchId).progress.succeeded).toBe(2);
	});

	it("reclaims interrupted targets and resumes them", async () => {
		registerFake();
		const preview = await previewBatch("grant-batch", {});
		// Simulate a crash mid-run: commit set-up by hand so no runner completes.
		const db = getLocalStore();
		setBatchStatus(db, preview.batchId, "running", {
			committedAt: new Date().toISOString(),
		});
		markTargetRunning(db, preview.batchId, 0);
		markStaleBatchesInterrupted(db);
		expect(getBatch(db, preview.batchId)?.status).toBe("interrupted");
		resumeBatch(preview.batchId);
		await vi.waitFor(() =>
			expect(getBatchView(preview.batchId).batch?.status).toBe("succeeded"),
		);
		expect(getBatchView(preview.batchId).progress.succeeded).toBe(2);
	});

	it("cancels an uncommitted preview", async () => {
		registerFake();
		const preview = await previewBatch("grant-batch", {});
		cancelBatch(preview.batchId);
		expect(getBatchView(preview.batchId).batch?.status).toBe("cancelled");
	});

	it("gates email commit on a matching test-send hash", async () => {
		registerFake({ actionType: "email-batch" });
		const preview = await previewBatch("email-batch", { body: "hello team" });
		expect(() => commitBatch(preview.batchId, {})).toThrow(/test/i);
		const goodHash = createHash("sha256").update("hello team", "utf8").digest("hex");
		commitBatch(preview.batchId, { testedBodyHash: goodHash });
		await vi.waitFor(() =>
			expect(getBatchView(preview.batchId).batch?.status).toBe("succeeded"),
		);
	});
});
