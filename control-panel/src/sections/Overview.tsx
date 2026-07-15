import {
	CaretRightIcon,
	CheckCircleIcon,
	GearIcon,
	HeartIcon,
	HourglassIcon,
	MusicNotesIcon,
	SparkleIcon,
	UserPlusIcon,
	UsersIcon,
	WarningCircleIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
	Bar,
	Card,
	ErrorState,
	Loading,
	Sparkline,
	Stat,
} from "../components/primitives";
import { useApi } from "../lib/api";
import {
	type AttentionThresholds,
	DEFAULT_ATTENTION_THRESHOLDS,
	readAttentionThresholds,
	writeAttentionThresholds,
} from "../lib/attention-thresholds";
import { compact, duration, fmt, pct, usd } from "../lib/format";
import { useNavigate } from "../lib/navigation";
import type {
	BillingMetrics,
	EnrichmentMetrics,
	JobMetrics,
	LibraryMetrics,
	OverviewComparisons,
	OverviewRange,
	RangeComparison,
	UsersMetrics,
} from "../lib/types";
import type { SectionKey } from "../lib/url-state";

const RANGES = [
	"24h",
	"7d",
	"14d",
	"30d",
] as const satisfies readonly OverviewRange[];

function readRange(): OverviewRange {
	const value = new URL(window.location.href).searchParams.get("range");
	return RANGES.find((r) => r === value) ?? "14d";
}

function updateRange(range: OverviewRange) {
	const url = new URL(window.location.href);
	if (range === "14d") url.searchParams.delete("range");
	else url.searchParams.set("range", range);
	window.history.pushState({ controlPanel: true }, "", url);
}

function deltaLabel(c: RangeComparison, format: (n: number) => string): string {
	if (c.deltaPercent === null) {
		return c.deltaAbsolute === 0
			? "no change"
			: `${c.deltaAbsolute > 0 ? "+" : ""}${format(c.deltaAbsolute)} vs 0`;
	}
	const sign = c.deltaPercent > 0 ? "+" : "";
	return `${sign}${c.deltaPercent}% (${c.deltaAbsolute > 0 ? "+" : ""}${format(c.deltaAbsolute)})`;
}

function ComparisonRow({
	label,
	comparison,
	format = fmt,
}: {
	label: string;
	comparison: RangeComparison;
	format?: (n: number) => string;
}) {
	const tone =
		comparison.deltaAbsolute > 0
			? "success"
			: comparison.deltaAbsolute < 0
				? "danger"
				: "muted";
	return (
		<div className="bar-row" style={{ gridTemplateColumns: "140px 1fr 140px" }}>
			<span className="bar-label">{label}</span>
			<span className="cell-num">{format(comparison.current)}</span>
			<span
				className="dim"
				style={{
					textAlign: "right",
					color:
						tone === "success"
							? "var(--success)"
							: tone === "danger"
								? "var(--danger)"
								: undefined,
				}}
			>
				{deltaLabel(comparison, format)}
			</span>
		</div>
	);
}

function ThresholdsPopover({
	thresholds,
	onChange,
}: {
	thresholds: AttentionThresholds;
	onChange: (next: AttentionThresholds) => void;
}) {
	function field(key: keyof AttentionThresholds, label: string) {
		return (
			<label className="threshold-field" key={key}>
				<span>{label}</span>
				<input
					className="input"
					type="number"
					min={0}
					value={thresholds[key]}
					onChange={(event) => {
						const value = Number(event.target.value);
						if (!Number.isFinite(value) || value < 0) return;
						onChange({ ...thresholds, [key]: value });
					}}
				/>
			</label>
		);
	}

	return (
		<details className="threshold-popover">
			<summary className="icon-btn" title="Attention thresholds">
				<GearIcon size={15} weight="bold" />
			</summary>
			<div className="threshold-panel">
				{field("failedJobsMin", "Failed jobs ≥")}
				{field("staleRunningMin", "Stale running jobs ≥")}
				{field("actionableFailuresMin", "Actionable item failures ≥")}
				{field("pendingJobsMinAgeMinutes", "Pending job age (min) ≥")}
				{field("pendingGrantsMin", "Pending grants ≥")}
				{field("noLibraryMinAgeHours", "No-library account age (hrs) ≥")}
				<button
					type="button"
					className="btn"
					onClick={() => onChange(DEFAULT_ATTENTION_THRESHOLDS)}
				>
					Reset to defaults
				</button>
			</div>
		</details>
	);
}

