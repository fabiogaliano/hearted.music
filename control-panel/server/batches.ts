/**
 * Batch orchestration — preview, commit, and the durable local runner.
 *
 * Preview resolves the exact cohort server-side and snapshots every target into
 * local SQLite (see ./batch-adapters.ts + local-store/batches.ts). Commit gates
 * on the stored snapshot (empty batches and non-preview states refuse) and then
 * processes targets asynchronously with the adapter's bounded concurrency; the
 * HTTP response returns immediately while the run continues in this local
 * process. Progress is polled from the target rows.
 *
 * Durability: the batch_run / batch_target rows ARE the record, written before
 * any prod call, so a write can never run without a local trace. A process exit
 * leaves rows `interrupted` (reclaimed on startup); Resume re-queues only what is
 * still safe (never a row that already carries an external id), and succeeded
 * targets are never repeated.
 */

import { createHash } from "node:crypto";
import { prodRef } from "./db";
import { HttpError } from "./http-error";
import { getBatchAdapter } from "./batch-adapters";
import {
	batchProgress,
	type BatchStatus,
	cancelPendingTargets,
	finalizeBatch,
	getBatch,
	getTargets,
	insertBatch,
	markTargetRunning,
	type NewBatchTarget,
	recordTargetOutcome,
	requeueFailedTargets,
	resumableTargets,
	setBatchStatus,
} from "./local-store/batches";
import { getLocalStore, isLocalStoreReady } from "./local-store/store";
import type { SqliteDriver } from "./local-store/sqlite";

// Runners hold the SQLite driver for a batch already in flight; a second commit /
// resume / retry for the same batch is refused rather than double-processing.
const activeRunners = new Set<string>();
// Cancellation is checked between targets; cancelPendingTargets flips the rows in
// SQLite, this stops the in-flight pool from starting any it already snapshotted.
const cancelled = new Set<string>();

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	return `{${entries
		.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
		.join(",")}}`;
}

function hashInput(input: Record<string, unknown>): string {
	return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function requireStore(): SqliteDriver {
	if (!isLocalStoreReady()) {
		throw new HttpError(
			503,
			"Local batch history is unavailable; refusing to mutate production.",
		);
	}
	return getLocalStore();
}

export interface BatchPreviewResponse {
	batchId: string;
	actionType: string;
	total: number;
	eligible: number;
	skipped: number;
	summary: Record<string, number>;
	warnings: string[];
	estimatedActions: number;
	// First 100 eligible target labels for inspection.
	targetsPreview: { targetId: string; label: string | null }[];
	skippedReasons: { reason: string; count: number }[];
}

export async function previewBatch(
	actionType: string,
	input: Record<string, unknown>,
): Promise<BatchPreviewResponse> {
	const adapter = getBatchAdapter(actionType);
	if (!adapter) throw new HttpError(404, `Unknown batch action: ${actionType}`);
	const db = requireStore();

	const resolution = await adapter.resolve(input);
	const eligible = resolution.targets.filter((t) => t.eligible);
	if (eligible.length > adapter.maxTargets) {
		throw new HttpError(
			422,
			`${eligible.length} eligible targets exceeds the ${adapter.maxTargets} cap for ${adapter.label}. Narrow the selection and try again.`,
		);
	}

	const batchId = crypto.randomUUID();
	const snapshot: NewBatchTarget[] = resolution.targets.map((t, index) => ({
		ordinal: index,
		targetType: t.targetType,
		targetId: t.targetId,
		targetLabel: t.targetLabel,
		status: t.eligible ? "pending" : "skipped",
		skipReason: t.eligible ? null : (t.skipReason ?? "Ineligible"),
	}));
	insertBatch(
		db,
		{
			id: batchId,
			prodRef: prodRef(),
			actionType,
			filter: (input.filter as Record<string, unknown>) ?? null,
			input,
			inputHash: hashInput(input),
			concurrency: adapter.concurrency,
			total: eligible.length,
			createdAt: new Date().toISOString(),
		},
		snapshot,
	);

	const skippedReasons = new Map<string, number>();
	for (const t of resolution.targets) {
		if (t.eligible) continue;
		const reason = t.skipReason ?? "Ineligible";
		skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
	}

	return {
		batchId,
		actionType,
		total: eligible.length,
		eligible: eligible.length,
		skipped: resolution.targets.length - eligible.length,
		summary: resolution.summary,
		warnings: resolution.warnings,
		estimatedActions: resolution.estimatedActions,
		targetsPreview: eligible.slice(0, 100).map((t) => ({
			targetId: t.targetId,
			label: t.targetLabel,
		})),
		skippedReasons: [...skippedReasons.entries()].map(([reason, count]) => ({
			reason,
			count,
		})),
	};
}

function deriveTerminalStatus(db: SqliteDriver, id: string): BatchStatus {
	const p = batchProgress(db, id);
	const hasFail = p.failed > 0;
	const hasCancel = p.cancelled > 0;
	const hasSucc = p.succeeded > 0;
	if (hasFail && hasSucc) return "partial";
	if (hasFail) return "failed";
	if (hasCancel && !hasSucc) return "cancelled";
	if (hasCancel && hasSucc) return "partial";
	return "succeeded";
}

async function processPool<T>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const runNext = async (): Promise<void> => {
		while (cursor < items.length) {
			const item = items[cursor++]!;
			await worker(item);
		}
	};
	const lanes = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: lanes }, runNext));
}

// Fire-and-forget the runner; it owns its own error boundary so an unexpected
// throw still finalizes the batch instead of leaving it stuck `running`.
function startRunner(db: SqliteDriver, batchId: string): void {
	activeRunners.add(batchId);
	void runBatch(db, batchId).finally(() => {
		activeRunners.delete(batchId);
		cancelled.delete(batchId);
	});
}

