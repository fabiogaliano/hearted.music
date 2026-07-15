import {
	CheckCircleIcon,
	HourglassIcon,
	SpinnerIcon,
	WarningIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import {
	Badge,
	Bar,
	Card,
	type Column,
	ErrorState,
	Loading,
	Stat,
	Table,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { duration, fmt, relativeTime } from "../lib/format";
import type {
	JobFailureItem,
	JobMetrics,
	JobRunRow,
	PageResult,
} from "../lib/types";
import { useUrlView } from "../lib/url-state";

type FailureRow = JobMetrics["recentFailures"][number];
type TypeRow = JobMetrics["byType"][number];

const JOB_TYPES = [
	"sync_liked_songs",
	"sync_playlists",
	"song_analysis",
	"playlist_analysis",
	"matching",
	"sync_playlist_tracks",
] as const;
const JOB_STATUSES = ["pending", "running", "completed", "failed"] as const;

function statusTone(
	status: string,
): "default" | "accent" | "success" | "warning" | "danger" {
	if (status === "completed") return "success";
	if (status === "failed") return "danger";
	if (status === "running") return "accent";
	return "default";
}

const itemFailureColumns: DataTableColumn<JobFailureItem>[] = [
	{
		key: "item",
		header: "Item",
		render: (f) => (
			<span className="song-meta">
				<span className="primary">{f.itemLabel}</span>
				<span className="dim">{f.itemType}</span>
			</span>
		),
	},
	{
		key: "code",
		header: "Failure",
		sortable: true,
		render: (f) => (
			<span className="failure-cell">
				<Badge tone={f.isTerminal ? "danger" : "warning"}>
					{f.failureCode}
				</Badge>
				{f.stage && <span className="dim"> · {f.stage}</span>}
			</span>
		),
	},
	{
		key: "error",
		header: "Error",
		render: (f) => (
			<span className="dim" title={f.errorMessage ?? ""}>
				{f.errorMessage ? f.errorMessage.slice(0, 70) : "—"}
			</span>
		),
	},
	{
		key: "account",
		header: "Account",
		render: (f) =>
			f.accountId && f.accountLabel ? (
				<UserLink
					id={f.accountId}
					label={f.accountLabel}
					handle={f.accountHandle}
				/>
			) : (
				<span className="dim">—</span>
			),
	},
	{
		key: "when",
		header: "When",
		right: true,
		sortable: true,
		render: (f) => <span className="dim">{relativeTime(f.createdAt)}</span>,
	},
];

const failureColumns: Column<FailureRow>[] = [
	{
		key: "type",
		header: "Type",
		render: (r) => <span className="primary">{r.type}</span>,
	},
	{
		key: "error",
		header: "Error",
		render: (r) => (
			<span className="dim" title={r.error ?? ""}>
				{r.error ? r.error.slice(0, 80) : "—"}
			</span>
		),
	},
	{
		key: "when",
		header: "When",
		right: true,
		render: (r) => <span className="dim">{relativeTime(r.updatedAt)}</span>,
	},
];

const typeColumns: Column<TypeRow>[] = [
	{
		key: "type",
		header: "Job type",
		render: (r) => <span className="primary">{r.type}</span>,
	},
	{
		key: "pending",
		header: "Pending",
		right: true,
		render: (r) => <span className="cell-num">{r.pending || "—"}</span>,
	},
	{
		key: "running",
		header: "Running",
		right: true,
		render: (r) => <span className="cell-num">{r.running || "—"}</span>,
	},
	{
		key: "failed",
		header: "Failed",
		right: true,
		render: (r) =>
			r.failed > 0 ? (
				<span className="cell-num" style={{ color: "var(--danger)" }}>
					{r.failed}
				</span>
			) : (
				<span className="dim">—</span>
			),
	},
];

type FailureTableState = {
	search: string;
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readFailureTableState(): FailureTableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("fPageSize");
	const page = Number(params.get("fPage"));
	return {
		search: params.get("fQ") ?? "",
		sort: params.get("fSort") ?? "createdAt",
		direction: params.get("fDirection") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

function updateFailureTableUrl(next: FailureTableState) {
	const url = new URL(window.location.href);
	if (next.search) url.searchParams.set("fQ", next.search);
	else url.searchParams.delete("fQ");
	url.searchParams.set("fSort", next.sort);
	url.searchParams.set("fDirection", next.direction);
	url.searchParams.set("fPage", String(next.page));
	url.searchParams.set("fPageSize", String(next.pageSize));
	window.history.pushState({ controlPanel: true }, "", url);
}

type RunTableState = {
	search: string;
	type: string;
	status: string;
	stale: "all" | "true" | "false";
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readRunTableState(): RunTableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("rPageSize");
	const page = Number(params.get("rPage"));
	const stale = params.get("rStale");
	return {
		search: params.get("rQ") ?? "",
		type: params.get("rType") ?? "",
		status: params.get("rStatus") ?? "",
		stale: stale === "true" || stale === "false" ? stale : "all",
		sort: params.get("rSort") ?? "updatedAt",
		direction: params.get("rDirection") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

function updateRunTableUrl(next: RunTableState) {
	const url = new URL(window.location.href);
	if (next.search) url.searchParams.set("rQ", next.search);
	else url.searchParams.delete("rQ");
	if (next.type) url.searchParams.set("rType", next.type);
	else url.searchParams.delete("rType");
	if (next.status) url.searchParams.set("rStatus", next.status);
	else url.searchParams.delete("rStatus");
	if (next.stale !== "all") url.searchParams.set("rStale", next.stale);
	else url.searchParams.delete("rStale");
	url.searchParams.set("rSort", next.sort);
	url.searchParams.set("rDirection", next.direction);
	url.searchParams.set("rPage", String(next.page));
	url.searchParams.set("rPageSize", String(next.pageSize));
	window.history.pushState({ controlPanel: true }, "", url);
}

function JobRunDetail({
	run,
	onClose,
}: {
	run: JobRunRow;
	onClose: () => void;
}) {
	const failures = useApi<{ failures: JobFailureItem[] }>(
		`/api/jobs/${run.id}/failures`,
	);

	async function copyDebugDetails() {
		const payload = { run, failures: failures.data?.failures ?? [] };
		await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
	}

	return (
		<Drawer title="Job run" onClose={onClose}>
			<div className="drawer-section">
				<h3>Identity</h3>
				<dl className="drawer-kv">
					<dt>Job ID</dt>
					<dd>{run.id}</dd>
					<dt>Account</dt>
					<dd>
						<UserLink
							id={run.accountId}
							label={run.accountLabel}
							handle={run.accountHandle}
						/>
					</dd>
					<dt>Type</dt>
					<dd>{run.type}</dd>
					<dt>Status</dt>
					<dd>
						<Badge tone={statusTone(run.status)}>{run.status}</Badge>
						{run.stale && (
							<>
								{" "}
								<Badge tone="warning">stale</Badge>
							</>
						)}
					</dd>
				</dl>
			</div>

			<div className="drawer-section">
				<h3>Timestamps</h3>
				<dl className="drawer-kv">
					<dt>Created</dt>
					<dd>{run.createdAt}</dd>
					<dt>Started</dt>
					<dd>{run.startedAt ?? "—"}</dd>
					<dt>Completed</dt>
					<dd>{run.completedAt ?? "—"}</dd>
					<dt>Updated</dt>
					<dd>{run.updatedAt}</dd>
					<dt>Heartbeat</dt>
					<dd>{run.heartbeatAt ?? "—"}</dd>
				</dl>
			</div>

			<div className="drawer-section">
				<h3>Progress</h3>
				{run.progress && Object.keys(run.progress).length > 0 ? (
					<dl className="drawer-kv">
						{Object.entries(run.progress).map(([key, value]) => (
							<>
								<dt key={`${key}-k`}>{key}</dt>
								<dd key={`${key}-v`}>{String(value)}</dd>
							</>
						))}
					</dl>
				) : (
					<div className="dim">No structured progress recorded.</div>
				)}
			</div>

			{run.error && (
				<div className="drawer-section">
					<h3>Error</h3>
					<div className="drawer-error">{run.error}</div>
				</div>
			)}

			<div className="drawer-section">
				<h3>Related item failures</h3>
				{failures.error ? (
					<ErrorState message={failures.error} />
				) : (
					<Table
						columns={itemFailureColumns}
						rows={failures.data?.failures ?? []}
						empty="No item-level failures recorded for this run."
					/>
				)}
			</div>

			<button type="button" className="btn" onClick={copyDebugDetails}>
				Copy debug details
			</button>
		</Drawer>
	);
}

const runColumns = (
	onOpen: (row: JobRunRow) => void,
): DataTableColumn<JobRunRow>[] => [
	{
		key: "account",
		header: "Account",
		render: (r) => (
			<UserLink
				id={r.accountId}
				label={r.accountLabel}
				handle={r.accountHandle}
			/>
		),
	},
	{
		key: "type",
		header: "Type",
		render: (r) => <span className="primary">{r.type}</span>,
	},
	{
		key: "status",
		header: "Status",
		render: (r) => (
			<span className="failure-cell">
				<Badge tone={statusTone(r.status)}>{r.status}</Badge>
				{r.stale && <Badge tone="warning">stale</Badge>}
			</span>
		),
	},
	{
		key: "progress",
		header: "Progress",
		render: (r) => {
			const done = r.progress?.done;
			const total = r.progress?.total;
			return (
				<span className="dim">
					{typeof done === "number" && typeof total === "number"
						? `${fmt(done)} / ${fmt(total)}`
						: "—"}
				</span>
			);
		},
	},
	{
		key: "createdAt",
		header: "Created",
		sortable: true,
		render: (r) => <span className="dim">{relativeTime(r.createdAt)}</span>,
	},
	{
		key: "updatedAt",
		header: "Updated",
		sortable: true,
		right: true,
		render: (r) => <span className="dim">{relativeTime(r.updatedAt)}</span>,
	},
	{
		key: "view",
		header: "",
		render: (r) => (
			<button type="button" className="btn mini" onClick={() => onOpen(r)}>
				View
			</button>
		),
	},
];

export function JobsSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<JobMetrics>("/api/metrics/jobs", refreshKey);
	const [tab, setTab] = useUrlView(
		["actionable", "parked", "runs", "recent"] as const,
		"actionable",
	);
	const [openJob, setOpenJob] = useState<JobRunRow | null>(null);

	const [failureTable, setFailureTable] = useState<FailureTableState>(
		readFailureTableState,
	);
	const [runTable, setRunTable] = useState<RunTableState>(readRunTableState);
	useEffect(() => {
		const onPopState = () => {
			setFailureTable(readFailureTableState());
			setRunTable(readRunTableState());
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function updateFailureTable(patch: Partial<FailureTableState>) {
		const next = { ...failureTable, ...patch };
		setFailureTable(next);
		updateFailureTableUrl(next);
	}

	function updateRunTable(patch: Partial<RunTableState>) {
		const next = { ...runTable, ...patch };
		setRunTable(next);
		updateRunTableUrl(next);
	}

	const parked =
		tab === "parked" ? "parked" : tab === "actionable" ? "actionable" : "all";
	const failureParams = new URLSearchParams({
		q: failureTable.search,
		sort: failureTable.sort,
		direction: failureTable.direction,
		page: String(failureTable.page),
		pageSize: String(failureTable.pageSize),
		parked,
	});
	const failures = useApi<PageResult<JobFailureItem>>(
		`/api/jobs/failures?${failureParams.toString()}`,
		refreshKey,
	);

	const runParams = new URLSearchParams({
		q: runTable.search,
		sort: runTable.sort,
		direction: runTable.direction,
		page: String(runTable.page),
		pageSize: String(runTable.pageSize),
	});
	if (runTable.type) runParams.set("type", runTable.type);
	if (runTable.status) runParams.set("status", runTable.status);
	if (runTable.stale !== "all") runParams.set("stale", runTable.stale);
	const runs = useApi<PageResult<JobRunRow>>(
		`/api/jobs/runs?${runParams.toString()}`,
		refreshKey,
	);

	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const maxCode = Math.max(...data.failureCodes.map((c) => c.count), 1);
	const failureItems = failures.data?.rows ?? [];

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Pending"
					value={data.pending}
					icon={HourglassIcon}
					sub={
						data.oldestPendingSeconds != null ? (
							<>
								oldest <strong>{duration(data.oldestPendingSeconds)}</strong>
							</>
						) : (
							"queue empty"
						)
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Running"
					value={data.running}
					icon={SpinnerIcon}
					sub={
						data.staleRunning > 0 ? (
							<span style={{ color: "var(--danger)" }}>
								{data.staleRunning} stale &gt;5m
							</span>
						) : (
							"healthy"
						)
					}
				/>
			</Card>
			<Card span={3}>
				<Stat label="Failed" value={data.failed} icon={WarningOctagonIcon} />
			</Card>
			<Card span={3}>
				<Stat label="Completed" value={data.completed} icon={CheckCircleIcon} />
			</Card>

			<Card title="Unresolved item failures" icon={WarningIcon} span={5}>
				<div className="stat" style={{ marginBottom: 16 }}>
					<div
						className="stat-value"
						style={{
							color: data.unresolvedFailures > 0 ? "var(--warning)" : undefined,
						}}
					>
						{fmt(data.unresolvedFailures)}
					</div>
					<div className="stat-sub">
						item-level failures awaiting resolution
						{data.parkedFailures > 0 && (
							<> · {fmt(data.parkedFailures)} parked (retry &gt;3d out)</>
						)}
					</div>
				</div>
				{data.failureCodes.map((c) => (
					<Bar
						key={c.code}
						label={c.code}
						value={c.count}
						max={maxCode}
						tone="warning"
					/>
				))}
				{data.failureCodes.length === 0 && (
					<div className="empty">No unresolved failures.</div>
				)}
			</Card>

			<Card title="Active work by type" icon={SpinnerIcon} span={7}>
				<Table
					columns={typeColumns}
					rows={data.byType}
					empty="No pending, running, or failed jobs."
				/>
			</Card>

			<Card
				title="Job detail"
				icon={WarningIcon}
				span={12}
				action={
					data.unresolvedFailures > 0 ? (
						<Badge tone="warning">{data.unresolvedFailures} open</Badge>
					) : (
						<Badge tone="success">none</Badge>
					)
				}
			>
				<div className="btn-row" style={{ marginBottom: 12 }}>
					<button
						type="button"
						className={`btn ${tab === "actionable" ? "primary" : ""}`}
						onClick={() => setTab("actionable")}
					>
						Actionable failures
					</button>
					<button
						type="button"
						className={`btn ${tab === "parked" ? "primary" : ""}`}
						onClick={() => setTab("parked")}
					>
						Parked failures
					</button>
					<button
						type="button"
						className={`btn ${tab === "runs" ? "primary" : ""}`}
						onClick={() => setTab("runs")}
					>
						Job runs
					</button>
					<button
						type="button"
						className={`btn ${tab === "recent" ? "primary" : ""}`}
						onClick={() => setTab("recent")}
					>
						Recent failed
					</button>
				</div>

				{(tab === "actionable" || tab === "parked") && (
					<>
						<DataTable
							tableId={`job-failures-${tab}`}
							columns={itemFailureColumns}
							rows={failureItems}
							total={failures.data?.total ?? 0}
							page={failures.data?.page ?? failureTable.page}
							pageSize={failures.data?.pageSize ?? failureTable.pageSize}
							search={failureTable.search}
							sort={failureTable.sort}
							direction={failureTable.direction}
							getRowId={(row) => row.id}
							onSearchChange={(search) =>
								updateFailureTable({ search, page: 1 })
							}
							onSortChange={(sort) =>
								updateFailureTable({
									sort,
									direction:
										failureTable.sort === sort &&
										failureTable.direction === "asc"
											? "desc"
											: "asc",
									page: 1,
								})
							}
							onPageChange={(page) => updateFailureTable({ page })}
							onPageSizeChange={(pageSize) =>
								updateFailureTable({ pageSize, page: 1 })
							}
							onReset={() =>
								updateFailureTable({
									search: "",
									sort: "createdAt",
									direction: "desc",
									page: 1,
									pageSize: 50,
								})
							}
							loading={failures.loading}
							refreshing={failures.refreshing}
							error={failures.error}
							onRetry={failures.refetch}
							empty={
								tab === "parked"
									? "No parked item failures."
									: "No unresolved item failures."
							}
							noMatches="No failures match this search."
							exportUrl="/api/exports/job-failures"
						/>
						{failureItems.length > 0 && (
							<div className="stat-sub" style={{ marginTop: 12 }}>
								Each item-level failure awaiting resolution · click an account
								to inspect · hover an error for the full message
							</div>
						)}
					</>
				)}

				{tab === "runs" && (
					<DataTable
						tableId="job-runs"
						columns={runColumns(setOpenJob)}
						rows={runs.data?.rows ?? []}
						total={runs.data?.total ?? 0}
						page={runs.data?.page ?? runTable.page}
						pageSize={runs.data?.pageSize ?? runTable.pageSize}
						search={runTable.search}
						filters={
							<>
								<select
									className="select"
									aria-label="Job type"
									value={runTable.type}
									onChange={(event) =>
										updateRunTable({ type: event.target.value, page: 1 })
									}
								>
									<option value="">All types</option>
									{JOB_TYPES.map((type) => (
										<option key={type} value={type}>
											{type}
										</option>
									))}
								</select>
								<select
									className="select"
									aria-label="Status"
									value={runTable.status}
									onChange={(event) =>
										updateRunTable({ status: event.target.value, page: 1 })
									}
								>
									<option value="">All statuses</option>
									{JOB_STATUSES.map((status) => (
										<option key={status} value={status}>
											{status}
										</option>
									))}
								</select>
								<select
									className="select"
									aria-label="Staleness"
									value={runTable.stale}
									onChange={(event) =>
										updateRunTable({
											stale:
												event.target.value === "true" ||
												event.target.value === "false"
													? event.target.value
													: "all",
											page: 1,
										})
									}
								>
									<option value="all">All runs</option>
									<option value="true">Stale only</option>
									<option value="false">Healthy only</option>
								</select>
							</>
						}
						hasActiveFilters={
							runTable.type !== "" ||
							runTable.status !== "" ||
							runTable.stale !== "all"
						}
						sort={runTable.sort}
						direction={runTable.direction}
						getRowId={(row) => row.id}
						onSearchChange={(search) => updateRunTable({ search, page: 1 })}
						onSortChange={(sort) =>
							updateRunTable({
								sort,
								direction:
									runTable.sort === sort && runTable.direction === "asc"
										? "desc"
										: "asc",
								page: 1,
							})
						}
						onPageChange={(page) => updateRunTable({ page })}
						onPageSizeChange={(pageSize) =>
							updateRunTable({ pageSize, page: 1 })
						}
						onReset={() =>
							updateRunTable({
								search: "",
								type: "",
								status: "",
								stale: "all",
								sort: "updatedAt",
								direction: "desc",
								page: 1,
								pageSize: 50,
							})
						}
						loading={runs.loading}
						refreshing={runs.refreshing}
						error={runs.error}
						onRetry={runs.refetch}
						empty="No job runs recorded yet."
						noMatches="No job runs match these filters."
						exportUrl="/api/exports/job-runs"
					/>
				)}

				{tab === "recent" && (
					<Table
						columns={failureColumns}
						rows={data.recentFailures}
						empty="No failed jobs."
					/>
				)}
			</Card>

			{openJob && (
				<JobRunDetail run={openJob} onClose={() => setOpenJob(null)} />
			)}
		</div>
	);
}
