/**
 * action_run repository — the local record of every mutating operation the panel
 * runs against production. A run is written as `started` before the prod call and
 * updated to its outcome after (see ./record.ts). Stale `started` rows left by a
 * process exit are reclassified `interrupted` on startup — never assumed failed
 * or safe to retry, because we cannot know whether the prod write landed.
 */

import type { SqliteDriver, SqliteValue } from "./sqlite";

export type ActionRunMode = "dry_run" | "commit";
export type ActionRunStatus =
	| "started"
	| "succeeded"
	| "failed"
	| "partial"
	| "interrupted";

export interface StartedActionRun {
	id: string;
	prodRef: string;
	actionType: string;
	mode: ActionRunMode;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	inputSummary: Record<string, unknown> | null;
	startedAt: string;
	parentRunId: string | null;
}

export interface ActionRunOutcome {
	status: Exclude<ActionRunStatus, "started" | "interrupted">;
	resultSummary: Record<string, unknown> | null;
	externalId: string | null;
	errorMessage: string | null;
	completedAt: string;
	// Enrich the best-effort target label captured before the run once the result
	// reveals a friendlier one (e.g. a resolved account's display name).
	targetLabel?: string | null;
}

export interface ActionRunRow {
	id: string;
	prodRef: string;
	actionType: string;
	mode: ActionRunMode;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	inputSummary: Record<string, unknown> | null;
	status: ActionRunStatus;
	resultSummary: Record<string, unknown> | null;
	errorMessage: string | null;
	externalId: string | null;
	startedAt: string;
	completedAt: string | null;
	parentRunId: string | null;
}

interface ActionRunRecord {
	id: string;
	prod_ref: string;
	action_type: string;
	mode: string;
	target_type: string | null;
	target_id: string | null;
	target_label: string | null;
	input_summary_json: string | null;
	status: string;
	result_summary_json: string | null;
	error_message: string | null;
	external_id: string | null;
	started_at: string;
	completed_at: string | null;
	parent_run_id: string | null;
}

