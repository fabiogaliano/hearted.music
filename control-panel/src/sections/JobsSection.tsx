import {
	CheckCircleIcon,
	HourglassIcon,
	SpinnerIcon,
	WarningIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
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
import type { JobFailureItem, JobMetrics } from "../lib/types";

type FailureRow = JobMetrics["recentFailures"][number];
type TypeRow = JobMetrics["byType"][number];

const itemFailureColumns: Column<JobFailureItem>[] = [
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

export function JobsSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<JobMetrics>("/api/metrics/jobs", refreshKey);
	const failures = useApi<{ failures: JobFailureItem[] }>(
		"/api/jobs/failures",
		refreshKey,
	);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const maxCode = Math.max(...data.failureCodes.map((c) => c.count), 1);
	const failureItems = failures.data?.failures ?? [];

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
				title="Unresolved item failures · detail"
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
				<Table
					columns={itemFailureColumns}
					rows={failureItems}
					empty="No unresolved item failures."
				/>
				{failureItems.length > 0 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						Each item-level failure awaiting resolution · click an account to
						inspect · hover an error for the full message
					</div>
				)}
			</Card>

			<Card
				title="Recent failed jobs"
				icon={WarningOctagonIcon}
				span={12}
				action={
					data.failed > 0 ? (
						<Badge tone="danger">{data.failed} failed</Badge>
					) : (
						<Badge tone="success">none</Badge>
					)
				}
			>
				<Table
					columns={failureColumns}
					rows={data.recentFailures}
					empty="No failed jobs."
				/>
			</Card>
		</div>
	);
}