export function Overview({ refreshKey }: { refreshKey: number }) {
	const users = useApi<UsersMetrics>("/api/metrics/users", refreshKey);
	const library = useApi<LibraryMetrics>("/api/metrics/library", refreshKey);
	const jobs = useApi<JobMetrics>("/api/metrics/jobs", refreshKey);
	const billing = useApi<BillingMetrics>("/api/metrics/billing", refreshKey);
	const enrich = useApi<EnrichmentMetrics>(
		"/api/metrics/enrichment",
		refreshKey,
	);
	const navigate = useNavigate();

	const [range, setRange] = useState<OverviewRange>(readRange);
	const [thresholds, setThresholds] = useState<AttentionThresholds>(
		readAttentionThresholds,
	);
	useEffect(() => {
		const onPopState = () => setRange(readRange());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function changeRange(next: OverviewRange) {
		setRange(next);
		updateRange(next);
	}

	function changeThresholds(next: AttentionThresholds) {
		setThresholds(next);
		writeAttentionThresholds(next);
	}

	const comparisons = useApi<OverviewComparisons>(
		`/api/metrics/overview-comparison?range=${range}`,
		refreshKey,
	);
	const noLibraryOlder = useApi<{ count: number }>(
		`/api/metrics/no-library-accounts?olderThanHours=${thresholds.noLibraryMinAgeHours}`,
		refreshKey,
	);

	const error =
		users.error || library.error || jobs.error || billing.error || enrich.error;
	if (error) return <ErrorState message={error} />;
	if (
		!users.data ||
		!library.data ||
		!jobs.data ||
		!billing.data ||
		!enrich.data
	)
		return <Loading />;

	const u = users.data;
	const l = library.data;
	const j = jobs.data;
	const b = billing.data;
	const e = enrich.data;

	const attention: {
		tone: "danger" | "warning" | "ok";
		icon: typeof WarningIcon;
		label: string;
		value: string;
		target: SectionKey;
	}[] = [];
	if (j.failed >= thresholds.failedJobsMin)
		attention.push({
			tone: "danger",
			icon: WarningCircleIcon,
			label: "Failed jobs",
			value: String(j.failed),
			target: "jobs",
		});
	if (j.staleRunning >= thresholds.staleRunningMin)
		attention.push({
			tone: "danger",
			icon: WarningIcon,
			label: "Stale running jobs (>5m)",
			value: String(j.staleRunning),
			target: "jobs",
		});
	if (j.unresolvedFailures >= thresholds.actionableFailuresMin)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: "Unresolved item failures",
			value: String(j.unresolvedFailures),
			target: "jobs",
		});
	if (
		j.pending > 0 &&
		j.oldestPendingSeconds !== null &&
		j.oldestPendingSeconds >= thresholds.pendingJobsMinAgeMinutes * 60
	)
		attention.push({
			tone: "warning",
			icon: HourglassIcon,
			label: "Pending jobs",
			value: `${j.pending} · oldest ${duration(j.oldestPendingSeconds)}`,
			target: "jobs",
		});
	if (b.grants.pending >= thresholds.pendingGrantsMin)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: "Pending liked-song grants",
			value: String(b.grants.pending),
			target: "billing",
		});
	if ((noLibraryOlder.data?.count ?? 0) > 0)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: `Accounts with no synced library (>${thresholds.noLibraryMinAgeHours}h old)`,
			value: String(noLibraryOlder.data?.count ?? 0),
			target: "users",
		});

	const coverage = [
		{ label: "Audio feat.", missing: e.missingAudio },
		{ label: "Lyrics", missing: e.missingLyrics },
		{ label: "Analysis", missing: e.missingAnalysis },
		{ label: "Embedding", missing: e.missingEmbedding },
	];

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Total accounts"
					value={u.totalAccounts}
					icon={UsersIcon}
					sub={
						<>
							<strong>+{u.signups7d}</strong> this week
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Active liked songs"
					value={l.activeLiked}
					icon={HeartIcon}
					sub={
						<>
							<strong>{compact(l.distinctLibrarySongs)}</strong> distinct
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Playlists"
					value={l.totalPlaylists}
					icon={MusicNotesIcon}
					sub={
						<>
							<strong>{compact(l.totalSongs)}</strong> songs in catalog
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Waitlist"
					value={u.waitlistTotal}
					icon={UserPlusIcon}
					sub="emails awaiting access"
				/>
			</Card>

			<Card
				title="Needs attention"
				icon={WarningIcon}
				span={6}
				action={
					<ThresholdsPopover
						thresholds={thresholds}
						onChange={changeThresholds}
					/>
				}
			>
				{attention.length === 0 ? (
					<div className="alert ok">
						<CheckCircleIcon className="alert-icon" size={16} weight="fill" />
						All clear — no failures, stale jobs, or pending grants.
					</div>
				) : (
					attention.map((a) => (
						<button
							type="button"
							key={a.label}
							className={`alert alert-btn ${a.tone}`}
							onClick={() => navigate(a.target)}
						>
							<a.icon className="alert-icon" size={16} weight="bold" />
							{a.label}
							<span className="alert-value">{a.value}</span>
							<CaretRightIcon className="alert-caret" size={13} weight="bold" />
						</button>
					))
				)}
			</Card>

			<Card title="Signups · last 14 days" icon={UserPlusIcon} span={6}>
				<Sparkline points={u.signupTrend.map((d) => d.count)} />
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<strong>{u.signups1d}</strong> today · <strong>{u.signups30d}</strong>{" "}
					in 30 days
				</div>
			</Card>

			<Card
				title="Period comparison"
				icon={HourglassIcon}
				span={12}
				action={
					<div className="btn-row">
						{RANGES.map((r) => (
							<button
								key={r}
								type="button"
								className={`btn mini ${range === r ? "primary" : ""}`}
								onClick={() => changeRange(r)}
							>
								{r}
							</button>
						))}
					</div>
				}
			>
				{!comparisons.data ? (
					<Loading />
				) : (
					<>
						<ComparisonRow
							label="Signups"
							comparison={comparisons.data.signups}
						/>
						<ComparisonRow
							label="Jobs created"
							comparison={comparisons.data.jobsCreated}
						/>
						<ComparisonRow
							label="Jobs completed"
							comparison={comparisons.data.jobsCompleted}
						/>
						<ComparisonRow
							label="Jobs failed"
							comparison={comparisons.data.jobsFailed}
						/>
						<ComparisonRow
							label="Analyses created"
							comparison={comparisons.data.analysesCreated}
						/>
						<ComparisonRow
							label="Analysis spend"
							comparison={comparisons.data.analysisSpendUsd}
							format={usd}
						/>
						<div className="stat-sub" style={{ marginTop: 8 }}>
							vs the immediately preceding {range} period
						</div>
					</>
				)}
			</Card>

			<Card
				title="Enrichment coverage · entitled songs"
				icon={SparkleIcon}
				span={12}
			>
				{e.entitledSongs === 0 ? (
					<div className="empty">No entitled (unlocked) songs yet.</div>
				) : (
					coverage.map((c) => {
						const covered = e.entitledSongs - c.missing;
						return (
							<Bar
								key={c.label}
								label={`${c.label} · ${pct(covered, e.entitledSongs)}%`}
								value={covered}
								max={e.entitledSongs}
							/>
						);
					})
				)}
			</Card>
		</div>
	);
}