async function runBatch(db: SqliteDriver, batchId: string): Promise<void> {
	const batch = getBatch(db, batchId);
	if (!batch) return;
	const adapter = getBatchAdapter(batch.actionType);
	if (!adapter) return;
	const input = batch.input ?? {};
	const targets = resumableTargets(db, batchId);

	try {
		await processPool(targets, adapter.concurrency, async (target) => {
			if (cancelled.has(batchId)) return;
			markTargetRunning(db, batchId, target.ordinal);
			try {
				const outcome = await adapter.process(
					{ targetId: target.targetId, targetLabel: target.targetLabel },
					input,
				);
				recordTargetOutcome(db, batchId, target.ordinal, {
					status: "succeeded",
					result: outcome.result,
					externalId: outcome.externalId ?? null,
				});
			} catch (error) {
				recordTargetOutcome(db, batchId, target.ordinal, {
					status: "failed",
					errorMessage:
						error instanceof Error ? error.message : String(error),
				});
			}
		});
	} finally {
		finalizeBatch(
			db,
			batchId,
			deriveTerminalStatus(db, batchId),
			new Date().toISOString(),
		);
	}
}

/** Email's mandatory test-send gate: commit is refused unless a successful test
 * was sent for the batch's current draft (same body hash). */
function emailTestGate(
	batch: NonNullable<ReturnType<typeof getBatch>>,
	testedBodyHash: string | null,
): void {
	const body =
		typeof batch.input?.body === "string" ? (batch.input.body as string) : "";
	const expected = createHash("sha256").update(body, "utf8").digest("hex");
	if (testedBodyHash !== expected) {
		throw new HttpError(
			409,
			"Send a successful test to yourself after your latest draft change before sending the batch.",
		);
	}
}

export interface CommitBody {
	testedBodyHash?: string | null;
}

export function commitBatch(batchId: string, body: CommitBody): BatchView {
	const db = requireStore();
	const batch = getBatch(db, batchId);
	if (!batch) throw new HttpError(404, "Batch not found.");
	if (batch.prodRef !== prodRef()) {
		throw new HttpError(
			409,
			"Batch was previewed against a different production project — preview again.",
		);
	}
	if (batch.status !== "preview") {
		throw new HttpError(409, `Batch is already ${batch.status}; cannot commit.`);
	}
	if (batch.total === 0) {
		throw new HttpError(409, "Batch has no eligible targets to commit.");
	}
	if (activeRunners.has(batchId)) {
		throw new HttpError(409, "Batch is already running.");
	}
	if (batch.actionType === "email-batch") {
		emailTestGate(batch, body.testedBodyHash ?? null);
	}

	setBatchStatus(db, batchId, "running", {
		committedAt: new Date().toISOString(),
	});
	startRunner(db, batchId);
	return viewBatch(db, batchId);
}

export function resumeBatch(batchId: string): BatchView {
	const db = requireStore();
	const batch = getBatch(db, batchId);
	if (!batch) throw new HttpError(404, "Batch not found.");
	if (activeRunners.has(batchId)) {
		throw new HttpError(409, "Batch is already running.");
	}
	if (batch.status !== "interrupted") {
		throw new HttpError(409, `Batch is ${batch.status}; nothing to resume.`);
	}
	if (resumableTargets(db, batchId).length === 0) {
		// Nothing safe to re-run; settle it to its terminal status.
		finalizeBatch(
			db,
			batchId,
			deriveTerminalStatus(db, batchId),
			new Date().toISOString(),
		);
		return viewBatch(db, batchId);
	}
	setBatchStatus(db, batchId, "running");
	startRunner(db, batchId);
	return viewBatch(db, batchId);
}

export function retryFailedBatch(batchId: string): BatchView {
	const db = requireStore();
	const batch = getBatch(db, batchId);
	if (!batch) throw new HttpError(404, "Batch not found.");
	if (activeRunners.has(batchId)) {
		throw new HttpError(409, "Batch is already running.");
	}
	const requeued = requeueFailedTargets(db, batchId);
	if (requeued === 0) {
		throw new HttpError(409, "No retryable failed targets.");
	}
	setBatchStatus(db, batchId, "running");
	startRunner(db, batchId);
	return viewBatch(db, batchId);
}

export function cancelBatch(batchId: string): BatchView {
	const db = requireStore();
	const batch = getBatch(db, batchId);
	if (!batch) throw new HttpError(404, "Batch not found.");
	cancelled.add(batchId);
	cancelPendingTargets(db, batchId);
	// If no runner is in flight (e.g. a preview never committed, or already
	// settled), record the terminal state now so it leaves the active list.
	if (!activeRunners.has(batchId)) {
		finalizeBatch(
			db,
			batchId,
			deriveTerminalStatus(db, batchId),
			new Date().toISOString(),
		);
		cancelled.delete(batchId);
	}
	return viewBatch(db, batchId);
}

export interface BatchView {
	batch: ReturnType<typeof getBatch>;
	progress: ReturnType<typeof batchProgress>;
	targets: ReturnType<typeof getTargets>;
}

function viewBatch(db: SqliteDriver, batchId: string): BatchView {
	return {
		batch: getBatch(db, batchId),
		progress: batchProgress(db, batchId),
		targets: getTargets(db, batchId),
	};
}

export function getBatchView(batchId: string): BatchView {
	const db = requireStore();
	const view = viewBatch(db, batchId);
	if (!view.batch) throw new HttpError(404, "Batch not found.");
	return view;
}
