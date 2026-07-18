/**
 * batch_run / batch_target repository — the local record and work queue for a
 * durable batch (grants, safe approvals, bounded email). A batch is snapshotted
 * exact at preview: its targets are resolved server-side and written here once,
 * so processing never re-feeds a DB-derived id set back into a Supabase `.in()`
 * URL filter — the runner walks the local snapshot one target at a time.
 *
 * Like action_run, rows are the durable record: `running` targets abandoned by a
 * process exit are reclaimed as `interrupted` on startup (never assumed done),
 * and a batch left `running` becomes `interrupted` so it can be resumed. Progress
 * is computed live from target statuses; the denormalized counts on batch_run are
 * only persisted at finalize for listing and terminal display.
 */

import type { SqliteDriver, SqliteValue } from "./sqlite";

export type BatchStatus =
	| "preview"
	| "running"
	| "succeeded"
	| "failed"
	| "partial"
	| "cancelled"
	| "interrupted";

export type BatchTargetStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped"
	| "cancelled"
	| "interrupted";

export interface BatchRunRow {
	id: string;
	prodRef: string;
	actionType: string;
	status: BatchStatus;
	filter: Record<string, unknown> | null;
	input: Record<string, unknown> | null;
	inputHash: string;
	concurrency: number;
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	cancelled: number;
	createdAt: string;
	committedAt: string | null;
	completedAt: string | null;
	parentRunId: string | null;
}

export interface BatchTargetRow {
	batchId: string;
	ordinal: number;
	targetType: string;
	targetId: string;
	targetLabel: string | null;
	status: BatchTargetStatus;
	skipReason: string | null;
	attempts: number;
	result: Record<string, unknown> | null;
	errorMessage: string | null;
	externalId: string | null;
}

export interface NewBatch {
	id: string;
	prodRef: string;
	actionType: string;
	filter: Record<string, unknown> | null;
	input: Record<string, unknown> | null;
	inputHash: string;
	concurrency: number;
	total: number;
	createdAt: string;
	parentRunId?: string | null;
}

export interface NewBatchTarget {
	ordinal: number;
	targetType: string;
	targetId: string;
	targetLabel: string | null;
	// A target resolved as ineligible is snapshotted `skipped` with its reason so
	// the preview count and the run record agree; the runner never touches it.
	status: Extract<BatchTargetStatus, "pending" | "skipped">;
	skipReason?: string | null;
}

interface BatchRunRecord {
	id: string;
	prod_ref: string;
	action_type: string;
	status: string;
	filter_json: string | null;
	input_json: string | null;
	input_hash: string;
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	cancelled: number;
	concurrency: number;
	created_at: string;
	committed_at: string | null;
	completed_at: string | null;
	parent_run_id: string | null;
}

interface BatchTargetRecord {
	batch_id: string;
	ordinal: number;
	target_type: string;
	target_id: string;
	target_label: string | null;
	status: string;
	skip_reason: string | null;
	attempts: number;
	result_json: string | null;
	error_message: string | null;
	external_id: string | null;
}

