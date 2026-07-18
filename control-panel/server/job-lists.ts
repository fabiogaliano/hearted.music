import { read } from "./db";
import { collectExportPages } from "./export";
import { parseListQuery, type ListQuery, type PageResult } from "./query-params";

export interface JobFailureRow {
	id: string;
	itemType: string;
	itemId: string;
	itemLabel: string;
	failureCode: string;
	stage: string | null;
	errorMessage: string | null;
	isTerminal: boolean;
	createdAt: string;
	accountId: string | null;
	accountLabel: string | null;
	accountHandle: string | null;
}

type SortKey = "createdAt" | "code";
const SORTS = ["createdAt", "code"] as const;
const SORT_SQL: Record<SortKey, string> = { createdAt: "f.created_at", code: "f.failure_code" };

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function mapFailureRow(row: Record<string, unknown>): JobFailureRow {
	const songName = row.song_name ? String(row.song_name) : null;
	return {
		id: String(row.id),
		itemType: String(row.item_type),
		itemId: String(row.item_id),
		itemLabel: songName ? `${songName}${row.song_artist ? ` — ${row.song_artist}` : ""}` : `${String(row.item_type)} ${String(row.item_id).slice(0, 8)}`,
		failureCode: String(row.failure_code),
		stage: row.stage ? String(row.stage) : null,
		errorMessage: row.error_message ? String(row.error_message) : null,
		isTerminal: Boolean(row.is_terminal),
		createdAt: String(row.created_at),
		accountId: row.account_id ? String(row.account_id) : null,
		accountLabel: row.display_name || row.email || row.handle ? String(row.display_name || row.email || row.handle) : null,
		accountHandle: row.handle ? String(row.handle) : null,
	};
}

export async function jobFailuresPage(url: URL): Promise<PageResult<JobFailureRow>> {
	const query = parseListQuery(url, SORTS, "createdAt");
	const params: unknown[] = [];
	const where = ["f.resolved_at is null"];
	const parked = url.searchParams.get("parked");
	if (parked === "parked") where.push("f.suppress_until > now() + interval '3 days'");
	else if (parked !== "all") where.push("(f.suppress_until is null or f.suppress_until <= now() + interval '3 days')");
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		where.push(`(f.item_id::text ilike $${params.length} or coalesce(f.error_message, '') ilike $${params.length} or coalesce(a.email, '') ilike $${params.length} or coalesce(a.display_name, '') ilike $${params.length})`);
	}
	const code = url.searchParams.get("code");
	if (code) { params.push(code); where.push(`f.failure_code = $${params.length}`); }
	const stage = url.searchParams.get("stage");
	if (stage) { params.push(stage); where.push(`f.stage = $${params.length}`); }
	const terminal = url.searchParams.get("terminal");
	if (terminal === "true" || terminal === "false") { params.push(terminal === "true"); where.push(`f.is_terminal = $${params.length}`); }
	const accountId = url.searchParams.get("accountId");
	if (accountId) { params.push(accountId); where.push(`j.account_id = $${params.length}`); }
	const from = `from job_item_failure f left join job j on j.id = f.job_id left join account a on a.id = j.account_id left join song s on s.id = f.item_id and f.item_type = 'song'`;
	const predicate = where.join(" and ");
	const count = await read<{ total: string }>(`select count(*) as total ${from} where ${predicate}`, params);
	const total = Number(count[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowParams = [...params, query.pageSize, offset];
	const rows = await read(`select f.id, f.item_type, f.item_id, f.failure_code, f.stage, f.error_message, f.is_terminal, to_char(f.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at, j.account_id, a.display_name, a.handle, a.email, s.name as song_name, array_to_string(s.artists, ', ') as song_artist ${from} where ${predicate} order by ${SORT_SQL[query.sort]} ${query.direction}, f.id asc limit $${rowParams.length - 1} offset $${rowParams.length}`, rowParams);
	return { rows: rows.map(mapFailureRow), total, page: query.page, pageSize: query.pageSize };
}

export async function jobFailuresExport(url: URL): Promise<JobFailureRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await jobFailuresPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	return collectExportPages(first, async (page) => {
		const next = new URL(url);
		next.searchParams.set("page", String(page));
		next.searchParams.set("pageSize", "100");
		return jobFailuresPage(next);
	});
}

// One item-level failure history for a single job run — the drawer's "related
// item failures" panel. Unlike jobFailuresPage, this intentionally includes
// resolved/parked rows too: it's a historical record for that one run, not the
// actionable queue.
export async function jobRunFailures(jobId: string): Promise<JobFailureRow[]> {
	if (!isUuid(jobId)) throw new Error("Invalid job id.");
	const rows = await read(
		`select f.id, f.item_type, f.item_id, f.failure_code, f.stage, f.error_message, f.is_terminal,
			to_char(f.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			j.account_id, a.display_name, a.handle, a.email,
			s.name as song_name, array_to_string(s.artists, ', ') as song_artist
		from job_item_failure f
		left join job j on j.id = f.job_id
		left join account a on a.id = j.account_id
		left join song s on s.id = f.item_id and f.item_type = 'song'
		where f.job_id = $1
		order by f.created_at desc
		limit 100`,
		[jobId],
	);
	return rows.map(mapFailureRow);
}

// ── Job runs (individual jobs, not item-level failures) ──────────────────────

export interface JobRunRow {
	id: string;
	accountId: string;
	accountLabel: string;
	accountHandle: string | null;
	type: string;
	status: string;
	progress: Record<string, unknown> | null;
	error: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
	heartbeatAt: string | null;
	stale: boolean;
}