function parseJson(value: string | null): Record<string, unknown> | null {
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

function mapRecord(record: ActionRunRecord): ActionRunRow {
	return {
		id: record.id,
		prodRef: record.prod_ref,
		actionType: record.action_type,
		mode: record.mode === "dry_run" ? "dry_run" : "commit",
		targetType: record.target_type,
		targetId: record.target_id,
		targetLabel: record.target_label,
		inputSummary: parseJson(record.input_summary_json),
		status: record.status as ActionRunStatus,
		resultSummary: parseJson(record.result_summary_json),
		errorMessage: record.error_message,
		externalId: record.external_id,
		startedAt: record.started_at,
		completedAt: record.completed_at,
		parentRunId: record.parent_run_id,
	};
}

export function insertStartedRun(db: SqliteDriver, run: StartedActionRun): void {
	db.run(
		`insert into action_run (
			id, prod_ref, action_type, mode, target_type, target_id, target_label,
			input_summary_json, status, started_at, parent_run_id
		) values (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?)`,
		[
			run.id,
			run.prodRef,
			run.actionType,
			run.mode,
			run.targetType,
			run.targetId,
			run.targetLabel,
			run.inputSummary === null ? null : JSON.stringify(run.inputSummary),
			run.startedAt,
			run.parentRunId,
		],
	);
}

export function completeRun(
	db: SqliteDriver,
	id: string,
	outcome: ActionRunOutcome,
): void {
	// target_label is only overwritten when the outcome supplies a better one, so
	// a null enrichment never wipes the pre-run snapshot.
	if (outcome.targetLabel !== undefined && outcome.targetLabel !== null) {
		db.run("update action_run set target_label = ? where id = ?", [
			outcome.targetLabel,
			id,
		]);
	}
	db.run(
		`update action_run set
			status = ?, result_summary_json = ?, external_id = ?,
			error_message = ?, completed_at = ?
		 where id = ?`,
		[
			outcome.status,
			outcome.resultSummary === null
				? null
				: JSON.stringify(outcome.resultSummary),
			outcome.externalId,
			outcome.errorMessage,
			outcome.completedAt,
			id,
		],
	);
}

/** Reclassify `started` rows abandoned by a prior process exit. */
export function markStaleStartedInterrupted(
	db: SqliteDriver,
	completedAt: string,
): number {
	const result = db.run(
		"update action_run set status = 'interrupted', completed_at = ? where status = 'started'",
		[completedAt],
	);
	return result.changes;
}

export interface ActionRunFilter {
	actionType?: string;
	mode?: ActionRunMode;
	status?: ActionRunStatus;
	target?: string;
	from?: string;
	to?: string;
	page: number;
	pageSize: number;
}

export interface ActionRunListResult {
	rows: ActionRunRow[];
	total: number;
}

function buildWhere(filter: ActionRunFilter): {
	clause: string;
	params: SqliteValue[];
} {
	const where: string[] = [];
	const params: SqliteValue[] = [];
	if (filter.actionType) {
		where.push("action_type = ?");
		params.push(filter.actionType);
	}
	if (filter.mode) {
		where.push("mode = ?");
		params.push(filter.mode);
	}
	if (filter.status) {
		where.push("status = ?");
		params.push(filter.status);
	}
	if (filter.target) {
		where.push(
			"(target_id like ? escape '\\' or target_label like ? escape '\\' or action_type like ? escape '\\')",
		);
		const pattern = `%${filter.target.replace(/([\\%_])/g, "\\$1")}%`;
		params.push(pattern, pattern, pattern);
	}
	if (filter.from) {
		where.push("started_at >= ?");
		params.push(filter.from);
	}
	if (filter.to) {
		where.push("started_at <= ?");
		params.push(filter.to);
	}
	return {
		clause: where.length > 0 ? `where ${where.join(" and ")}` : "",
		params,
	};
}

export function listActionRuns(
	db: SqliteDriver,
	filter: ActionRunFilter,
): ActionRunListResult {
	const { clause, params } = buildWhere(filter);
	const countRow = db.get<{ total: number }>(
		`select count(*) as total from action_run ${clause}`,
		params,
	);
	const total = Number(countRow?.total ?? 0);
	const offset = (filter.page - 1) * filter.pageSize;
	const rows = db.all<ActionRunRecord>(
		`select * from action_run ${clause}
		 order by started_at desc, id desc
		 limit ? offset ?`,
		[...params, filter.pageSize, offset],
	);
	return { rows: rows.map(mapRecord), total };
}

export function getActionRun(
	db: SqliteDriver,
	id: string,
): ActionRunRow | null {
	const record = db.get<ActionRunRecord>(
		"select * from action_run where id = ?",
		[id],
	);
	return record ? mapRecord(record) : null;
}

export function listActionRunsForExport(
	db: SqliteDriver,
	filter: Omit<ActionRunFilter, "page" | "pageSize">,
	cap: number,
): ActionRunRow[] {
	const { clause, params } = buildWhere({
		...filter,
		page: 1,
		pageSize: cap,
	});
	const rows = db.all<ActionRunRecord>(
		`select * from action_run ${clause}
		 order by started_at desc, id desc
		 limit ?`,
		[...params, cap],
	);
	return rows.map(mapRecord);
}

export interface ActionRunTodaySummary {
	commits: number;
	dryRuns: number;
	failedOrPartial: number;
}

export function summarizeToday(
	db: SqliteDriver,
	sinceIso: string,
): ActionRunTodaySummary {
	const row = db.get<{
		commits: number;
		dry_runs: number;
		failed_or_partial: number;
	}>(
		`select
			count(*) filter (where mode = 'commit') as commits,
			count(*) filter (where mode = 'dry_run') as dry_runs,
			count(*) filter (where status in ('failed', 'partial')) as failed_or_partial
		 from action_run
		 where started_at >= ?`,
		[sinceIso],
	);
	return {
		commits: Number(row?.commits ?? 0),
		dryRuns: Number(row?.dry_runs ?? 0),
		failedOrPartial: Number(row?.failed_or_partial ?? 0),
	};
}