function parseObject(value: string | null): Record<string, unknown> | null {
	if (value === null) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function mapBatch(record: BatchRunRecord): BatchRunRow {
	return {
		id: record.id,
		prodRef: record.prod_ref,
		actionType: record.action_type,
		status: record.status as BatchStatus,
		filter: parseObject(record.filter_json),
		input: parseObject(record.input_json),
		inputHash: record.input_hash,
		concurrency: Number(record.concurrency),
		total: Number(record.total),
		succeeded: Number(record.succeeded),
		failed: Number(record.failed),
		skipped: Number(record.skipped),
		cancelled: Number(record.cancelled),
		createdAt: record.created_at,
		committedAt: record.committed_at,
		completedAt: record.completed_at,
		parentRunId: record.parent_run_id,
	};
}

function mapTarget(record: BatchTargetRecord): BatchTargetRow {
	return {
		batchId: record.batch_id,
		ordinal: Number(record.ordinal),
		targetType: record.target_type,
		targetId: record.target_id,
		targetLabel: record.target_label,
		status: record.status as BatchTargetStatus,
		skipReason: record.skip_reason,
		attempts: Number(record.attempts),
		result: parseObject(record.result_json),
		errorMessage: record.error_message,
		externalId: record.external_id,
	};
}

/** Insert the batch header and all of its snapshotted targets in one transaction. */
export function insertBatch(
	db: SqliteDriver,
	batch: NewBatch,
	targets: readonly NewBatchTarget[],
): void {
	db.exec("begin");
	try {
		const skipped = targets.filter((t) => t.status === "skipped").length;
		db.run(
			`insert into batch_run (
				id, prod_ref, action_type, status, filter_json, input_json, input_hash,
				total, succeeded, failed, skipped, cancelled, concurrency, created_at,
				parent_run_id
			) values (?, ?, ?, 'preview', ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?)`,
			[
				batch.id,
				batch.prodRef,
				batch.actionType,
				batch.filter === null ? null : JSON.stringify(batch.filter),
				batch.input === null ? null : JSON.stringify(batch.input),
				batch.inputHash,
				batch.total,
				skipped,
				batch.concurrency,
				batch.createdAt,
				batch.parentRunId ?? null,
			],
		);
		for (const target of targets) {
			db.run(
				`insert into batch_target (
					batch_id, ordinal, target_type, target_id, target_label, status,
					skip_reason, attempts
				) values (?, ?, ?, ?, ?, ?, ?, 0)`,
				[
					batch.id,
					target.ordinal,
					target.targetType,
					target.targetId,
					target.targetLabel,
					target.status,
					target.skipReason ?? null,
				],
			);
		}
		db.exec("commit");
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
}

export function getBatch(db: SqliteDriver, id: string): BatchRunRow | null {
	const record = db.get<BatchRunRecord>(
		"select * from batch_run where id = ?",
		[id],
	);
	return record ? mapBatch(record) : null;
}

export function getTargets(db: SqliteDriver, id: string): BatchTargetRow[] {
	return db
		.all<BatchTargetRecord>(
			"select * from batch_target where batch_id = ? order by ordinal asc",
			[id],
		)
		.map(mapTarget);
}

export type BatchProgress = Record<BatchTargetStatus, number>;

/** Live per-status counts computed from the target rows. */
export function batchProgress(db: SqliteDriver, id: string): BatchProgress {
	const rows = db.all<{ status: string; count: number }>(
		"select status, count(*) as count from batch_target where batch_id = ? group by status",
		[id],
	);
	const progress: BatchProgress = {
		pending: 0,
		running: 0,
		succeeded: 0,
		failed: 0,
		skipped: 0,
		cancelled: 0,
		interrupted: 0,
	};
	for (const row of rows) {
		progress[row.status as BatchTargetStatus] = Number(row.count);
	}
	return progress;
}

export function setBatchStatus(
	db: SqliteDriver,
	id: string,
	status: BatchStatus,
	patch: { committedAt?: string; completedAt?: string } = {},
): void {
	const sets: string[] = ["status = ?"];
	const params: SqliteValue[] = [status];
	if (patch.committedAt !== undefined) {
		sets.push("committed_at = ?");
		params.push(patch.committedAt);
	}
	if (patch.completedAt !== undefined) {
		sets.push("completed_at = ?");
		params.push(patch.completedAt);
	}
	params.push(id);
	db.run(`update batch_run set ${sets.join(", ")} where id = ?`, params);
}

/** Persist the denormalized counts + terminal status once a run settles. */
export function finalizeBatch(
	db: SqliteDriver,
	id: string,
	status: BatchStatus,
	completedAt: string,
): void {
	const progress = batchProgress(db, id);
	db.run(
		`update batch_run set
			status = ?, succeeded = ?, failed = ?, skipped = ?, cancelled = ?,
			completed_at = ?
		 where id = ?`,
		[
			status,
			progress.succeeded,
			progress.failed,
			progress.skipped,
			progress.cancelled,
			completedAt,
			id,
		],
	);
}

export function markTargetRunning(
	db: SqliteDriver,
	id: string,
	ordinal: number,
): void {
	db.run(
		"update batch_target set status = 'running', attempts = attempts + 1 where batch_id = ? and ordinal = ?",
		[id, ordinal],
	);
}

export interface TargetOutcome {
	status: Extract<BatchTargetStatus, "succeeded" | "failed" | "skipped">;
	result?: Record<string, unknown> | null;
	errorMessage?: string | null;
	externalId?: string | null;
}

export function recordTargetOutcome(
	db: SqliteDriver,
	id: string,
	ordinal: number,
	outcome: TargetOutcome,
): void {
	db.run(
		`update batch_target set
			status = ?, result_json = ?, error_message = ?, external_id = ?
		 where batch_id = ? and ordinal = ?`,
		[
			outcome.status,
			outcome.result === undefined || outcome.result === null
				? null
				: JSON.stringify(outcome.result),
			outcome.errorMessage ?? null,
			outcome.externalId ?? null,
			id,
			ordinal,
		],
	);
}

/**
 * The targets a fresh commit or a resume should process: still `pending` or
 * `interrupted`, and never a row that already carries an external id (a Resend
 * send that landed must never be repeated). Ordered so processing is stable.
 */
export function resumableTargets(
	db: SqliteDriver,
	id: string,
): BatchTargetRow[] {
	return db
		.all<BatchTargetRecord>(
			`select * from batch_target
			 where batch_id = ? and status in ('pending', 'interrupted')
			   and external_id is null
			 order by ordinal asc`,
			[id],
		)
		.map(mapTarget);
}

/**
 * Re-queue failed targets in place for a retry. Rows that returned an external id
 * are never reset. Returns how many were re-queued so an empty retry is a no-op.
 */
export function requeueFailedTargets(db: SqliteDriver, id: string): number {
	return db.run(
		`update batch_target set status = 'pending', error_message = null
		 where batch_id = ? and status = 'failed' and external_id is null`,
		[id],
	).changes;
}

/** Cancel affects only work not yet started. */
export function cancelPendingTargets(db: SqliteDriver, id: string): number {
	return db.run(
		"update batch_target set status = 'cancelled' where batch_id = ? and status in ('pending', 'interrupted')",
		[id],
	).changes;
}

/**
 * On startup, reclaim committed work abandoned by a process exit. An uncommitted
 * preview is never safe to resume, so discard it rather than exposing a Resume
 * action that could bypass commit-time safeguards.
 */
export function markStaleBatchesInterrupted(
	db: SqliteDriver,
	nowIso: string = new Date().toISOString(),
): number {
	db.exec("begin");
	try {
		db.run(
			"update batch_target set status = 'interrupted' where status = 'running'",
		);
		const uncommitted = db.all<{ id: string }>(
			`select id from batch_run
			 where status = 'preview'
			    or (status = 'interrupted' and committed_at is null)`,
		);
		for (const { id } of uncommitted) {
			cancelPendingTargets(db, id);
			finalizeBatch(db, id, "cancelled", nowIso);
		}
		const interrupted = db.run(
			"update batch_run set status = 'interrupted' where status = 'running'",
		).changes;
		db.exec("commit");
		return interrupted + uncommitted.length;
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
}

export interface BatchListRow {
	id: string;
	actionType: string;
	status: BatchStatus;
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	createdAt: string;
	completedAt: string | null;
}

/** Batches that are not in a terminal state — drives the persistent progress UI. */
export function listActiveBatches(db: SqliteDriver): BatchListRow[] {
	return db
		.all<BatchRunRecord>(
			`select * from batch_run
			 where status in ('preview', 'running', 'interrupted')
			 order by created_at desc`,
		)
		.map((record) => {
			const row = mapBatch(record);
			return {
				id: row.id,
				actionType: row.actionType,
				status: row.status,
				total: row.total,
				succeeded: row.succeeded,
				failed: row.failed,
				skipped: row.skipped,
				createdAt: row.createdAt,
				completedAt: row.completedAt,
			};
		});
}