export type JobRunSort = "createdAt" | "updatedAt" | "age";
const RUN_SORTS = ["createdAt", "updatedAt", "age"] as const satisfies readonly JobRunSort[];
const RUN_SORT_SQL: Record<JobRunSort, string> = {
	createdAt: "j.created_at",
	updatedAt: "j.updated_at",
	age: "j.created_at",
};

const JOB_TYPES = new Set([
	"sync_liked_songs",
	"sync_playlists",
	"song_analysis",
	"playlist_analysis",
	"matching",
	"sync_playlist_tracks",
]);
const JOB_STATUSES = new Set(["pending", "running", "completed", "failed"]);

export interface JobRunsListQuery extends ListQuery<JobRunSort> {
	type: string | null;
	status: string | null;
	stale: "true" | "false" | "all";
	accountId: string | null;
	dateFrom: string | null;
	dateTo: string | null;
}

export function parseJobRunsQuery(url: URL): JobRunsListQuery {
	const base = parseListQuery(url, RUN_SORTS, "updatedAt");
	const type = url.searchParams.get("type");
	const status = url.searchParams.get("status");
	const stale = url.searchParams.get("stale");
	return {
		...base,
		type: type && JOB_TYPES.has(type) ? type : null,
		status: status && JOB_STATUSES.has(status) ? status : null,
		stale: stale === "true" || stale === "false" ? stale : "all",
		accountId: url.searchParams.get("accountId") || null,
		dateFrom: url.searchParams.get("dateFrom") || null,
		dateTo: url.searchParams.get("dateTo") || null,
	};
}

const STALE_PREDICATE = "j.status = 'running' and j.heartbeat_at < now() - interval '5 minutes'";

function whereForJobRuns(query: JobRunsListQuery, params: unknown[]): string[] {
	const where: string[] = ["true"];
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		const pattern = `$${params.length}`;
		if (isUuid(query.q)) {
			params.push(query.q);
			where.push(`(j.id::text = $${params.length} or a.email ilike ${pattern} or coalesce(a.display_name, '') ilike ${pattern} or coalesce(a.handle, '') ilike ${pattern})`);
		} else {
			where.push(`(a.email ilike ${pattern} or coalesce(a.display_name, '') ilike ${pattern} or coalesce(a.handle, '') ilike ${pattern})`);
		}
	}
	if (query.type) { params.push(query.type); where.push(`j.type::text = $${params.length}`); }
	if (query.status) { params.push(query.status); where.push(`j.status::text = $${params.length}`); }
	if (query.stale === "true") where.push(STALE_PREDICATE);
	else if (query.stale === "false") where.push(`not (${STALE_PREDICATE})`);
	if (query.accountId) { params.push(query.accountId); where.push(`j.account_id = $${params.length}`); }
	if (query.dateFrom) { params.push(query.dateFrom); where.push(`j.created_at >= $${params.length}`); }
	if (query.dateTo) { params.push(query.dateTo); where.push(`j.created_at < $${params.length}`); }
	return where;
}

const RUN_FROM = "from job j left join account a on a.id = j.account_id";

function mapJobRun(row: Record<string, unknown>): JobRunRow {
	return {
		id: String(row.id),
		accountId: String(row.account_id),
		accountLabel: row.display_name || row.email || row.handle ? String(row.display_name || row.email || row.handle) : String(row.account_id),
		accountHandle: row.handle ? String(row.handle) : null,
		type: String(row.type),
		status: String(row.status),
		progress: (row.progress as Record<string, unknown> | null) ?? null,
		error: row.error ? String(row.error) : null,
		createdAt: String(row.created_at),
		startedAt: row.started_at ? String(row.started_at) : null,
		completedAt: row.completed_at ? String(row.completed_at) : null,
		updatedAt: String(row.updated_at),
		heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null,
		stale: Boolean(row.stale),
	};
}

export async function jobRunsPage(url: URL): Promise<PageResult<JobRunRow>> {
	const query = parseJobRunsQuery(url);
	const params: unknown[] = [];
	const where = whereForJobRuns(query, params);
	const predicate = where.join(" and ");
	const count = await read<{ total: string }>(`select count(*) as total ${RUN_FROM} where ${predicate}`, params);
	const total = Number(count[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowParams = [...params, query.pageSize, offset];
	// "age" is derived from created_at but inverted: the oldest run has the
	// largest age, so age-desc ("longest running first") sorts created_at ascending.
	const direction = query.sort === "age" ? (query.direction === "desc" ? "asc" : "desc") : query.direction;
	const rows = await read(
		`select j.id, j.account_id, a.display_name, a.handle, a.email, j.type::text as type, j.status::text as status,
			j.progress, j.error,
			to_char(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			to_char(j.started_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as started_at,
			to_char(j.completed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as completed_at,
			to_char(j.updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as updated_at,
			to_char(j.heartbeat_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as heartbeat_at,
			(${STALE_PREDICATE}) as stale
		${RUN_FROM}
		where ${predicate}
		order by ${RUN_SORT_SQL[query.sort]} ${direction}, j.id asc
		limit $${rowParams.length - 1} offset $${rowParams.length}`,
		rowParams,
	);
	return { rows: rows.map(mapJobRun), total, page: query.page, pageSize: query.pageSize };
}

export async function jobRunsExport(url: URL): Promise<JobRunRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await jobRunsPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	return collectExportPages(first, async (page) => {
		const next = new URL(url);
		next.searchParams.set("page", String(page));
		next.searchParams.set("pageSize", "100");
		return jobRunsPage(next);
	});
}
