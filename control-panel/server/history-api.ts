/**
 * Read API over the local action-history store. Local recall/recovery only —
 * never presented as authoritative or compliance-grade.
 */

import {
	type ActionRunFilter,
	type ActionRunMode,
	type ActionRunRow,
	type ActionRunStatus,
	getActionRun,
	listActionRuns,
	listActionRunsForExport,
	summarizeToday,
	type ActionRunTodaySummary,
} from "./local-store/action-runs";
import { getLocalStore } from "./local-store/store";
import type { PageResult } from "./query-params";

const MODES: readonly ActionRunMode[] = ["dry_run", "commit"];
const STATUSES: readonly ActionRunStatus[] = [
	"started",
	"succeeded",
	"failed",
	"partial",
	"interrupted",
];

const EXPORT_CAP = 25_000;

function parsePositiveInteger(value: string | null): number | null {
	if (value === null || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePageSize(value: string | null): number {
	if (value === "25") return 25;
	if (value === "100") return 100;
	return 50;
}

function parseInstant(value: string | null): string | undefined {
	if (!value) return undefined;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function parseHistoryFilter(url: URL): ActionRunFilter {
	const params = url.searchParams;
	const mode = params.get("mode");
	const status = params.get("status");
	const page = parsePositiveInteger(params.get("page")) ?? 1;
	return {
		actionType: params.get("action")?.trim() || undefined,
		mode: MODES.includes(mode as ActionRunMode)
			? (mode as ActionRunMode)
			: undefined,
		status: STATUSES.includes(status as ActionRunStatus)
			? (status as ActionRunStatus)
			: undefined,
		target: params.get("target")?.trim() || undefined,
		from: parseInstant(params.get("from")),
		to: parseInstant(params.get("to")),
		page: Math.max(1, page),
		pageSize: parsePageSize(params.get("pageSize")),
	};
}

export function historyPage(url: URL): PageResult<ActionRunRow> {
	const filter = parseHistoryFilter(url);
	const { rows, total } = listActionRuns(getLocalStore(), filter);
	return {
		rows,
		total,
		page: filter.page,
		pageSize: filter.pageSize as PageResult<ActionRunRow>["pageSize"],
	};
}

export function historyRun(id: string): ActionRunRow | null {
	return getActionRun(getLocalStore(), id);
}

export function historySummary(): ActionRunTodaySummary {
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);
	return summarizeToday(getLocalStore(), startOfDay.toISOString());
}

export function historyExport(url: URL): ActionRunRow[] {
	const { page: _page, pageSize: _pageSize, ...filter } = parseHistoryFilter(url);
	return listActionRunsForExport(getLocalStore(), filter, EXPORT_CAP);
}
